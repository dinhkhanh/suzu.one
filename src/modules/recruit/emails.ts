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
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { queueRawEmail } from "@/modules/platform/notifications/service";
import type { RecruitEmailKind } from "./enums";
import { emailTemplateProblems, renderEmail, type RenderedEmail } from "./engine/email-template";
import { findApplication, findCandidate, findOpening, inTransaction, recordApplicationEvent, stagesOf } from "./service";

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

/** Which wording is read to the candidate. Their language is a property of them, not of the sender. */
const wordingOf = (template: EmailTemplateRow, locale: string) =>
  locale === "en" && template.subjectEn && template.bodyEn ? { subject: template.subjectEn, body: template.bodyEn } : { subject: template.subject, body: template.body };

/**
 * The facts a letter may name, assembled from the records — never from the form. `careers_url` is
 * the public list, which is the only SuZu One address a candidate is ever sent to.
 */
async function contextFor(applicationId: string, senderName: string): Promise<{ context: Record<string, string>; to: string; candidateName: string; openingCode: string; entityId: string | null }> {
  const application = await findApplication(applicationId);
  if (!application) throw new ActionError("recruit_application_not_found");
  const [candidate, opening] = await Promise.all([findCandidate(application.candidateId), findOpening(application.openingId)]);
  if (!candidate || !opening) throw new ActionError("recruit_application_not_found");
  if (candidate.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");
  // Nothing to send to. Not a bug: a candidate somebody added from a forwarded CV may have no address.
  if (!candidate.email) throw new ActionError("recruit_candidate_no_email");

  const [entity] = await db().select({ shortName: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, opening.entityId)).limit(1);
  const stage = (await stagesOf(opening.pipelineId)).find((row) => row.id === application.stageId);
  return {
    to: candidate.email,
    candidateName: candidate.fullName,
    openingCode: opening.code,
    entityId: opening.entityId,
    context: {
      candidate_name: candidate.fullName,
      job_title: opening.title,
      company_name: entity?.shortName ?? "",
      stage_name: stage?.name ?? "",
      sender_name: senderName,
      careers_url: `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/careers`,
    },
  };
}

/** What the sender is shown before they send it. Reads nothing and writes nothing. */
export async function previewCandidateEmail(applicationId: string, templateId: string, sender: { fullName: string }, locale: string): Promise<(RenderedEmail & { to: string }) | null> {
  const template = await findEmailTemplate(templateId);
  if (!template) return null;
  const { context, to } = await contextFor(applicationId, sender.fullName);
  return { ...renderEmail(wordingOf(template, locale), context), to };
}

/**
 * Sends it, and writes the fact to the application's history. The history records **which wording
 * went out and to what kind of address**, not the letter: a rejection's text is the same for
 * everybody and the interesting fact is that it was sent, and when.
 */
export async function sendCandidateEmail(
  applicationId: string,
  templateId: string,
  sender: { personId: string; fullName: string },
  locale: string,
): Promise<{ to: string; subject: string; templateCode: string; entityId: string | null }> {
  const template = await findEmailTemplate(templateId);
  if (!template) throw new ActionError("recruit_email_template_not_found");
  const { context, to, openingCode, entityId } = await contextFor(applicationId, sender.fullName);
  const rendered = renderEmail(wordingOf(template, locale), context);

  return inTransaction(async (tx) => {
    await queueRawEmail(to, rendered.subject, rendered.body, tx);
    await recordApplicationEvent(tx, {
      applicationId,
      type: "emailed",
      actorPersonId: sender.personId,
      note: template.name,
      detail: { templateCode: template.code, kind: template.kind, missing: rendered.missing },
    });
    return { to, subject: rendered.subject, templateCode: `${openingCode} · ${template.code}`, entityId };
  });
}
