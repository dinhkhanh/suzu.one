// The order of "My work" (FR-WRK-06): what is late, then what is due soonest, then what matters
// most. Pure, and the same for every kind of task.
import type { IsoDate } from "@/lib/dates";

export type InboxSortable = { dueDate: IsoDate | null; priority: number | null };

/** Overdue first; then by due date, undated last; then by priority (1 = urgent … 4 = low, none last). Stable. */
export function sortInbox<T extends InboxSortable>(items: readonly T[], today: IsoDate): T[] {
  const late = (item: T) => (item.dueDate !== null && item.dueDate < today ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => late(a.item) - late(b.item) || (a.item.dueDate ?? "9999-12-31").localeCompare(b.item.dueDate ?? "9999-12-31") || (a.item.priority ?? 9) - (b.item.priority ?? 9) || a.index - b.index)
    .map(({ item }) => item);
}
