// Leave cover (FR-PJM-44). Pure: the service reads the leave request's counted days, the person's
// open work and bookings; these functions say whether a cover plan is asked for and what goes in it.
import { addDays, type IsoDate } from "@/lib/dates";
import { occurrencesBetween, type RecurrenceRule } from "./recurrence";

export const COVER_ITEM_TYPES = ["task", "review", "recurrence", "booking"] as const;
export type CoverItemType = (typeof COVER_ITEM_TYPES)[number];

/** draft → submitted → handed_back; cancelled when the leave is called off. */
export const COVER_PLAN_STATUSES = ["draft", "submitted", "handed_back", "cancelled"] as const;
export type CoverPlanStatus = (typeof COVER_PLAN_STATUSES)[number];

/** The working days a leave request counts (the leave module leaves rest days and holidays out); a half day counts half. */
export const workingDaysOf = (days: readonly { amountCenti: number }[]): number => days.reduce((sum, day) => sum + day.amountCenti, 0) / 100;

/** A plan is asked for from `minDays` working days of absence (per team, default 2). */
export const needsCover = (workingDays: number, minDays: number): boolean => workingDays > 0 && workingDays >= Math.max(1, minDays);

export type Absence = { from: IsoDate; to: IsoDate };

export type CoverCandidates = {
  /** The person's open tasks (assignee). */
  tasks: readonly { id: string; dueDate: IsoDate | null; startDate: IsoDate | null }[];
  /** Deliverables waiting for the person's decision, by task. */
  reviews: readonly { taskId: string }[];
  /** Active recurrences whose occurrences are assigned to the person. */
  recurrences: readonly { id: string; rule: RecurrenceRule; startDate: IsoDate; endDate: IsoDate | null }[];
  /** The person's bookings, by week (Monday). */
  bookings: readonly { id: string; weekStart: IsoDate }[];
};

export type CoverSelection = { itemType: CoverItemType; itemId: string }[];

const within = (date: IsoDate | null, absence: Absence) => !!date && date >= absence.from && date <= absence.to;

/**
 * What falls in the absence: tasks due in it — or already running when it starts and due after it
 * (work that cannot wait for the person); every review waiting for the person (someone must decide
 * while they are away); recurrences with an occurrence in it; bookings in the weeks it touches.
 */
export function selectCoverItems(candidates: CoverCandidates, absence: Absence): CoverSelection {
  const tasks = candidates.tasks.filter((task) => within(task.dueDate, absence) || (!!task.dueDate && task.dueDate > absence.to && !!task.startDate && task.startDate <= absence.to));
  const reviews = [...new Set(candidates.reviews.map((review) => review.taskId))];
  const recurrences = candidates.recurrences.filter((recurrence) => {
    const to = recurrence.endDate && recurrence.endDate < absence.to ? recurrence.endDate : absence.to;
    return occurrencesBetween(recurrence.rule, recurrence.startDate, absence.from, to, 1).length > 0;
  });
  const bookings = candidates.bookings.filter((booking) => booking.weekStart <= absence.to && addDays(booking.weekStart, 6) >= absence.from);
  return [
    ...tasks.map((task) => ({ itemType: "task" as const, itemId: task.id })),
    ...reviews.map((taskId) => ({ itemType: "review" as const, itemId: taskId })),
    ...recurrences.map((recurrence) => ({ itemType: "recurrence" as const, itemId: recurrence.id })),
    ...bookings.map((booking) => ({ itemType: "booking" as const, itemId: booking.id })),
  ];
}

/**
 * Reconciles a draft with a fresh selection: what is still relevant stays (with the cover already
 * named), what is new is added, and what dropped out goes — unless somebody already named a cover
 * for it, in which case the person decides (they may still want it covered).
 */
export function reconcileItems<Item extends { itemType: string; itemId: string; coverPersonId: string | null }>(current: readonly Item[], fresh: CoverSelection): { add: CoverSelection; remove: Item[] } {
  const keyOf = (item: { itemType: string; itemId: string }) => `${item.itemType}:${item.itemId}`;
  const have = new Set(current.map(keyOf));
  const wanted = new Set(fresh.map(keyOf));
  return { add: fresh.filter((item) => !have.has(keyOf(item))), remove: current.filter((item) => !wanted.has(keyOf(item)) && !item.coverPersonId) };
}

/** Covers named per item, or the one for all; an item without either is not covered. */
export function coverOf(item: { coverPersonId: string | null }, defaultCoverPersonId: string | null): string | null {
  return item.coverPersonId ?? defaultCoverPersonId;
}

/** A booking is information for the cover (and the project lead), not a duty that moves: bookings are never reassigned. */
export const movesOnCover = (itemType: CoverItemType): boolean => itemType !== "booking";

/** When the reassignment happens: on the first day of the leave, or at once if it has started. */
export const coverStartsOn = (absence: Absence, today: IsoDate): boolean => absence.from <= today;
