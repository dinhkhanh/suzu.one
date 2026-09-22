// Scheduling on the timeline (FR-PJM-07): working days, what a moved task does to the tasks that
// wait for it, and the critical path. Pure: the service reads the team's working weekdays, the
// entity's days off and the "blocks" dependencies, and asks these functions.
//
// A task occupies whole days from its start to its due date, both included; a task with only a
// due date is one day long. A dependent "starts before its blocker ends" when it starts on or
// before the blocker's due date — the blocker's last day is still a day of work.
import type { IsoDate } from "@/lib/dates";

const DAY = 86_400_000;
const parse = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number): IsoDate => new Date(time).toISOString().slice(0, 10);
const step = (date: IsoDate, days: number): IsoDate => iso(parse(date) + days * DAY);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: IsoDate): number => {
  const day = new Date(parse(date)).getUTCDay();
  return day === 0 ? 7 : day;
};

export type WorkCalendar = {
  /** ISO weekdays the team works (the team's calendar); Monday–Friday unless the team says otherwise. */
  workingWeekdays: ReadonlySet<number>;
  /** Holidays and company days off of the project's entity. */
  daysOff: ReadonlySet<IsoDate>;
};

export const DEFAULT_WORKING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

export function workCalendar(workingWeekdays: readonly number[], daysOff: Iterable<IsoDate>): WorkCalendar {
  // A team that works no day at all would make every search below endless: fall back to Mon–Fri.
  return { workingWeekdays: new Set(workingWeekdays.length ? workingWeekdays : DEFAULT_WORKING_WEEKDAYS), daysOff: new Set(daysOff) };
}

export const isWorkingDay = (calendar: WorkCalendar, date: IsoDate): boolean => calendar.workingWeekdays.has(isoWeekday(date)) && !calendar.daysOff.has(date);

/**
 * `count` working days after (or, negative, before) `date`. A date that is itself not a working
 * day is a starting point like any other: one working day after a Saturday is the Monday.
 */
export function addWorkingDays(calendar: WorkCalendar, date: IsoDate, count: number): IsoDate {
  const direction = count < 0 ? -1 : 1;
  let cursor = date;
  // Days off never run for a year on end; the bound keeps a mis-configured calendar from hanging.
  for (let left = Math.abs(count), guard = 0; left > 0 && guard < 3660; guard++) {
    cursor = step(cursor, direction);
    if (isWorkingDay(calendar, cursor)) left -= 1;
  }
  return cursor;
}

/**
 * How many working days `to` lies after `from` (negative = before): the working days in
 * (from, to]. Moving a due date from Friday to the next Monday is one working day.
 */
export function workingDaysBetween(calendar: WorkCalendar, from: IsoDate, to: IsoDate): number {
  if (from === to) return 0;
  const [low, high, sign] = from < to ? [from, to, 1] : [to, from, -1];
  let count = 0;
  for (let cursor = step(low, 1); cursor <= high; cursor = step(cursor, 1)) if (isWorkingDay(calendar, cursor)) count += 1;
  return sign * count;
}

/** The working days a task spans, both ends included (at least 1). */
export function workingDuration(calendar: WorkCalendar, start: IsoDate, due: IsoDate): number {
  let count = 0;
  for (let cursor = start; cursor <= due; cursor = step(cursor, 1)) if (isWorkingDay(calendar, cursor)) count += 1;
  return Math.max(1, count);
}

// ── Moving a task and its dependents ────────────────────────────────────────────────────────

export type ScheduledTask = { id: string; startDate: IsoDate | null; dueDate: IsoDate | null };
/** A "blocks" dependency: `blocked` waits for `blocker` to finish. */
export type Dependency = { blocker: string; blocked: string };
export type DateChange = { taskId: string; from: { startDate: IsoDate | null; dueDate: IsoDate | null }; to: { startDate: IsoDate | null; dueDate: IsoDate | null } };

export type MovePlan = {
  /** The moved task itself. */
  moved: DateChange;
  /** Working days the moved task's end moved by (negative = earlier). */
  shiftDays: number;
  /** Dependents (at any depth) that would start before a task they wait for ends, shifted by `shiftDays`, in the order to apply them. */
  shifts: DateChange[];
};

const startOf = (task: Pick<ScheduledTask, "startDate" | "dueDate">): IsoDate | null => task.startDate ?? task.dueDate;

