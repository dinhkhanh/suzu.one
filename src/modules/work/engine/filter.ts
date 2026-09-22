// The list's filters and grouping, in memory: the project's tasks are already in the browser, so
// every keystroke answers at once (FR-WRK-05, FR-WRK-12). Pure; shared by list, board, calendar and table.
import { toSearchKey } from "@/lib/text";
import { compareCustomValues, CUSTOM_PREFIX, type CustomFieldDef, currentValue, customGroupKeys, fieldIdOf, matchesCustomFilter } from "./custom-fields";

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
  /** FR-PJM-35: { [fieldId]: value }. */
  customValues?: Readonly<Record<string, unknown>>;
  /** FR-PJM-32: pending and snoozed work waits in the team's triage, out of the normal lists. */
  triageStatus?: string | null;
  /** Open tasks that block this one, and a blocker raised on it (FR-PJM-28). */
  blockedBy?: number;
  blocker?: unknown;
  /** FR-PJM-10: the cycle the task is planned in. */
  cycleId?: string | null;
};

type CustomFilterKey = `cf.${string}`;
/**
 * URL parameters, as they are: `assignee` is a person id, "me" or "none"; `due` is "overdue" |
 * "week" | "none"; `triage` "1" shows work still in triage too, "only" nothing else; `blocked` "1"
 * shows blocked work only; `cycle` is a cycle id or "none"; `cf.<fieldId>` filters by a custom
 * field (engine/custom-fields.ts).
 */
export type TaskFilters = { q?: string; assignee?: string; state?: string; priority?: string; label?: string; client?: string; due?: string; closed?: string; triage?: string; blocked?: string; cycle?: string } & { [key: CustomFilterKey]: string | undefined };
export const FILTER_KEYS = ["q", "assignee", "state", "priority", "label", "client", "due", "closed", "triage", "blocked", "cycle"] as const;
export const GROUPINGS = ["none", "status", "assignee", "client"] as const;
export type Grouping = (typeof GROUPINGS)[number];
/** A fixed grouping, or a custom field's (`cf.<fieldId>`). */
export type ListGrouping = Grouping | CustomFilterKey;
export const SORTS = ["rank", "due", "priority", "title"] as const;
/** A fixed order or a custom field's; a leading "-" reverses it. */
export type ListSort = string;

export const isFilterKey = (key: string): key is keyof TaskFilters => (FILTER_KEYS as readonly string[]).includes(key) || fieldIdOf(key) !== null;

/** The filters in a URL query (or a saved view): the fixed keys and one per custom field; anything else is dropped. */
export function readFilters(query: Readonly<Record<string, string | string[] | undefined>>): TaskFilters {
  return Object.fromEntries(Object.entries(query).flatMap(([key, value]) => (isFilterKey(key) && typeof value === "string" && value ? [[key, value]] : []))) as TaskFilters;
}

/** The filters that are set, as URL pairs. */
export function filterEntries(filters: TaskFilters): [string, string][] {
  return Object.entries(filters).flatMap(([key, value]) => (isFilterKey(key) && typeof value === "string" && value ? [[key, value] as [string, string]] : []));
}

export function readGrouping(value: unknown): ListGrouping {
  if (typeof value !== "string") return "none";
  if ((GROUPINGS as readonly string[]).includes(value)) return value as Grouping;
  return fieldIdOf(value) ? (value as CustomFilterKey) : "none";
}

