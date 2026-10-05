import "server-only";
// Sending a candidate an email (FR-REC-05). Two rules shape everything here.
//
// **One outbox.** A candidate email is inserted into `email_outbox` by `queueRawEmail`, exactly
// like every other email the product sends. It is delivered, retried and — with no
// `RESEND_API_KEY` — simulated by the same code. There is no second mail path.
//
// **The context is built by the server, never by the sender.** The placeholders are filled from
// the application, the opening and the person clicking send. Nothing the *recruiter typed into
// this screen* reaches the letter, so a wording cannot be turned into a way to send arbitrary
// text to an address of somebody's choosing.
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { publicOrigin } from "@/lib/site";
import { queueRawEmail } from "@/modules/platform/notifications/service";
import { listEntities } from "@/modules/platform/org/service";
import type { RecruitEmailKind } from "./enums";
import { emailTemplateProblems, placeholdersIn, renderEmail, type RenderedEmail } from "./engine/email-template";
import { privacyLinkFor, rememberPrivacyLink } from "./privacy";
import { type ApplicationRow, type CandidateRow, findApplication, findCandidate, findOpening, inTransaction, type OpeningRow, recordApplicationEvent, stagesOf } from "./service";

export type EmailTemplateRow = typeof schema.recruitEmailTemplate.$inferSelect;

// The wordings are configuration (a dozen rows): cached whole, cleared by `saveEmailTemplate`.
const TEMPLATES_CACHE = "recruit:email-templates";
const TEMPLATES_TTL = 60 * 60;

const allTemplates = (): Promise<EmailTemplateRow[]> =>
  cached(TEMPLATES_CACHE, TEMPLATES_TTL, () => db().select().from(schema.recruitEmailTemplate).orderBy(asc(schema.recruitEmailTemplate.kind), asc(schema.recruitEmailTemplate.name)));

export async function listEmailTemplates(onlyActive = true): Promise<EmailTemplateRow[]> {
  const rows = await allTemplates();
  return onlyActive ? rows.filter((row) => row.isActive) : rows;
}

export async function findEmailTemplate(templateId: string): Promise<EmailTemplateRow | undefined> {
  return (await allTemplates()).find((row) => row.id === templateId && row.isActive);
}

/** The placeholders only an interview's own letters can fill. */
const INTERVIEW_ONLY = new Set(["interview_time", "interview_place", "interview_notes"]);

/**
 * Whether a wording can be sent by hand from an application. One that names an interview's time or
 * place cannot: the application page has no interview to fill them from, and the letter would reach
 * the candidate with braces in it. Those go out from the interview, by themselves.
 */
export const sendableByHand = (template: EmailTemplateRow): boolean =>
  !placeholdersIn([template.subject, template.body, template.subjectEn ?? "", template.bodyEn ?? ""].join("\n")).some((key) => INTERVIEW_ONLY.has(key));

/** The wordings the application page offers to send. */
export async function listHandSentTemplates(): Promise<EmailTemplateRow[]> {
  return (await listEmailTemplates()).filter(sendableByHand);
}

export type EmailTemplateInput = { code: string; name: string; kind: RecruitEmailKind; subject: string; body: string; subjectEn: string | null; bodyEn: string | null; isActive: boolean };

export async function saveEmailTemplate(templateId: string | null, input: EmailTemplateInput, actorPersonId: string): Promise<{ before: EmailTemplateRow | null; after: EmailTemplateRow }> {
  // Both languages are checked: an unknown placeholder hiding in the English body would ship as
  // literal braces to an English-speaking candidate and nowhere else.
  for (const draft of [{ subject: input.subject, body: input.body }, ...(input.subjectEn && input.bodyEn ? [{ subject: input.subjectEn, body: input.bodyEn }] : [])]) {
    const problems = emailTemplateProblems(draft);
    if (problems.length > 0) throw new ActionError(problems[0]);
  }
  const values = { ...input, updatedByPersonId: actorPersonId, updatedAt: new Date() };
  if (!templateId) {
    const [after] = await db().insert(schema.recruitEmailTemplate).values(values).returning();
    await invalidate(TEMPLATES_CACHE);
    return { before: null, after };
  }
  const [before] = await db().select().from(schema.recruitEmailTemplate).where(eq(schema.recruitEmailTemplate.id, templateId)).limit(1);
  if (!before) throw new ActionError("recruit_email_template_not_found");
  const [after] = await db().update(schema.recruitEmailTemplate).set(values).where(eq(schema.recruitEmailTemplate.id, templateId)).returning();
  await invalidate(TEMPLATES_CACHE);
  return { before, after };
}

/**
 * A wording by its code, switched off or not — the automatic letters look theirs up this way. Read
 * from the caller's transaction when there is one (a letter is queued inside the use-case's), and
 * from the cached table otherwise.
 */
export async function findEmailTemplateByCode(code: string, executor?: Tx): Promise<EmailTemplateRow | undefined> {
  if (executor) return (await executor.select().from(schema.recruitEmailTemplate).where(eq(schema.recruitEmailTemplate.code, code)).limit(1))[0];
  return (await allTemplates()).find((row) => row.code === code);
}

/** Which wording is read to the candidate. Their language is a property of them, not of the sender. */
export const wordingOf = (template: EmailTemplateRow, locale: string) =>
  locale === "en" && template.subjectEn && template.bodyEn ? { subject: template.subjectEn, body: template.bodyEn } : { subject: template.subject, body: template.body };

