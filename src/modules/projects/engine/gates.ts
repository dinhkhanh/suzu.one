// The gates a project's status passes through (FR-PJM-03, 59), and what is locked once it has
// passed them (FR-PJM-11). Pure: no I/O.
//
// A project of client work (`isClientWork`) becomes Active only through its kick-off — the approved
// brief — and Done only through its close-out; the project header may pause it, plan it again or
// archive it, never walk it past either gate. An internal project and a pitch change status freely.
// A closed project, of any kind, stays closed until it is re-opened on purpose: its status may not
// leave Done by hand, it comes back from the archive still closed, and it takes no new work.
//
// After the kick-off the plan's commercial figures — the register's lines and quantities, the hours
// budget, the fee — are the baseline the client agreed to, and change only through change requests,
// so that original + change requests = current stays true.
import { isClientWork } from "./brief";

/** The work module's status categories (`PROJECT_STATUSES`), named here so the engine imports nothing. */
export type StatusCategory = "planned" | "active" | "paused" | "done" | "archived";

export type GateFacts = { kind: string; briefApproved: boolean; closed: boolean };

export type StatusRefusal = "project_closed_reopen" | "project_needs_kickoff" | "project_needs_closeout";

/** Why a status change by hand is refused; null = it may happen. */
export function statusRefusal(facts: GateFacts, move: { from: string; to: string }): StatusRefusal | null {
  if (move.from === move.to) return null;
  // Closed: done, or shelved in the archive — anything else is re-opening, which has its own door.
  if (facts.closed) return move.to === "done" || move.to === "archived" ? null : "project_closed_reopen";
  if (!isClientWork(facts.kind)) return null;
  if (move.to === "active" && !facts.briefApproved) return "project_needs_kickoff";
  if (move.to === "done") return "project_needs_closeout";
  return null;
}

/**
 * Where a project returns to from the archive: closed if it was closed, planned if it has yet to
 * pass its kick-off, active otherwise. Un-archiving never re-opens and never kicks off.
 */
export function restoredStatus(facts: GateFacts): StatusCategory {
  if (facts.closed) return "done";
  return isClientWork(facts.kind) && !facts.briefApproved ? "planned" : "active";
}

/** The categories the header's status control may offer for this project, the current one included. */
export function offeredStatuses(facts: GateFacts, current: string, categories: readonly string[]): string[] {
  return categories.filter((to) => to === current || statusRefusal(facts, { from: current, to }) === null);
}

// ── The scope lock (FR-PJM-11) ──────────────────────────────────────────────────────────────

/** After the kick-off the baseline is taken: scope, hours and fee change through change requests. */
export const scopeLocked = (plan: { briefStatus: string }): boolean => plan.briefStatus === "approved";

export type LineScope = { quantity: number; format: string | null; channel: string | null };

/**
 * What of a register line is the promise — quantity × format × channel (FR-PJM-05) — and so needs a
 * change request after the kick-off. Its wording, its due date, its milestone, its place in the
 * list and the tasks linked to it are how the promise is kept, not what it is: they stay direct.
 */
export const lineScopeChanged = (before: LineScope, after: LineScope): boolean => before.quantity !== after.quantity || (before.format ?? null) !== (after.format ?? null) || (before.channel ?? null) !== (after.channel ?? null);

export type MonthlyQuota = { lines: readonly { title: string; quantity: number; format: string | null; channel: string | null }[]; minutesPerMonth: number | null; feePerMonthVnd?: number | null };

const sameLines = (a: MonthlyQuota["lines"], b: MonthlyQuota["lines"]): boolean =>
  a.length === b.length &&
  a.every((line, index) => line.title.trim() === b[index].title.trim() && line.quantity === b[index].quantity && (line.format ?? null) === (b[index].format ?? null) && (line.channel ?? null) === (b[index].channel ?? null));

/**
 * What of a retainer's terms is its monthly scope: the quota lines, the hours allowance and — when
 * the caller writes it at all — the monthly fee. The months it runs, the rollover rule and whether
 * it is active are not scope.
 */
export const monthlyQuotaChanged = (before: MonthlyQuota, after: MonthlyQuota): boolean =>
  !sameLines(before.lines, after.lines) || (before.minutesPerMonth ?? null) !== (after.minutesPerMonth ?? null) || (after.feePerMonthVnd !== undefined && (before.feePerMonthVnd ?? null) !== (after.feePerMonthVnd ?? null));
