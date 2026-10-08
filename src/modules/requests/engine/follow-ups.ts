// Follow-up requests (FR-REQ-05): a request type may name other types that are filed *under* one of
// its requests — a business trip carries its advance, and once the trip is over, the payment that
// settles it. Pure: no I/O, no database, no translation.
//
// The link is declared on the parent type, as a list of rules. Each rule names a child type by its
// code (codes never change and types are never deleted, so a code is a safe reference) and says
// when a child may be filed: once the parent is sent or only once it is approved, optionally not
// before the day a date field on the parent names ("after the trip is over"), and at most how many
// at a time. The child is an ordinary request of its own type — its own form, its own flow, its own
// approvers — that remembers which request it belongs to.

import type { FormDefinition, FormValues } from "./form";

/** When a follow-up may be filed: as soon as the parent is sent, or only once it is approved. */
export const FOLLOW_UP_OPENS = ["submitted", "approved"] as const;
export type FollowUpOpens = (typeof FOLLOW_UP_OPENS)[number];

export type FollowUpRule = {
  /** The child type's code. */
  code: string;
  opensWhen: FollowUpOpens;
  /** A `date` field of the parent's form; the child opens on that day (e.g. the trip's last day). */
  notBeforeField?: string | null;
  /** How many children of this type one parent may have at a time; rejected and withdrawn ones do not count. null = no limit. */
  max?: number | null;
};

export const MAX_FOLLOW_UPS = 10;
export const MAX_PER_PARENT = 50;

/** The parent statuses a child counts against, and those in which it may be filed at all. */
export const LIVE_STATUSES = ["pending", "returned", "approved"] as const;
const OPEN_WHILE: Record<FollowUpOpens, readonly string[]> = { submitted: ["pending", "returned", "approved"], approved: ["approved"] };

// ── What a designer may save ────────────────────────────────────────────────────────────────

export type FollowUpProblem = "too_many_follow_ups" | "follow_up_unknown_type" | "follow_up_self" | "follow_up_duplicate" | "follow_up_cycle" | "follow_up_bad_date_field" | "follow_up_bad_max";

/**
 * Everything wrong with a type's follow-up rules, against the rest of the catalogue. A type may not
 * be its own descendant — a trip under an advance under the same trip would never end — so the new
 * rules are checked together with every other type's.
 */
export function followUpProblems(type: { code: string; form: FormDefinition; followUps: readonly FollowUpRule[] }, catalogue: readonly { code: string; followUps: readonly FollowUpRule[] }[]): FollowUpProblem[] {
  const problems = new Set<FollowUpProblem>();
  if (type.followUps.length > MAX_FOLLOW_UPS) problems.add("too_many_follow_ups");
  const known = new Set(catalogue.map((row) => row.code));
  const dateFields = new Set(type.form.fields.filter((field) => field.type === "date").map((field) => field.key));
  const seen = new Set<string>();
  for (const rule of type.followUps) {
    if (rule.code === type.code) problems.add("follow_up_self");
    else if (!known.has(rule.code)) problems.add("follow_up_unknown_type");
    if (seen.has(rule.code)) problems.add("follow_up_duplicate");
    seen.add(rule.code);
    if (rule.notBeforeField && !dateFields.has(rule.notBeforeField)) problems.add("follow_up_bad_date_field");
    if (rule.max != null && (!Number.isInteger(rule.max) || rule.max < 1 || rule.max > MAX_PER_PARENT)) problems.add("follow_up_bad_max");
  }
  if (!problems.has("follow_up_self") && reachesItself(type, catalogue)) problems.add("follow_up_cycle");
  return [...problems];
}

function reachesItself(type: { code: string; followUps: readonly FollowUpRule[] }, catalogue: readonly { code: string; followUps: readonly FollowUpRule[] }[]): boolean {
  const children = new Map(catalogue.map((row) => [row.code, row.followUps.map((rule) => rule.code)]));
  children.set(
    type.code,
    type.followUps.map((rule) => rule.code),
  );
  const visited = new Set<string>();
  const stack = [...(children.get(type.code) ?? [])];
  while (stack.length > 0) {
    const code = stack.pop()!;
    if (code === type.code) return true;
    if (visited.has(code)) continue;
    visited.add(code);
    stack.push(...(children.get(code) ?? []));
  }
  return false;
}

// ── Whether a child may be filed now ────────────────────────────────────────────────────────

export type FollowUpGate =
  { open: true } | { open: false; reason: "parent_closed" } | { open: false; reason: "parent_not_approved" } | { open: false; reason: "not_yet"; opensOn: string } | { open: false; reason: "limit_reached"; max: number };

/**
 * May one more child of this rule's type be filed under this parent today? `live` is how many the
 * parent already has that still count (sent, returned or approved). The reasons are checked in the
 * order a requester can do something about them: a closed parent never reopens, approval comes
 * next, then the calendar, then the limit.
 */
export function followUpGate(rule: FollowUpRule, parent: { status: string; values: FormValues }, live: number, today: string): FollowUpGate {
  if (!OPEN_WHILE.submitted.includes(parent.status)) return { open: false, reason: "parent_closed" };
  if (!OPEN_WHILE[rule.opensWhen].includes(parent.status)) return { open: false, reason: "parent_not_approved" };
  if (rule.notBeforeField) {
    const day = parent.values[rule.notBeforeField];
    // A date the parent left empty (a hidden or optional field) cannot hold the child back.
    if (typeof day === "string" && day > today) return { open: false, reason: "not_yet", opensOn: day };
  }
  if (rule.max != null && live >= rule.max) return { open: false, reason: "limit_reached", max: rule.max };
  return { open: true };
}

// ── What the child starts from ──────────────────────────────────────────────────────────────

/**
 * The parent's answers a child's form starts with: every field the two forms share by key and
 * type — a trip's purpose and its estimate become the advance's purpose and amount. Only a starting
 * point: the requester changes whatever they like, and the child is validated as its own form.
 *
 * Attachments are never carried: a file belongs to one request, and the attachment rule that opens
 * it looks the request up by the file.
 */
export function carryOver(parent: FormDefinition, values: FormValues, child: FormDefinition): FormValues {
  const types = new Map(parent.fields.map((field) => [field.key, field.type]));
  const carried: FormValues = {};
  for (const field of child.fields) {
    if (field.type === "file" || types.get(field.key) !== field.type) continue;
    const value = values[field.key];
    if (value === undefined || value === null || value === "") continue;
    carried[field.key] = Array.isArray(value) ? [...value] : value;
  }
  return carried;
}
