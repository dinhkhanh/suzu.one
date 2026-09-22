// The delivery dashboards (FR-PJM-60). Pure: the service reads each visible project's counts in
// SQL (one GROUP BY per figure) and these functions add them up — for the whole scope and for each
// team — into the rates the screen shows. Adding up happens here, not in SQL, because a rate over
// many projects is the sum of the parts divided once (never an average of averages), and that rule
// is the thing worth a golden test.
//
// Definitions:
//  - health: the latest status update's health; "stale" when the update is overdue (FR-PJM-27).
//  - milestone slip: a milestone whose date moved past its baseline date (FR-PJM-12); overdue =
//    not done and its date has passed.
//  - on-time delivery: tasks completed in the period with a due date, completed on or before it.
//  - accepted vs promised: the deliverables register (FR-PJM-05), accepted units ÷ promised units.
//  - hours burn: logged minutes against the hours budget, over the projects that have a budget.
//  - revision rounds: "changes required" decisions in the period, internal and client apart (FR-PJM-51).
//  - hand-offs: stage and cross-team hand-offs created in the period; returned ones; the mean wait
//    from sending to an answer, over the answered ones (FR-PJM-41).
//  - blocked time: minutes tasks spent blocked inside the period (FR-PJM-28).
//  - compliance: required EOD reports submitted, due timesheet weeks submitted (FR-PJM-22, 25).

export type Health = "on_track" | "at_risk" | "off_track";

export type MilestoneCounts = { total: number; baselined: number; slipped: number; slipDays: number; overdue: number };
export type OnTimeCounts = { completed: number; dated: number; onTime: number };
export type RevisionCounts = { reviewedTasks: number; internalRounds: number; clientRounds: number };
export type HandoffCounts = { total: number; returned: number; pending: number; answered: number; waitMinutes: number };
export type BlockedCounts = { blockers: number; open: number; blockedMinutes: number };
export type BurnCounts = { loggedMinutes: number; budgetMinutes: number | null; level: "none" | "ok" | "warning" | "over" };

/** Everything counted for one project the viewer may open. */
export type ProjectDeliveryFacts = {
  projectId: string;
  teamId: string;
  health: Health | null;
  stale: boolean;
  milestones: MilestoneCounts;
  onTime: OnTimeCounts;
  register: { promised: number; accepted: number };
  burn: BurnCounts;
  revisions: RevisionCounts;
  handoffs: HandoffCounts;
  blocked: BlockedCounts;
};

export const EMPTY_MILESTONES: MilestoneCounts = { total: 0, baselined: 0, slipped: 0, slipDays: 0, overdue: 0 };
export const EMPTY_ON_TIME: OnTimeCounts = { completed: 0, dated: 0, onTime: 0 };
export const EMPTY_REVISIONS: RevisionCounts = { reviewedTasks: 0, internalRounds: 0, clientRounds: 0 };
export const EMPTY_HANDOFFS: HandoffCounts = { total: 0, returned: 0, pending: 0, answered: 0, waitMinutes: 0 };
export const EMPTY_BLOCKED: BlockedCounts = { blockers: 0, open: 0, blockedMinutes: 0 };

/** part ÷ whole, or null when there is no whole: "no data" must not read as 0 %. */
export const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const round1 = (value: number) => Math.round(value * 10) / 10;

export type DeliverySummary = {
  projects: number;
  health: Record<Health | "none", number> & { stale: number };
  milestones: MilestoneCounts & { slipRate: number | null; averageSlipDays: number | null };
  onTime: OnTimeCounts & { late: number; rate: number | null };
  register: { promised: number; accepted: number; rate: number | null };
  burn: { budgeted: number; loggedMinutes: number; budgetMinutes: number; loggedOnBudgeted: number; rate: number | null; warning: number; over: number };
  revisions: RevisionCounts & { internalPerTask: number | null; clientPerTask: number | null };
  handoffs: HandoffCounts & { returnRate: number | null; averageWaitMinutes: number | null };
  blocked: BlockedCounts & { blockedHours: number; averageHoursPerBlocker: number | null };
};

const sum = <Row>(rows: readonly Row[], pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);