export function readSort(value: unknown): ListSort {
  if (typeof value !== "string") return "rank";
  const key = value.replace(/^-/, "");
  return (SORTS as readonly string[]).includes(key) || fieldIdOf(key) ? value : "rank";
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const inTriage = (task: FilterableTask) => task.triageStatus === "pending" || task.triageStatus === "snoozed";

export type FilterContext = { selfId: string | null; today: string; /** The custom fields a `cf.` filter may name; others are ignored. */ fields?: readonly Pick<CustomFieldDef, "id" | "type" | "options">[] };

export function filterTasks<Task extends FilterableTask>(tasks: readonly Task[], filters: TaskFilters, context: FilterContext): Task[] {
  const words = toSearchKey(filters.q ?? "").split(" ").filter(Boolean);
  const weekEnd = addDays(context.today, 7);
  const custom = Object.entries(filters).flatMap(([key, value]) => {
    const field = typeof value === "string" && value ? context.fields?.find((row) => row.id === fieldIdOf(key)) : undefined;
    return field ? [{ field, value: value as string }] : [];
  });
  return tasks.filter((task) => {
    const open = task.status === "todo" || task.status === "in_progress";
    // Work still in triage is the lead's to sort out; the team's lists show it only when asked.
    if (filters.triage === "only" ? !inTriage(task) : filters.triage !== "1" && inTriage(task)) return false;
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
    if (filters.blocked === "1" && !task.blocker && !(task.blockedBy ?? 0)) return false;
    if (filters.cycle && (filters.cycle === "none" ? !!task.cycleId : task.cycleId !== filters.cycle)) return false;
    for (const { field, value } of custom) if (!matchesCustomFilter(field, task.customValues?.[field.id], value, context)) return false;
    if (words.length) {
      const haystack = `${task.key.toLowerCase()} ${toSearchKey(task.title)}`;
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

/**
 * The list's order. "rank" keeps the order given (board rank); the others are stable, so equal
 * values keep it too. Empty values sort last whichever the direction.
 */
export function sortTasks<Task extends FilterableTask>(tasks: readonly Task[], sort: ListSort, fields: readonly Pick<CustomFieldDef, "id" | "type" | "options">[] = [], names: ReadonlyMap<string, string> = new Map()): Task[] {
  const descending = sort.startsWith("-");
  const key = descending ? sort.slice(1) : sort;
  const field = fields.find((row) => row.id === fieldIdOf(key));
  const flip = (value: number) => (descending ? -value : value);
  const lastIfEmpty = (a: unknown, b: unknown, compare: () => number) => (a === null || b === null ? (a === b ? 0 : a === null ? 1 : -1) : flip(compare()));
  const compare = (a: Task, b: Task): number => {
    if (field) {
      const [left, right] = [currentValue(field, a.customValues?.[field.id]), currentValue(field, b.customValues?.[field.id])];
      return lastIfEmpty(left, right, () => compareCustomValues(field, left, right, names));
    }
    if (key === "due") return lastIfEmpty(a.dueDate, b.dueDate, () => a.dueDate!.localeCompare(b.dueDate!));
    if (key === "priority") return lastIfEmpty(a.priority, b.priority, () => a.priority! - b.priority!);
    if (key === "title") return flip(a.title.localeCompare(b.title, "vi"));
    return 0;
  };
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => compare(a.task, b.task) || a.index - b.index)
    .map((row) => row.task);
}

export type TaskGroup<Task> = { key: string; tasks: Task[] };

/**
 * Groups keep the order given by `order` (state order, people by name, a field's options…); keys
 * not listed go last, "none" after them. A custom field's grouping needs the field; a multi-select
 * puts a task under each of its choices.
 */
export function groupTasks<Task extends FilterableTask>(tasks: readonly Task[], grouping: ListGrouping, order: readonly string[], fields: readonly Pick<CustomFieldDef, "id" | "type" | "options">[] = []): TaskGroup<Task>[] {
  if (grouping === "none") return [{ key: "all", tasks: [...tasks] }];
  const field = grouping.startsWith(CUSTOM_PREFIX) ? fields.find((row) => row.id === fieldIdOf(grouping)) : undefined;
  if (grouping.startsWith(CUSTOM_PREFIX) && !field) return [{ key: "all", tasks: [...tasks] }];
  const keysOf = (task: Task): string[] => (field ? customGroupKeys(field, task.customValues?.[field.id]) : [grouping === "status" ? task.stateId : grouping === "assignee" ? (task.assigneePersonId ?? "none") : (task.clientId ?? "none")]);
  const groups = new Map<string, Task[]>();
  for (const task of tasks) for (const key of keysOf(task)) groups.set(key, [...(groups.get(key) ?? []), task]);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : key === "none" ? order.length + 1 : order.length);
  return [...groups].map(([key, own]) => ({ key, tasks: own })).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key, "vi"));
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
