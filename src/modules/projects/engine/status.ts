// Project status updates (FR-PJM-27) and milestone reminders (FR-PJM-04). Pure.
//
// "Write once": the facts of an update are prefilled from what was recorded — tasks, milestones,
// hours, the register, the RAID log — and the lead adds only judgement (health, summary, highlights, next steps).
import type { IsoDate } from "@/lib/dates";
import type { StatusFacts } from "../schema";
import { daysBetween, effectiveDate, slipDays } from "./baseline";
import { type RaidFacts, raidCounts } from "./raid";

export const HEALTHS = ["on_track", "at_risk", "off_track"] as const;
export type Health = (typeof HEALTHS)[number];

type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type MilestoneFacts = { id: string; name: string; dueDate: IsoDate | null; doneOn: IsoDate | null; baselineDue: IsoDate | null };

export type FactsInput = {
  today: IsoDate;
  tasks: readonly { status: TaskStatus; dueDate: IsoDate | null }[];
  /** Open blockers on the project's tasks (FR-PJM-28). */
  blocked: number;
  milestones: readonly MilestoneFacts[];
  minutesLogged: number;
  budgetMinutes: number | null;
  register: { accepted: number; promised: number };
  /** The project's RAID log (FR-PJM-29): open high risks and open issues are facts of the update. */
  raid: readonly RaidFacts[];
};

/** The next open milestone: earliest due date first, undated ones last. */
export function nextMilestone(milestones: readonly MilestoneFacts[]): MilestoneFacts | null {
  const open = milestones.filter((milestone) => !milestone.doneOn);
  return [...open].sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))[0] ?? null;
}

export function statusFacts(input: FactsInput): StatusFacts {
  const open = input.tasks.filter((task) => task.status === "todo" || task.status === "in_progress");
  const slips = input.milestones.flatMap((milestone) => {
    const slip = slipDays(milestone.baselineDue, effectiveDate(milestone, input.today));
    return slip === null ? [] : [slip];
  });
  const next = nextMilestone(input.milestones);
  return {
    tasksDone: input.tasks.filter((task) => task.status === "done").length,
    tasksOpen: open.length,
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < input.today).length,
    blocked: input.blocked,
    milestoneSlipDays: slips.length ? Math.max(...slips) : null,
    nextMilestone: next ? { name: next.name, dueDate: next.dueDate } : null,
    minutesLogged: input.minutesLogged,
    budgetMinutes: input.budgetMinutes,
    deliverablesAccepted: input.register.accepted,
    deliverablesPromised: input.register.promised,
    ...raidCounts(input.raid),
  };
}

/**
 * When the next update is due: a cadence after the last one, or — before the first — a cadence
 * after the project went live (its kick-off approval, else when its plan was started). Only a
 * running project owes updates: a planned one has not started, a paused or finished one is quiet.
 */
export function updateDueOn(input: { projectStatus: string; lastUpdateOn: IsoDate | null; since: IsoDate; cadenceDays: number }): IsoDate | null {
  if (input.projectStatus !== "active") return null;
  const from = input.lastUpdateOn ?? input.since;
  const due = new Date(Date.parse(`${from}T00:00:00Z`) + Math.max(1, input.cadenceDays) * 86_400_000);
  return due.toISOString().slice(0, 10);
}

/** Stale = the update is overdue: shown in the portfolio beside the health it last reported. */
export function isStale(input: Parameters<typeof updateDueOn>[0], today: IsoDate): boolean {
  const due = updateDueOn(input);
  return due !== null && due < today;
}

export type MilestoneReminder = "due_soon" | "missed";

/** How many days ahead a milestone owner hears that it is coming. */
export const MILESTONE_LEAD_DAYS = 2;

/**
 * Which reminder a milestone needs today, once each: "due_soon" within the lead days before its
 * date, "missed" the first day after it while still open. `notified` holds what was already sent.
 */
export function milestoneReminder(milestone: { dueDate: IsoDate | null; done: boolean; notified: readonly string[] }, today: IsoDate): MilestoneReminder | null {
  if (milestone.done || !milestone.dueDate) return null;
  const ahead = daysBetween(today, milestone.dueDate);
  if (ahead < 0) return milestone.notified.includes("missed") ? null : "missed";
  if (ahead <= MILESTONE_LEAD_DAYS && !milestone.notified.includes("due_soon")) return "due_soon";
  return null;
}

/** A milestone's progress from its linked tasks: done ÷ (all but cancelled). */
export function linkedProgress(statuses: readonly TaskStatus[]): { done: number; total: number; percent: number | null } {
  const live = statuses.filter((status) => status !== "cancelled");
  const done = live.filter((status) => status === "done").length;
  return { done, total: live.length, percent: live.length ? Math.floor((done / live.length) * 100) : null };
}