/** What every letter about one application may name, read in one place for the hand-sent and the automatic ones. */
export type LetterFacts = {
  application: ApplicationRow;
  candidate: CandidateRow;
  opening: OpeningRow;
  companyName: string;
  stage: { name: string; nameEn: string | null } | null;
};

export async function letterFacts(applicationId: string, executor?: Tx): Promise<LetterFacts> {
  const application = await findApplication(applicationId, executor);
  if (!application) throw new ActionError("recruit_application_not_found");
  const [candidate, opening] = await Promise.all([findCandidate(application.candidateId, executor), findOpening(application.openingId, executor)]);
  if (!candidate || !opening) throw new ActionError("recruit_application_not_found");
  // The entity's name from the cached org reference; a transaction reads its own rows.
  const [[entity], stages] = await Promise.all([
    executor ? executor.select({ shortName: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, opening.entityId)).limit(1) : listEntities().then((rows) => rows.filter((row) => row.id === opening.entityId)),
    stagesOf(opening.pipelineId, executor),
  ]);
  const stage = stages.find((row) => row.id === application.stageId);
  return { application, candidate, opening, companyName: entity?.shortName ?? "", stage: stage ? { name: stage.name, nameEn: stage.nameEn } : null };
}

/**
 * The placeholders every letter can fill, from the records and in the candidate's language —
 * never from a form. `careers_url` is the public list, which with the privacy page is the only
 * SuZu One address a candidate is ever sent to. `privacy_url` is passed in by the caller, who
 * decides whether this letter may carry it (see `letters.ts`).
 */
export function baseContext(facts: LetterFacts, locale: string, names: { candidateName: string; senderName: string; privacyUrl: string | null }): Record<string, string> {
  const english = locale === "en";
  return {
    candidate_name: names.candidateName,
    job_title: english && facts.opening.titleEn ? facts.opening.titleEn : facts.opening.title,
    company_name: facts.companyName,
    stage_name: facts.stage ? (english && facts.stage.nameEn ? facts.stage.nameEn : facts.stage.name) : "",
    sender_name: names.senderName,
    careers_url: `${publicOrigin()}/careers`,
    privacy_url: names.privacyUrl ?? "",
  };
}

/** A letter written by hand goes to the address on the record, and nowhere else. */
async function contextFor(applicationId: string, senderName: string, locale: string): Promise<{ context: Record<string, string>; to: string; candidateId: string; privacyHash: string | null; openingCode: string; entityId: string | null }> {
  const facts = await letterFacts(applicationId);
  const { candidate, opening } = facts;
  if (candidate.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");
  // Nothing to send to. Not a bug: a candidate somebody added from a forwarded CV may have no address.
  if (!candidate.email) throw new ActionError("recruit_candidate_no_email");
  // The record's own address, so the link to the record's privacy page may ride along.
  const privacy = privacyLinkFor(candidate);
  return {
    to: candidate.email,
    candidateId: candidate.id,
    privacyHash: privacy?.hash ?? null,
    openingCode: opening.code,
    entityId: opening.entityId,
    context: baseContext(facts, locale, { candidateName: candidate.fullName, senderName, privacyUrl: privacy?.url ?? null }),
  };
}

/** What the sender is shown before they send it. Reads nothing and writes nothing. */
export async function previewCandidateEmail(applicationId: string, templateId: string, sender: { fullName: string }, locale: string): Promise<(RenderedEmail & { to: string }) | null> {
  const template = await findEmailTemplate(templateId);
  if (!template) return null;
  const { context, to } = await contextFor(applicationId, sender.fullName, locale);
  return { ...renderEmail(wordingOf(template, locale), context), to };
}

/**
 * Sends it, and writes the fact to the application's history. The history records **which wording
 * went out and to what kind of address**, not the letter: a rejection's text is the same for
 * everybody and the interesting fact is that it was sent, and when — and, through the outbox row it
 * names, whether it actually went.
 */
export async function sendCandidateEmail(
  applicationId: string,
  templateId: string,
  sender: { personId: string; fullName: string },
  locale: string,
): Promise<{ to: string; subject: string; templateCode: string; entityId: string | null }> {
  const template = await findEmailTemplate(templateId);
  if (!template) throw new ActionError("recruit_email_template_not_found");
  if (!sendableByHand(template)) throw new ActionError("recruit_email_needs_interview");
  const { context, to, candidateId, privacyHash, openingCode, entityId } = await contextFor(applicationId, sender.fullName, locale);
  const rendered = renderEmail(wordingOf(template, locale), context);

  return inTransaction(async (tx) => {
    if (privacyHash && rendered.body.includes(context.privacy_url)) await rememberPrivacyLink(tx, candidateId, privacyHash);
    const { id: outboxId } = await queueRawEmail(to, rendered.subject, rendered.body, tx);
    await recordApplicationEvent(tx, {
      applicationId,
      type: "emailed",
      actorPersonId: sender.personId,
      note: template.name,
      detail: { templateCode: template.code, kind: template.kind, missing: rendered.missing, outboxId },
    });
    return { to, subject: rendered.subject, templateCode: `${openingCode} · ${template.code}`, entityId };
  });
}
