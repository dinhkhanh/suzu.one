import "server-only";
// The letters the system sends a candidate **by itself** (FR-REC-03, 05, 06, 08): the
// acknowledgement when they apply, the invitation with the time when an interview is booked or
// moved, the word that it is off when it is cancelled, the rejection, and the offer.
//
// They are the same wordings as the hand-sent ones (`recruit_email_template`, by the codes in
// `AUTOMATIC_LETTERS`), through the same outbox, and every one of them leaves a line in the
// application's history that names the outbox row — which is how a recruiter sees, on the
// application, whether the letter actually went, is being retried, or failed.
//
// Four rules, each the answer to a way such letters go wrong:
//
//   · **A letter goes to one person and names one person.** The context is built from this one
//     application's records; nothing in it is ever looked up by address or by name, so a letter
//     cannot carry another candidate's anything.
//   · **The acknowledgement goes to whoever filled in the form, as they typed it.** The public form
//     joins an application to a record already on file by address *or number* (`public.ts`), and
//     anybody can type anybody's number. So the thank-you is addressed to the address typed and
//     greets the name typed — never the name on the record it joined — and carries the link to the
//     record's privacy page only when the typed address *is* the record's address.
//   · **The candidate's language is theirs**: what they applied in, or what a recruiter recorded
//     (`candidate.locale`), never the language of whoever pressed the button.
//   · **A letter that cannot go says why, in the history**: no address, the record was emptied, or
//     HR switched that letter off. Silence is the one outcome a recruiter cannot act on.
import { createTranslator } from "next-intl";
import { db, type Tx } from "@/lib/db";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { queueRawEmail } from "@/modules/platform/notifications/service";
import type { EmailAttachment } from "@/modules/platform/notifications/schema";
import { renderEmail } from "./engine/email-template";
import { AUTOMATIC_LETTERS, type AutomaticLetter, type CandidateLocale, candidateLocale, OPTIONAL_LETTER_PLACEHOLDERS, type RejectionReason } from "./enums";
import { baseContext, findEmailTemplateByCode, letterFacts, wordingOf } from "./emails";
import { privacyLinkFor, rememberPrivacyLink } from "./privacy";
import { type ApplicationRow, inTransaction, recordApplicationEvent, rejectApplication } from "./service";

type Executor = Tx | ReturnType<typeof db>;

/** Why a letter did not go. Written to the history and shown on the application. */
export const LETTER_SKIPS = ["no_address", "anonymised", "switched_off"] as const;
export type LetterSkip = (typeof LETTER_SKIPS)[number];

export type LetterOutcome = { queued: true; outboxId: string; to: string } | { queued: false; reason: LetterSkip };

/** The few words a letter needs that are not in its template: who signs an unsigned one, how a call is held. */
export function letterWords(locale: CandidateLocale) {
  return createTranslator({ locale, messages: locale === "en" ? en : vi, namespace: "recruit.letters" });
}

export type LetterRequest = {
  letter: AutomaticLetter;
  applicationId: string;
  /** Who did the thing the letter is about; null for the careers page. */
  actorPersonId: string | null;
  /** The name the letter is signed with; null signs it from the recruitment team. */
  senderName: string | null;
  /**
   * The acknowledgement's own recipient: the address and name typed into the form, and the
   * language the form was in. Every other letter goes to the record's own address.
   */
  typed?: { email: string; name: string; locale: CandidateLocale };
  /** The letter's own facts — an interview's time and place. */
  extra?: (locale: CandidateLocale) => Record<string, string>;
  /** Files to attach, in the candidate's language. */
  attachments?: (locale: CandidateLocale, to: { email: string; name: string }) => EmailAttachment[];
};

/**
 * Queues one automatic letter in the caller's transaction (or on its own), and writes the outcome
 * to the application's history either way. Never throws for a letter that cannot go: the thing it
 * is about — the rejection, the interview — has happened, and stays happened.
 */
