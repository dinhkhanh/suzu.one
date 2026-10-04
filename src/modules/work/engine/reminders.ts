// When the daily job reminds an assignee (FR-WRK-17). Pure.
// Due soon: the day before. Overdue: the day after, then on days 3 and 7, then weekly — often
// enough to be seen, not so often that people switch the category off.
import { addDays } from "@/lib/dates";

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export type ReminderKind = "due_soon" | "overdue";

export function reminderFor(dueDate: string, today: string): ReminderKind | null {
  const late = daysBetween(dueDate, today);
  if (late === -1) return "due_soon";
  if (late === 1 || late === 3 || (late >= 7 && late % 7 === 0)) return "overdue";
  return null;
}

/** How far the person's calendar is read either side of today: a weekend and a holiday behind, a week ahead. */
export const REMINDER_LOOK_BACK = 14;
export const REMINDER_LOOK_AHEAD = 7;

/**
 * The same cadence for a person who is not at work every day: nothing on a day they do not work
 * (`works` — their own calendar less approved leave), and a reminder that would have fallen on
 * such a day is moved, not lost:
 *   · "due soon" comes on their last working day before the due date — Friday for a Monday, the
 *     last day before a leave for something due during it (up to `REMINDER_LOOK_AHEAD` days ahead);
 *   · "overdue" comes on their first working day on or after its day in the cadence — Monday for a
 *     reminder that fell on Saturday, the morning back for one that fell during a leave.
 */
export function reminderOnWorkingDay(dueDate: string, today: string, works: (date: string) => boolean): ReminderKind | null {
  if (!works(today)) return null;
  const late = daysBetween(dueDate, today);
  if (late === 0) return null;
  if (late < 0) {
    if (-late > REMINDER_LOOK_AHEAD) return null;
    for (let day = addDays(today, 1); day < dueDate; day = addDays(day, 1)) if (works(day)) return null;
    return "due_soon";
  }
  // Today's own cadence day, or one that fell on the days off just behind today.
  for (let back = 0; back < REMINDER_LOOK_BACK; back++) {
    const day = addDays(today, -back);
    if (back > 0 && works(day)) return null;
    if (reminderFor(dueDate, day) === "overdue") return "overdue";
  }
  return null;
}