/** A task's dates moved by `days` working days; each end moves on its own, so a task keeps its working length. */
export function shiftTask(calendar: WorkCalendar, task: Pick<ScheduledTask, "startDate" | "dueDate">, days: number): { startDate: IsoDate | null; dueDate: IsoDate | null } {
  return { startDate: task.startDate ? addWorkingDays(calendar, task.startDate, days) : null, dueDate: task.dueDate ? addWorkingDays(calendar, task.dueDate, days) : null };
}

/**
 * What moving one task to new dates would do. Only a later end can push anything: each dependent
 * that would then start on or before the end of a task it waits for is shifted by the same number
 * of working days as the moved task's end, and so on down the chain — a dependent that still has
 * room is left where it is, and so is everything after it. Undated tasks are never shifted.
 * Cycles cannot exist (the work module refuses them), but a task is visited once regardless.
 */
export function planMove(calendar: WorkCalendar, tasks: readonly ScheduledTask[], dependencies: readonly Dependency[], move: { taskId: string; startDate: IsoDate | null; dueDate: IsoDate | null }): MovePlan {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const original = byId.get(move.taskId);
  const from = { startDate: original?.startDate ?? null, dueDate: original?.dueDate ?? null };
  const moved: DateChange = { taskId: move.taskId, from, to: { startDate: move.startDate, dueDate: move.dueDate } };
  const shiftDays = from.dueDate && move.dueDate ? workingDaysBetween(calendar, from.dueDate, move.dueDate) : 0;
  if (shiftDays <= 0) return { moved, shiftDays, shifts: [] };

  const dependentsOf = Map.groupBy(dependencies, (dependency) => dependency.blocker);
  const current = new Map<string, { startDate: IsoDate | null; dueDate: IsoDate | null }>([[move.taskId, moved.to]]);
  const shifts: DateChange[] = [];
  const queue = [move.taskId];
  const visited = new Set([move.taskId]);
  while (queue.length) {
    const blockerId = queue.shift()!;
    const blockerEnd = current.get(blockerId)?.dueDate;
    if (!blockerEnd) continue;
    for (const { blocked } of dependentsOf.get(blockerId) ?? []) {
      if (visited.has(blocked)) continue;
      const task = current.get(blocked) ?? byId.get(blocked);
      const start = task ? startOf(task) : null;
      if (!task || !start || start > blockerEnd) continue;
      visited.add(blocked);
      const to = shiftTask(calendar, task, shiftDays);
      current.set(blocked, to);
      shifts.push({ taskId: blocked, from: { startDate: task.startDate, dueDate: task.dueDate }, to });
      queue.push(blocked);
    }
  }
  return { moved, shiftDays, shifts };
}

// ── The critical path ───────────────────────────────────────────────────────────────────────

/**
 * The tasks with no slack (C): walking back from the project's last due date, a task's latest
 * finish is the working day before the earliest latest-start of the tasks waiting for it; a task
 * whose due date is already at (or past) its latest finish holds the end date up. Open tasks
 * only — finished work cannot delay anything. Dependencies that point at undated tasks are ignored.
 */
export function criticalPath(calendar: WorkCalendar, tasks: readonly (ScheduledTask & { open: boolean })[], dependencies: readonly Dependency[]): Set<string> {
  const dated = new Map(tasks.filter((task) => task.open && task.dueDate).map((task) => [task.id, task]));
  if (dated.size === 0) return new Set();
  const end = [...dated.values()].reduce((latest, task) => (task.dueDate! > latest ? task.dueDate! : latest), "0000-00-00");
  const edges = dependencies.filter((dependency) => dated.has(dependency.blocker) && dated.has(dependency.blocked));
  const dependentsOf = Map.groupBy(edges, (dependency) => dependency.blocker);

  const latestFinish = new Map<string, IsoDate>();
  const latestStart = new Map<string, IsoDate>();
  const visiting = new Set<string>();
  const finishOf = (id: string): IsoDate => {
    const known = latestFinish.get(id);
    if (known) return known;
    if (visiting.has(id)) return end;
    visiting.add(id);
    const task = dated.get(id)!;
    const followers = dependentsOf.get(id) ?? [];
    let finish = end;
    for (const { blocked } of followers) {
      finishOf(blocked);
      const before = addWorkingDays(calendar, latestStart.get(blocked)!, -1);
      if (before < finish) finish = before;
    }
    const length = workingDuration(calendar, startOf(task)!, task.dueDate!);
    latestFinish.set(id, finish);
    latestStart.set(id, addWorkingDays(calendar, finish, -(length - 1)));
    visiting.delete(id);
    return finish;
  };
  const critical = new Set<string>();
  for (const [id, task] of dated) if (task.dueDate! >= finishOf(id)) critical.add(id);
  return critical;
}