export function summariseDelivery(facts: readonly ProjectDeliveryFacts[]): DeliverySummary {
  const health = { on_track: 0, at_risk: 0, off_track: 0, none: 0, stale: 0 };
  for (const project of facts) {
    health[project.health ?? "none"] += 1;
    if (project.stale) health.stale += 1;
  }

  const milestones: MilestoneCounts = { total: sum(facts, (row) => row.milestones.total), baselined: sum(facts, (row) => row.milestones.baselined), slipped: sum(facts, (row) => row.milestones.slipped), slipDays: sum(facts, (row) => row.milestones.slipDays), overdue: sum(facts, (row) => row.milestones.overdue) };
  const onTime: OnTimeCounts = { completed: sum(facts, (row) => row.onTime.completed), dated: sum(facts, (row) => row.onTime.dated), onTime: sum(facts, (row) => row.onTime.onTime) };
  const register = { promised: sum(facts, (row) => row.register.promised), accepted: sum(facts, (row) => row.register.accepted) };

  // Burn only means something against a budget: projects without one add their hours to the total
  // logged, and nothing to the rate.
  const budgeted = facts.filter((row) => row.burn.budgetMinutes !== null && row.burn.budgetMinutes > 0);
  const budgetMinutes = sum(budgeted, (row) => row.burn.budgetMinutes ?? 0);
  const loggedOnBudgeted = sum(budgeted, (row) => row.burn.loggedMinutes);

  const revisions: RevisionCounts = { reviewedTasks: sum(facts, (row) => row.revisions.reviewedTasks), internalRounds: sum(facts, (row) => row.revisions.internalRounds), clientRounds: sum(facts, (row) => row.revisions.clientRounds) };
  const handoffs: HandoffCounts = { total: sum(facts, (row) => row.handoffs.total), returned: sum(facts, (row) => row.handoffs.returned), pending: sum(facts, (row) => row.handoffs.pending), answered: sum(facts, (row) => row.handoffs.answered), waitMinutes: sum(facts, (row) => row.handoffs.waitMinutes) };
  const blocked: BlockedCounts = { blockers: sum(facts, (row) => row.blocked.blockers), open: sum(facts, (row) => row.blocked.open), blockedMinutes: sum(facts, (row) => row.blocked.blockedMinutes) };
  const perTask = (rounds: number) => (revisions.reviewedTasks > 0 ? round1(rounds / revisions.reviewedTasks) : null);

  return {
    projects: facts.length,
    health,
    milestones: { ...milestones, slipRate: rate(milestones.slipped, milestones.baselined), averageSlipDays: milestones.slipped > 0 ? round1(milestones.slipDays / milestones.slipped) : null },
    onTime: { ...onTime, late: onTime.dated - onTime.onTime, rate: rate(onTime.onTime, onTime.dated) },
    register: { ...register, rate: rate(register.accepted, register.promised) },
    burn: { budgeted: budgeted.length, loggedMinutes: sum(facts, (row) => row.burn.loggedMinutes), budgetMinutes, loggedOnBudgeted, rate: rate(loggedOnBudgeted, budgetMinutes), warning: facts.filter((row) => row.burn.level === "warning").length, over: facts.filter((row) => row.burn.level === "over").length },
    revisions: { ...revisions, internalPerTask: perTask(revisions.internalRounds), clientPerTask: perTask(revisions.clientRounds) },
    handoffs: { ...handoffs, returnRate: rate(handoffs.returned, handoffs.total), averageWaitMinutes: handoffs.answered > 0 ? Math.round(handoffs.waitMinutes / handoffs.answered) : null },
    blocked: { ...blocked, blockedHours: round1(blocked.blockedMinutes / 60), averageHoursPerBlocker: blocked.blockers > 0 ? round1(blocked.blockedMinutes / 60 / blocked.blockers) : null },
  };
}

// ── Compliance (FR-PJM-22, 25) ──────────────────────────────────────────────────────────────

export type Compliance = { due: number; met: number; rate: number | null };

/** EOD reports: of the days a report was required, how many had one submitted. */
export function reportCompliance(days: readonly { required: boolean; submitted: boolean }[]): Compliance {
  const due = days.filter((day) => day.required);
  const met = due.filter((day) => day.submitted).length;
  return { due: due.length, met, rate: rate(met, due.length) };
}

/**
 * Timesheets: a week is due from someone whose team asks for timesheets, once the week is over,
 * unless every day of it was a day off; it is met when submitted or approved. A returned week is
 * not met — it is back with the person.
 */
export function timesheetCompliance(weeks: readonly { due: boolean; submitted: boolean }[]): Compliance {
  return reportCompliance(weeks.map((week) => ({ required: week.due, submitted: week.submitted })));
}

/** Adds compliance figures of several people or teams: sums first, one division at the end. */
export const addCompliance = (parts: readonly Compliance[]): Compliance => {
  const due = sum(parts, (part) => part.due);
  const met = sum(parts, (part) => part.met);
  return { due, met, rate: rate(met, due) };
};

// ── Retainers (FR-PJM-06) ───────────────────────────────────────────────────────────────────

export type RetainerFacts = { projectId: string; contracted: number; delivered: number; minutesAllowance: number | null; minutesLogged: number };
export type RetainerSummary = { retainers: number; contracted: number; delivered: number; consumption: number | null; overserviced: number; nearLimit: number; hours: { allowanceMinutes: number; loggedMinutes: number; rate: number | null } };

/** Overservicing = delivered ÷ contracted; a retainer at ≥ 100 % is overserviced, from 80 % it is near the limit. */
export function summariseRetainers(rows: readonly RetainerFacts[]): RetainerSummary {
  const consumption = (row: RetainerFacts) => rate(row.delivered, row.contracted) ?? 0;
  const withHours = rows.filter((row) => row.minutesAllowance !== null && row.minutesAllowance > 0);
  const allowanceMinutes = sum(withHours, (row) => row.minutesAllowance ?? 0);
  const loggedMinutes = sum(withHours, (row) => row.minutesLogged);
  return {
    retainers: rows.length,
    contracted: sum(rows, (row) => row.contracted),
    delivered: sum(rows, (row) => row.delivered),
    consumption: rate(sum(rows, (row) => row.delivered), sum(rows, (row) => row.contracted)),
    overserviced: rows.filter((row) => consumption(row) >= 1 || (row.minutesAllowance !== null && row.minutesAllowance > 0 && row.minutesLogged > row.minutesAllowance)).length,
    nearLimit: rows.filter((row) => consumption(row) >= 0.8 && consumption(row) < 1).length,
    hours: { allowanceMinutes, loggedMinutes, rate: rate(loggedMinutes, allowanceMinutes) },
  };
}

/** Minutes of a blocker that fall inside [from, to), the open one counted up to `now`. */
export function blockedMinutesWithin(blocker: { raisedAt: Date; resolvedAt: Date | null }, from: Date, to: Date, now: Date): number {
  const start = Math.max(blocker.raisedAt.getTime(), from.getTime());
  const end = Math.min((blocker.resolvedAt ?? now).getTime(), to.getTime(), now.getTime());
  return end > start ? Math.round((end - start) / 60_000) : 0;
}
