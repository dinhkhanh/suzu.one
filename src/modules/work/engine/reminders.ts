// When the daily job reminds an assignee (FR-WRK-17). Pure.
// Due soon: the day before. Overdue: the day after, then on days 3 and 7, then weekly — often
// enough to be seen, not so often that people switch the category off.
const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export type ReminderKind = "due_soon" | "overdue";

export function reminderFor(dueDate: string, today: string): ReminderKind | null {
  const late = daysBetween(dueDate, today);
  if (late === -1) return "due_soon";
  if (late === 1 || late === 3 || (late >= 7 && late % 7 === 0)) return "overdue";
  return null;
}
