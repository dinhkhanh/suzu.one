// Close-out (FR-PJM-59): the checklist a project is closed against, computed live, and the final
// report kept on the plan when it closes. Pure: no I/O.
//
// The checklist never blocks the work itself; it blocks the close. A lead may still close with
// items unmet — a client who never signs, a timesheet that will never be approved — but only by
// saying why, and the reason is audited with the close.
import type { IsoDate } from "@/lib/dates";
import type { ProjectBaseline } from "../schema";

export const CLOSE_CHECKS = ["tasks", "register", "acceptance", "timesheets", "billing", "drive", "retro"] as const;
export type CloseCheck = (typeof CLOSE_CHECKS)[number];

export type CloseFacts = {
  /** Tasks neither done nor cancelled. */
  openTasks: number;
  /** Register lines (not cancelled) whose every unit is not yet accepted. */
  openLines: number;
  /**
   * Things on client work still waiting for a signed biên bản nghiệm thu — the owner's decision of
   * 2026-09-23 (Q22): every client project is accepted before it is billed. `null` on internal
   * work, which needs no acceptance and meets the check by having nothing to sign.
   */
  acceptanceWaiting: number | null;
  /** Weeks with time on the project, of people whose team requires approval, not yet approved. */
  unapprovedWeeks: number;
  /** Billing items still waiting for finance. */
  openBillingItems: number;
  driveUrl: string | null;
  retroHeld: boolean;
};

export type ChecklistItem = { key: CloseCheck; met: boolean; /** How many things stand in the way, where that is a count. */ count: number | null };

export function closeChecklist(facts: CloseFacts): ChecklistItem[] {
  return [
    { key: "tasks", met: facts.openTasks === 0, count: facts.openTasks },
    { key: "register", met: facts.openLines === 0, count: facts.openLines },
    { key: "acceptance", met: (facts.acceptanceWaiting ?? 0) === 0, count: facts.acceptanceWaiting },
    { key: "timesheets", met: facts.unapprovedWeeks === 0, count: facts.unapprovedWeeks },
    { key: "billing", met: facts.openBillingItems === 0, count: facts.openBillingItems },
    { key: "drive", met: !!facts.driveUrl?.trim(), count: null },
    { key: "retro", met: facts.retroHeld, count: null },
  ];
}

export const unmetChecks = (checklist: readonly ChecklistItem[]): CloseCheck[] => checklist.filter((item) => !item.met).map((item) => item.key);

/** Why a close is refused: items unmet and no reason given for going ahead anyway. */
export function closeRefusal(checklist: readonly ChecklistItem[], overrideReason: string | null): "close_unmet" | null {
  return unmetChecks(checklist).length > 0 && !overrideReason?.trim() ? "close_unmet" : null;
}

// ── The final report ─────────────────────────────────────────────────────────────────────────

export type CloseReportInput = {
  closedOn: IsoDate;
  baseline: ProjectBaseline | null;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  budgetMinutes: number | null;
  loggedMinutes: number;
  /** Rounds of changes asked for inside the team and by the client; null where nothing records them yet. */
  revisionRounds: { internal: number; client: number } | null;
  /** Hand-offs sent back to the sender; null where nothing records them yet. */
  returnedHandoffs: number | null;
  tasks: readonly { status: string; dueDate: IsoDate | null; completedOn: IsoDate | null }[];
  milestones: readonly { id: string; dueDate: IsoDate | null; doneOn: IsoDate | null }[];
};

export type CloseReport = {
  closedOn: IsoDate;
  dates: { baselineStart: IsoDate | null; baselineDue: IsoDate | null; plannedDue: IsoDate | null; actualStart: IsoDate | null; actualEnd: IsoDate; /** Calendar days the end came after the baseline's due date (negative = early); null without a baseline date. */ slipDays: number | null };
  hours: { budgetMinutes: number | null; loggedMinutes: number; /** logged ÷ budget, whole percent rounded down. */ percent: number | null };
  revisionRounds: { internal: number; client: number } | null;
  returnedHandoffs: number | null;
  /** Tasks done by their due date, of those done that had one. */
  onTime: { due: number; onTime: number; rate: number | null };
  milestones: { total: number; done: number; onTime: number };
};

const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function closeReport(input: CloseReportInput): CloseReport {
  const baselineDue = input.baseline?.dueDate ?? null;
  const done = input.tasks.filter((task) => task.status === "done" && task.dueDate && task.completedOn);
  const onTime = done.filter((task) => task.completedOn! <= task.dueDate!).length;
  // A milestone is judged against its baseline date where one was taken, else its own date.
  const planned = new Map((input.baseline?.milestones ?? []).map((milestone) => [milestone.id, milestone.dueDate]));
  const milestonesDone = input.milestones.filter((milestone) => milestone.doneOn);
  const milestonesOnTime = milestonesDone.filter((milestone) => {
    const due = planned.get(milestone.id) ?? milestone.dueDate;
    return !due || milestone.doneOn! <= due;
  }).length;
  const budget = input.budgetMinutes && input.budgetMinutes > 0 ? input.budgetMinutes : null;
  return {
    closedOn: input.closedOn,
    dates: { baselineStart: input.baseline?.startDate ?? null, baselineDue, plannedDue: input.dueDate, actualStart: input.startDate, actualEnd: input.closedOn, slipDays: baselineDue ? daysBetween(baselineDue, input.closedOn) : null },
    hours: { budgetMinutes: input.budgetMinutes, loggedMinutes: input.loggedMinutes, percent: budget ? Math.floor((input.loggedMinutes / budget) * 100) : null },
    revisionRounds: input.revisionRounds,
    returnedHandoffs: input.returnedHandoffs,
    onTime: { due: done.length, onTime, rate: done.length ? Math.round((onTime / done.length) * 100) : null },
    milestones: { total: input.milestones.length, done: milestonesDone.length, onTime: milestonesOnTime },
  };
}
