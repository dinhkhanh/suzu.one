// The content calendar (FR-WRK-05). The month grid itself is shared: src/lib/month-grid.ts.
export { isMonthKey, type MonthGrid, monthGrid, shiftMonth } from "@/lib/month-grid";

/** Tasks per due date: urgent first, then unprioritised, then by title — a stable order for a cell. */
export function placeByDueDate<Task extends { dueDate: string | null; priority: number | null; title: string }>(tasks: readonly Task[]): Map<string, Task[]> {
  const byDate = new Map<string, Task[]>();
  for (const task of tasks) if (task.dueDate) byDate.set(task.dueDate, [...(byDate.get(task.dueDate) ?? []), task]);
  for (const own of byDate.values()) own.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title));
  return byDate;
}