export async function sendLetter(executor: Executor, request: LetterRequest): Promise<LetterOutcome> {
  const code = AUTOMATIC_LETTERS[request.letter];
  // Inside the use-case's transaction, everything is read from it — never past it, through the cache.
  const tx = executor === db() ? undefined : (executor as Tx);
  const template = await findEmailTemplateByCode(code, tx);
  const facts = await letterFacts(request.applicationId, tx);
  const { candidate } = facts;

  const skip = async (reason: LetterSkip): Promise<LetterOutcome> => {
    await recordApplicationEvent(executor, { applicationId: request.applicationId, type: "emailed", actorPersonId: request.actorPersonId, note: template?.name ?? null, detail: { templateCode: code, automatic: true, skipped: reason } });
    return { queued: false, reason };
  };
  if (!template?.isActive) return skip("switched_off");
  if (candidate.anonymisedAt) return skip("anonymised");

  // The acknowledgement: the typed address, the typed name, the form's language. The record's
  // privacy page only when the typed address is, letter for letter, the record's own — not merely
  // the same once a `+tag` is dropped, which not every mail provider delivers to one mailbox.
  const sameAddress = (left: string, right: string | null) => !!right && left.trim().toLowerCase() === right.trim().toLowerCase();
  const recipient = request.typed
    ? { email: request.typed.email, name: request.typed.name, locale: request.typed.locale, ownsRecord: sameAddress(request.typed.email, candidate.email) }
    : candidate.email
      ? { email: candidate.email, name: candidate.fullName, locale: candidateLocale(candidate.locale), ownsRecord: true }
      : null;
  if (!recipient) return skip("no_address");

  const privacy = recipient.ownsRecord ? privacyLinkFor(candidate) : null;
  const words = letterWords(recipient.locale);
  const context = {
    ...baseContext(facts, recipient.locale, { candidateName: recipient.name, senderName: request.senderName ?? words("team", { company: facts.companyName }), privacyUrl: privacy?.url ?? null }),
    ...request.extra?.(recipient.locale),
  };
  const rendered = renderEmail(wordingOf(template, recipient.locale), context, { optional: OPTIONAL_LETTER_PLACEHOLDERS });

  if (privacy && rendered.body.includes(privacy.url)) await rememberPrivacyLink(executor, candidate.id, privacy.hash);
  const attachments = request.attachments?.(recipient.locale, { email: recipient.email, name: recipient.name }) ?? null;
  const { id: outboxId } = await queueRawEmail(recipient.email, rendered.subject, rendered.body, executor, attachments);
  await recordApplicationEvent(executor, {
    applicationId: request.applicationId,
    type: "emailed",
    actorPersonId: request.actorPersonId,
    note: template.name,
    // Which wording and which outbox row — never the letter, its subject or the address.
    detail: { templateCode: template.code, kind: template.kind, automatic: true, outboxId, missing: rendered.missing, attachments: attachments?.length ?? 0 },
  });
  return { queued: true, outboxId, to: recipient.email };
}

/**
 * Turning an application down, and — when the recruiter left "tell the candidate" ticked — the
 * rejection letter, in one transaction: a letter is never queued for a rejection that rolled back.
 */
export async function rejectApplicationAndTell(
  applicationId: string,
  input: { reason: RejectionReason; note: string | null },
  actor: { personId: string; fullName: string },
  tell: boolean,
): Promise<{ before: ApplicationRow; after: ApplicationRow; letter: LetterOutcome | null }> {
  return inTransaction(async (tx) => {
    const result = await rejectApplication(applicationId, input, actor.personId, tx);
    // The reason and the internal note stay inside: the letter is the template, nothing more.
    const letter = tell ? await sendLetter(tx, { letter: "reject", applicationId, actorPersonId: actor.personId, senderName: actor.fullName }) : null;
    return { ...result, letter };
  });
}
