// When a person is reminded to check in: a few minutes after the start of their working day, if no
// check-in has arrived — they may be at their desk and simply have forgotten. Pure: the job
// (`../checkin-reminders.ts`) reads the day plans, leave, requests and punches and asks this.
import type { DayPlan } from "./calendar";
import { instantOf } from "./merge";

/** Minutes after the planned start the reminder goes out. */
export const REMIND_AFTER_MINUTES = 5;
/** Past this many minutes after the start no reminder goes out: a missed trigger must not nag at noon. */
export const REMIND_UNTIL_MINUTES = 120;
/** A check-in this long before the start still counts as today's: people come in early. */
export const EARLY_CHECK_IN_MINUTES = 240;

export type ReminderLeave = { portion: "full" | "am" | "pm" | "hours" };
export type ReminderRemote = { portion: "full" | "am" | "pm"; requiresPunch: boolean };

/**
 * The instant the person is expected to check in on the plan's date, or null when the day asks for
 * no check-in: not a tracked working day (rest, holiday, untracked Saturday, unscheduled), or the
 * morning is off — full-day or morning leave, leave by the hour (whose hours the plan does not
 * place), or working from home or travelling for the morning. Afternoon leave changes nothing: the
 * morning still starts on time. A flexible day's check-in is due at the start of its core hours.
 */
export function expectedCheckIn(plan: Pick<DayPlan, "date" | "kind" | "segments">, leave: readonly ReminderLeave[], remote: readonly ReminderRemote[]): number | null {
  if (plan.kind !== "working" || plan.segments.length === 0) return null;
  if (leave.some((item) => item.portion !== "pm")) return null;
  if (remote.some((item) => !item.requiresPunch && item.portion !== "pm")) return null;
  return instantOf(plan.date, Math.min(...plan.segments.map((segment) => segment.start)));
}

/** Whether `now` falls in the reminder window of a check-in expected at `expected`. */
export function reminderDue(expected: number, now: number): boolean {
  return now >= expected + REMIND_AFTER_MINUTES * 60_000 && now < expected + REMIND_UNTIL_MINUTES * 60_000;
}

/** From when a punch counts as the check-in expected at `expected`. */
export const checkInCountsFrom = (expected: number): number => expected - EARLY_CHECK_IN_MINUTES * 60_000;
