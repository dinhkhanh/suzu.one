// The money ceilings on the assistant (SRS D35, FR-AGT-40, 41). Pure: the bands, the windows and
// the verdict, with no database and no clock of its own.
//
// Two ceilings are checked before every call to a model:
//  - THE MONTH: what the whole company's assistant has cost since the 1st, Vietnamese time, against
//    the monthly budget. Spent = nobody's question reaches a model until the next month.
//  - THE DAY: what this person's questions and drafts have cost since midnight, Vietnamese time,
//    against the allowance of their band. Spent = their questions go the free way until tomorrow.
// Both are checked against what was spent BEFORE the call: the call that crosses the line is let
// through, and the next one is not. A ceiling can therefore be passed by the calls already running
// when it was reached (NFR-AGT-02), and by no more.
//
// When a ceiling refuses, the caller falls back to the free path (Phase 9's quoted passages and the
// extractive drafts). Nothing here ever makes the assistant fail; it only makes it cheaper.
import { can, type Principal } from "@/modules/platform/rbac/policy";
import type { Role } from "@/modules/platform/rbac/roles";

/**
 * Who costs how much a day (D35): everybody; the people who lead work; the office that reads
 * the company's figures — HR, payroll, finance, directors, C-level and the owner.
 */
export const AI_BANDS = ["everyone", "lead", "office"] as const;
export type AiBand = (typeof AI_BANDS)[number];

const OFFICE_ROLES: ReadonlySet<Role> = new Set<Role>(["owner", "c_level", "entity_director", "hr_admin", "hr_staff", "payroll", "finance"]);

/**
 * The band of a person. `leadsWork` is whether they lead a team or a project, or are a project's
 * account manager — rows, not roles, so the caller reads them (the work viewer already holds them).
 */
export function bandOf(principal: Principal, leadsWork: boolean): AiBand {
  if (principal.grants.some((grant) => OFFICE_ROLES.has(grant.role))) return "office";
  if (leadsWork || can(principal, "work:manage")) return "lead";
  return "everyone";
}

export type AiBudget = { monthMicroUsd: number; dayMicroUsd: Readonly<Record<AiBand, number>> };

export type BudgetVerdict = { ok: true } | { ok: false; reason: "month" | "day" };

/** Whether one more call may go to a model, given what was spent before it. */
export function budgetVerdict(spent: { monthMicroUsd: number; dayMicroUsd: number }, band: AiBand, budget: AiBudget): BudgetVerdict {
  // The month first: when both are spent, "the company's budget is spent" is the true answer.
  if (spent.monthMicroUsd >= budget.monthMicroUsd) return { ok: false, reason: "month" };
  if (spent.dayMicroUsd >= budget.dayMicroUsd[band]) return { ok: false, reason: "day" };
  return { ok: true };
}

/** The share of the month at which the owner is told (FR-AGT-40). */
export const MONTH_WARNING_SHARE = 0.8;

/** Whether this call carried the month across the warning line — true for exactly one call a month. */
export function crossedMonthWarning(beforeMicroUsd: number, afterMicroUsd: number, budgetMicroUsd: number): boolean {
  const line = budgetMicroUsd * MONTH_WARNING_SHARE;
  return budgetMicroUsd > 0 && beforeMicroUsd < line && afterMicroUsd >= line;
}

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Midnight in Vietnam on the day `at` falls in, as an instant. */
export function vietnamDayStart(at: Date): Date {
  const local = new Date(at.getTime() + VIETNAM_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VIETNAM_OFFSET_MS);
}

/** Midnight in Vietnam on the 1st of the month `at` falls in, as an instant. */
export function vietnamMonthStart(at: Date): Date {
  const local = new Date(at.getTime() + VIETNAM_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VIETNAM_OFFSET_MS);
}
