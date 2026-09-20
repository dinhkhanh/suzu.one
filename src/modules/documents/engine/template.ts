// Document templates (FR-CHR-06). Pure: no I/O, no `eval`, no `Function`, no member access —
// a template is text with `{{placeholder}}` holes, and the holes come from a fixed catalogue.
//
// The catalogue is the security boundary of this module, and it is a boundary of *data*, not of
// code: every placeholder carries the sensitivity tier of the fact it reveals, and a template may
// not name a placeholder above its own tier. That single rule is what makes it impossible to
// build a letter that quietly prints somebody's salary for a reader who may not see it — the
// template cannot be saved, so the leak has nowhere to live. The check at generation time and the
// check at download time are the second and third lines, not the first.

import type { Tier } from "@/modules/platform/rbac/roles";

export type PlaceholderKey = string;

export type Placeholder = {
  key: PlaceholderKey;
  /** The tier of the fact this reveals. A template naming it must be at least this sensitive. */
  tier: Tier;
  /** Message key for the designer's field list: `documents.placeholders.<key>`. */
  group: "company" | "person" | "employment" | "salary" | "document" | "offer";
};

const RANK: Record<Tier, number> = { public_internal: 0, personal: 1, restricted: 2, compensation: 3 };
export const atLeast = (have: Tier, needed: Tier): boolean => RANK[have] >= RANK[needed];

/**
 * Everything a template may say. Adding a row here is how a new fact becomes available; the tier
 * on it is the decision, and `templateProblems` enforces it without anyone having to remember.
 */
export const PLACEHOLDERS: readonly Placeholder[] = [
  // The letterhead and the paperwork around the letter: nothing personal at all.
  { key: "company.name", tier: "public_internal", group: "company" },
  { key: "company.address", tier: "public_internal", group: "company" },
  { key: "company.taxCode", tier: "public_internal", group: "company" },
  { key: "company.phone", tier: "public_internal", group: "company" },
  { key: "company.representative", tier: "public_internal", group: "company" },
  { key: "company.representativeTitle", tier: "public_internal", group: "company" },
  { key: "document.number", tier: "public_internal", group: "document" },
  { key: "document.date", tier: "public_internal", group: "document" },
  { key: "document.place", tier: "public_internal", group: "document" },

  // Who the document is about. A name and a job title are personal, not secret.
  { key: "person.fullName", tier: "personal", group: "person" },
  { key: "person.employeeCode", tier: "personal", group: "person" },
  { key: "person.position", tier: "personal", group: "person" },
  { key: "person.department", tier: "personal", group: "person" },
  { key: "person.workEmail", tier: "personal", group: "person" },
  { key: "employment.startDate", tier: "personal", group: "employment" },
  { key: "employment.seniorityDate", tier: "personal", group: "employment" },
  { key: "employment.endDate", tier: "personal", group: "employment" },
  { key: "employment.type", tier: "personal", group: "employment" },
  { key: "employment.status", tier: "personal", group: "employment" },

  // Identity documents and dates of birth: the restricted tier, as everywhere else in the system.
  { key: "person.dateOfBirth", tier: "restricted", group: "person" },
  { key: "person.gender", tier: "restricted", group: "person" },

  // Money. A template that says any of these is a compensation-tier document, full stop.
  { key: "salary.base", tier: "compensation", group: "salary" },
  { key: "salary.insurance", tier: "compensation", group: "salary" },
  { key: "salary.allowances", tier: "compensation", group: "salary" },
  { key: "salary.total", tier: "compensation", group: "salary" },
  { key: "salary.totalInWords", tier: "compensation", group: "salary" },
  { key: "salary.effectiveFrom", tier: "compensation", group: "salary" },

  // The offer letter (FR-REC-08). An offer is about somebody who is not on the books yet, so it
  // borrows `person.fullName`, `person.position` and the `salary.*` figures above and adds the
  // three facts that are peculiar to it. `offer.probationSalary` is a figure, so it is
  // compensation like every other figure; how *long* probation lasts is not.
  { key: "offer.expiryDate", tier: "personal", group: "offer" },
  { key: "offer.probationMonths", tier: "personal", group: "offer" },
  { key: "offer.probationSalary", tier: "compensation", group: "offer" },
];

const BY_KEY = new Map(PLACEHOLDERS.map((placeholder) => [placeholder.key, placeholder]));

export const findPlaceholder = (key: string): Placeholder | undefined => BY_KEY.get(key);

/** The highest tier among a set of placeholders — what a template naming them must be. */
export function requiredTier(keys: readonly string[]): Tier {
  let tier: Tier = "public_internal";
  for (const key of keys) {
    const placeholder = BY_KEY.get(key);
    if (placeholder && RANK[placeholder.tier] > RANK[tier]) tier = placeholder.tier;
  }
  return tier;
}

// `{{ person.fullName }}` — dots and letters only, so nothing resembling an expression parses.
const HOLE = /\{\{\s*([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)\s*\}\}/g;

/** Every placeholder a body names, in order, without duplicates. */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(HOLE)].map((match) => match[1]))];
}

/** Placeholders the body names that the catalogue does not know. */
export function unknownPlaceholders(body: string): string[] {
  return placeholdersIn(body).filter((key) => !BY_KEY.has(key));
}

export const MAX_BODY_LENGTH = 20_000;
export const MAX_OUTPUT_LENGTH = 40_000;

export type TemplateProblem = "template_body_empty" | "template_body_too_long" | "template_unknown_placeholder" | "template_tier_too_low" | "template_name_empty";

export type TemplateDraft = { name: string; body: string; tier: Tier };

/**
 * What an administrator may save. The third problem is the one that matters: a body naming
 * `{{salary.total}}` cannot be stored as a `personal` letter, so no reader of personal documents
 * can ever be handed a salary — whatever anybody later gets wrong at generation or download.
 */
export function templateProblems(draft: TemplateDraft): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (!draft.name.trim()) problems.push("template_name_empty");
  if (!draft.body.trim()) problems.push("template_body_empty");
  if (draft.body.length > MAX_BODY_LENGTH) problems.push("template_body_too_long");
  if (unknownPlaceholders(draft.body).length > 0) problems.push("template_unknown_placeholder");
  if (!atLeast(draft.tier, requiredTier(placeholdersIn(draft.body)))) problems.push("template_tier_too_low");
  return problems;
}

export type RenderResult = { text: string; /** Placeholders the context had no value for; shown to the person generating. */ missing: string[] };

/**
 * Fills the holes. A value the context does not carry is left as a visible marker rather than
 * blanked, so nobody signs a contract with an invisible gap where the salary should be — and it
 * is reported in `missing` so the screen can say so before the PDF is made.
 */
export function renderTemplate(body: string, context: Readonly<Record<string, string>>): RenderResult {
  const missing: string[] = [];
  const text = body.replace(HOLE, (_match, key: string) => {
    const value = Object.hasOwn(context, key) ? context[key] : undefined;
    if (value === undefined || value === "") {
      if (!missing.includes(key)) missing.push(key);
      return `[${key}]`;
    }
    return value;
  });
  return { text: text.slice(0, MAX_OUTPUT_LENGTH), missing };
}
