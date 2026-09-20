// The list's filters and grouping, in memory: the project's tasks are already in the browser, so
// every keystroke answers at once (FR-WRK-05, FR-WRK-12). Pure; shared by list, board and calendar.
import { toSearchKey } from "@/lib/text";

export type FilterableTask = {
  id: string;
  key: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "cancelled";
  stateId: string;
  priority: number | null;
  assigneePersonId: string | null;
  dueDate: string | null;
  clientId: string | null;
  labelIds: readonly string[];
  parentTaskId: string | null;
};

/** URL parameters, as they are: `assignee` is a person id, "me" or "none"; `due` is "overdue" | "week" | "none". */
export type TaskFilters = { q?: string; assignee?: string; state?: string; priority?: string; label?: string; client?: string; due?: string; closed?: string };
export const FILTER_KEYS = ["q", "assignee", "state", "priority", "label", "client", "due", "closed"] as const;
export const GROUPINGS = ["none", "status", "assignee", "client"] as const;
export type Grouping = (typeof GROUPINGS)[number];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function filterTasks<Task extends FilterableTask>(tasks: readonly Task[], filters: TaskFilters, context: { selfId: string | null; today: string }): Task[] {
  const words = toSearchKey(filters.q ?? "").split(" ").filter(Boolean);
  const weekEnd = addDays(context.today, 7);
  return tasks.filter((task) => {
    const open = task.status === "todo" || task.status === "in_progress";
    // Closed tasks stay out of the way unless asked for — or unless the filter names their state.
    if (!open && filters.closed !== "1" && !filters.state) return false;
    if (filters.state && task.stateId !== filters.state) return false;
    if (filters.assignee) {
      const wanted = filters.assignee === "me" ? context.selfId : filters.assignee === "none" ? null : filters.assignee;
      if (task.assigneePersonId !== wanted) return false;
    }
    if (filters.priority && String(task.priority ?? "none") !== filters.priority) return false;
    if (filters.label && !task.labelIds.includes(filters.label)) return false;
    if (filters.client && (filters.client === "none" ? task.clientId !== null : task.clientId !== filters.client)) return false;
    if (filters.due === "overdue" && !(open && task.dueDate !== null && task.dueDate < context.today)) return false;
    if (filters.due === "week" && !(task.dueDate !== null && task.dueDate >= context.today && task.dueDate <= weekEnd)) return false;
    if (filters.due === "none" && task.dueDate !== null) return false;
    if (words.length) {
      const haystack = `${task.key.toLowerCase()} ${toSearchKey(task.title)}`;
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

export type TaskGroup<Task> = { key: string; tasks: Task[] };

/** Groups keep the order given by `order` (state order, people by name…); keys not listed go last. */
export function groupTasks<Task extends FilterableTask>(tasks: readonly Task[], grouping: Grouping, order: readonly string[]): TaskGroup<Task>[] {
  if (grouping === "none") return [{ key: "all", tasks: [...tasks] }];
  const keyOf = (task: Task) => (grouping === "status" ? task.stateId : grouping === "assignee" ? (task.assigneePersonId ?? "none") : (task.clientId ?? "none"));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) groups.set(keyOf(task), [...(groups.get(keyOf(task)) ?? []), task]);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : key === "none" ? order.length + 1 : order.length);
  return [...groups].map(([key, own]) => ({ key, tasks: own })).sort((a, b) => rank(a.key) - rank(b.key));
}

/** Sub-tasks follow their parent when both survived the filter; otherwise they stand alone. */
export function nestTasks<Task extends FilterableTask>(tasks: readonly Task[]): { task: Task; depth: number }[] {
  const present = new Set(tasks.map((task) => task.id));
  const children = new Map<string, Task[]>();
  for (const task of tasks) if (task.parentTaskId && present.has(task.parentTaskId)) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
  const rows: { task: Task; depth: number }[] = [];
  const visit = (task: Task, depth: number) => {
    rows.push({ task, depth });
    for (const child of children.get(task.id) ?? []) if (depth < 6) visit(child, depth + 1);
  };
  for (const task of tasks) if (!task.parentTaskId || !present.has(task.parentTaskId)) visit(task, 0);
  return rows;
}
