// Cycles (FR-PJM-10): a team's weekly or bi-weekly time boxes. Pure — dates are ISO strings, no
// clock. The team's rule says when the first cycle starts and how many weeks each lasts; cycle N
// is the N-th box from that start, so the numbers never depend on when the job happened to run.
import { addDays, type IsoDate } from "@/lib/dates";

export const CYCLE_WEEKS = [1, 2, 3, 4] as const;

export type CycleWindow = { number: number; startDate: IsoDate; endDate: IsoDate };

const DAY = 86_400_000;
const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export const validCycleWeeks = (weeks: number | null | undefined): weeks is number => typeof weeks === "number" && (CYCLE_WEEKS as readonly number[]).includes(weeks);

/** Cycle `number` (1-based) of a rule. */
export function cycleNumbered(start: IsoDate, weeks: number, number: number): CycleWindow {
  const startDate = addDays(start, (number - 1) * weeks * 7);
  return { number, startDate, endDate: addDays(startDate, weeks * 7 - 1) };
}

/** The cycle a date falls in; null before the first one starts. */
export function cycleAt(start: IsoDate, weeks: number, date: IsoDate): CycleWindow | null {
  if (!validCycleWeeks(weeks) || date < start) return null;
  return cycleNumbered(start, weeks, Math.floor(daysBetween(start, date) / (weeks * 7)) + 1);
}

/**
 * The cycles that should exist on a day: the current one and the next, so a team can plan the
 * next box before it starts. Before the first cycle, only the first. Cycles off = none.
 */
export function cyclesToMake(start: IsoDate | null, weeks: number | null, today: IsoDate): CycleWindow[] {
  if (!start || !validCycleWeeks(weeks)) return [];
  const current = cycleAt(start, weeks, today);
  if (!current) return [cycleNumbered(start, weeks, 1)];
  return [current, cycleNumbered(start, weeks, current.number + 1)];
}

/** A cycle is over once its last day has passed. */
export const cycleEnded = (cycle: Pick<CycleWindow, "endDate">, today: IsoDate): boolean => cycle.endDate < today;

export type CycleTask = { id: string; status: "todo" | "in_progress" | "done" | "cancelled" };

/**
 * The review of a closed cycle: planned = every task still in it at the end except the cancelled
 * ones; done = finished; rolled = still open, which the job moves into the next cycle.
 */
export function cycleSummary(tasks: readonly CycleTask[]): { planned: number; done: number; rolled: number } {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  return { planned: counted.length, done: counted.filter((task) => task.status === "done").length, rolled: counted.filter((task) => task.status === "todo" || task.status === "in_progress").length };
}

/** The open tasks of an ended cycle: they roll into the next one. */
export const rolloverIds = (tasks: readonly CycleTask[]): string[] => tasks.filter((task) => task.status === "todo" || task.status === "in_progress").map((task) => task.id);

/** Progress of the running cycle: done ÷ planned, whole percent; an empty cycle is 0 %. */
export function cycleProgress(tasks: readonly CycleTask[]): { planned: number; done: number; percent: number } {
  const { planned, done } = cycleSummary(tasks);
  return { planned, done, percent: planned === 0 ? 0 : Math.round((done / planned) * 100) };
}

/** Days left in a cycle, today included; 0 once it has ended. */
export const daysLeft = (cycle: Pick<CycleWindow, "endDate">, today: IsoDate): number => Math.max(0, daysBetween(today, cycle.endDate) + 1);
