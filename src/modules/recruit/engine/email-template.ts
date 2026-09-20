// The wordings recruiters send candidates (FR-REC-05): invite, reject, offer. Pure: no I/O.
//
// Deliberately much smaller than `documents/engine/template.ts`, and for a reason. A generated
// document is a legal paper about an employee whose placeholders carry sensitivity tiers, so that
// engine has to refuse a body that names a fact above the template's tier. An email to a candidate
// is a letter to somebody outside the company: it may name them, the job and who is writing, and
// **there is no placeholder for a figure at all**. An offer *amount* belongs in the offer letter
// (week 4), which is a document with a tier, not in a template anybody with `recruit:manage` can
// edit and send. So the safety rule here is the opposite shape: a short allow-list, and a body
// naming anything outside it cannot be saved.
import { RECRUIT_EMAIL_PLACEHOLDERS } from "../enums";

const KNOWN = new Set<string>(RECRUIT_EMAIL_PLACEHOLDERS);

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 10_000;

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Every `{{placeholder}}` a piece of text names, in order, without repeats. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/** The ones this system has no value for — what stops a typo shipping as `{{candidat_name}}`. */
export function unknownPlaceholders(text: string): string[] {
  return placeholdersIn(text).filter((key) => !KNOWN.has(key));
}

export type EmailTemplateProblem = "email_template_subject_empty" | "email_template_subject_too_long" | "email_template_body_empty" | "email_template_body_too_long" | "email_template_unknown_placeholder";

export type EmailTemplateDraft = { subject: string; body: string };

export function emailTemplateProblems(draft: EmailTemplateDraft): EmailTemplateProblem[] {
  const problems: EmailTemplateProblem[] = [];
  if (draft.subject.trim() === "") problems.push("email_template_subject_empty");
  if (draft.subject.length > MAX_SUBJECT_LENGTH) problems.push("email_template_subject_too_long");
  if (draft.body.trim() === "") problems.push("email_template_body_empty");
  if (draft.body.length > MAX_BODY_LENGTH) problems.push("email_template_body_too_long");
  if (unknownPlaceholders(`${draft.subject}\n${draft.body}`).length > 0) problems.push("email_template_unknown_placeholder");
  return problems;
}

export type RenderedEmail = { subject: string; body: string; /** Placeholders the context had no value for; shown to the sender before they send. */ missing: string[] };

/**
 * Substitution, and nothing else — no conditionals, no loops, no expressions. A placeholder the
 * context cannot fill is left standing rather than blanked, so the sender sees `{{start_date}}` in
 * the preview instead of a sentence with a hole in it.
 */
export function renderEmail(template: EmailTemplateDraft, context: Readonly<Record<string, string>>): RenderedEmail {
  const missing = new Set<string>();
  const substitute = (text: string) =>
    text.replace(PLACEHOLDER, (whole, key: string) => {
      const value = context[key];
      if (value === undefined || value === "") {
        missing.add(key);
        return whole;
      }
      return value;
    });
  const subject = substitute(template.subject).slice(0, MAX_SUBJECT_LENGTH);
  const body = substitute(template.body).slice(0, MAX_BODY_LENGTH);
  return { subject, body, missing: [...missing] };
}
