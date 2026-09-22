// Baselines (FR-PJM-12): the dates and budget a project was approved with, kept at kick-off, and
// how far the current plan has slipped from them. Pure.
import type { IsoDate } from "@/lib/dates";
import type { ProjectBaseline } from "../schema";

const DAY = 86_400_000;
export const daysBetween = (from: IsoDate, to: IsoDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export type PlanDates = { startDate: IsoDate | null; dueDate: IsoDate | null; budgetMinutes: number | null; milestones: readonly { id: string; dueDate: IsoDate | null }[] };

export function takeBaseline(plan: PlanDates, takenAt: Date): ProjectBaseline {
  return { startDate: plan.startDate, dueDate: plan.dueDate, budgetMinutes: plan.budgetMinutes, milestones: plan.milestones.map(({ id, dueDate }) => ({ id, dueDate })), takenAt: takenAt.toISOString() };
}

/** Days later than planned (negative = earlier); null when either side has no date. */
export const slipDays = (baseline: IsoDate | null | undefined, current: IsoDate | null | undefined): number | null => (baseline && current ? daysBetween(baseline, current) : null);

/**
 * The date a milestone stands at today: when it was done, else its due date — or today, once the
 * due date has passed and it is still open (an overdue milestone keeps slipping every day).
 */
export function effectiveDate(milestone: { dueDate: IsoDate | null; doneOn: IsoDate | null }, today: IsoDate): IsoDate | null {
  if (milestone.doneOn) return milestone.doneOn;
  if (!milestone.dueDate) return null;
  return milestone.dueDate < today ? today : milestone.dueDate;
}

export type Slip = {
  startSlipDays: number | null;
  dueSlipDays: number | null;
  budgetDeltaMinutes: number | null;
  milestones: { id: string; slipDays: number | null }[];
  /** The worst milestone slip; null when no milestone can be compared. */
  worstMilestoneSlipDays: number | null;
};

export function baselineSlip(baseline: ProjectBaseline | null, current: { startDate: IsoDate | null; dueDate: IsoDate | null; budgetMinutes: number | null; milestones: readonly { id: string; dueDate: IsoDate | null; doneOn: IsoDate | null }[] }, today: IsoDate): Slip | null {
  if (!baseline) return null;
  const planned = new Map(baseline.milestones.map((milestone) => [milestone.id, milestone.dueDate]));
  const milestones = current.milestones.map((milestone) => ({ id: milestone.id, slipDays: planned.has(milestone.id) ? slipDays(planned.get(milestone.id), effectiveDate(milestone, today)) : null }));
  const compared = milestones.flatMap((milestone) => (milestone.slipDays === null ? [] : [milestone.slipDays]));
  return {
    startSlipDays: slipDays(baseline.startDate, current.startDate),
    dueSlipDays: slipDays(baseline.dueDate, current.dueDate),
    budgetDeltaMinutes: baseline.budgetMinutes !== null && current.budgetMinutes !== null ? current.budgetMinutes - baseline.budgetMinutes : null,
    milestones,
    worstMilestoneSlipDays: compared.length ? Math.max(...compared) : null,
  };
}

/** A slip as the screens say it: how many days, and which way. */
export const slipWords = (days: number): { days: number; direction: "late" | "early" | "on_time" } => ({ days: Math.abs(days), direction: days > 0 ? "late" : days < 0 ? "early" : "on_time" });

// ── Task baselines (FR-PJM-12) ──────────────────────────────────────────────────────────────

export type TaskDates = { taskId: string; startDate: IsoDate | null; dueDate: IsoDate | null };
export type TaskBaseline = { taskId: string; baselineStart: IsoDate | null; baselineDue: IsoDate | null };

/** Every task's baseline is simply its dates at the moment the baseline is taken. */
export const takeTaskBaselines = (tasks: readonly TaskDates[]): TaskBaseline[] => tasks.map((task) => ({ taskId: task.taskId, baselineStart: task.startDate, baselineDue: task.dueDate }));

export type TaskSlip = { taskId: string; slipDays: number | null };

/**
 * A task's slip is its due date against its baseline due date — or, while it is still open past
 * that due date, today (like a milestone, overdue work keeps slipping). Done or cancelled work
 * compares its due date as it was left.
 */
export function taskSlip(task: { taskId: string; dueDate: IsoDate | null; baselineDue: IsoDate | null; open: boolean }, today: IsoDate): TaskSlip {
  const current = task.open && task.dueDate && task.dueDate < today ? today : task.dueDate;
  return { taskId: task.taskId, slipDays: slipDays(task.baselineDue, current) };
}

export type SlipSummary = {
  /** Tasks with both a baseline and a current date. */
  compared: number;
  late: number;
  early: number;
  onTime: number;
  /** The task that slipped the most; null when none is late. */
  worst: { taskId: string; slipDays: number } | null;
};

export function slipSummary(slips: readonly TaskSlip[]): SlipSummary {
  const summary: SlipSummary = { compared: 0, late: 0, early: 0, onTime: 0, worst: null };
  for (const slip of slips) {
    if (slip.slipDays === null) continue;
    summary.compared += 1;
    if (slip.slipDays > 0) summary.late += 1;
    else if (slip.slipDays < 0) summary.early += 1;
    else summary.onTime += 1;
    if (slip.slipDays > 0 && (!summary.worst || slip.slipDays > summary.worst.slipDays)) summary.worst = { taskId: slip.taskId, slipDays: slip.slipDays };
  }
  return summary;
}
