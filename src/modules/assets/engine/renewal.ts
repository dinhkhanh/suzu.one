// When a subscription next falls due (FR-AST-05). Pure, and deliberately dull: the only
// interesting part is that a licence whose stored renewal date is years in the past must still
// produce the *next* renewal rather than a backlog of every one it has ever had.
import type { IsoDate } from "@/lib/dates";

/**
 * Adds months to a date, clamping the day to the end of the shorter month.
 *
 * A subscription renewed on the 31st renews on the 30th in a 30-day month and on the 28th in
 * February — it does not roll into the next month, which is what naive date arithmetic does and
 * which would silently move a bill by a day or three every year.
 */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const total = (year * 12 + (month - 1)) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = total % 12;
  // Day 0 of the month after is the last day of the month we want.
  const lastDay = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${String(newYear).padStart(4, "0")}-${String(newMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** Guards against a runaway walk if a licence is somehow dated in the far past. */
const MAX_STEPS = 600;

/**
 * Every renewal date on or after `from` and on or before `to`, walking the cycle from `anchor`.
 * An anchor after the window still yields its own date when it falls inside it.
 */
export function renewalsBetween(anchor: IsoDate, cycleMonths: number, from: IsoDate, to: IsoDate): IsoDate[] {
  if (cycleMonths <= 0 || from > to) return [];
  let cursor = anchor;
  // Skip forward in whole cycles until we reach the window; a past-dated licence costs a few
  // iterations, not a backlog.
  for (let step = 0; cursor < from && step < MAX_STEPS; step++) cursor = addMonthsClamped(cursor, cycleMonths);
  const dates: IsoDate[] = [];
  for (let step = 0; cursor <= to && step < MAX_STEPS; step++) {
    dates.push(cursor);
    cursor = addMonthsClamped(cursor, cycleMonths);
  }
  return dates;
}
