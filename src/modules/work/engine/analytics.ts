// Work analytics (FR-RPT-04): throughput, on-time rate, workload and revision rounds, grouped by
// team and by client. Pure — the caller has already filtered the rows to what the viewer may see.
//
// Definitions, chosen here once so every surface agrees:
//  - **throughput** = tasks completed inside the period (by `completedAt`, not by when they were made);
//  - **on time** = completed on or before the due date. A completed task with no due date counts as
//    on time: nothing was promised, so nothing was missed. It is counted separately (`undated`) so
//    a team that never sets dates cannot look perfect by accident;
//  - **on-time rate** = onTime ÷ completed, over *dated* completions only — undated work is left out
//    of the rate rather than inflating it. Null when nothing dated was completed;
//  - **workload** = tasks still open at the end of the period, and how many of those are overdue;
//  - **revision rounds** = `revisionRounds` on the completed tasks, total and mean. A round is one
//    "changes requested" on a deliverable (work/reviews.ts), so this is rework, not activity.
//
// Cancelled work is never throughput; it is reported apart, because a group with many cancellations
// and few completions is a different story from one with neither.

export type AnalyticsTask = {
  /** null for a task whose group key does not apply (no client). */
  teamId: string;
  clientId: string | null;
  status: "todo" | "in_progress" | "done" | "cancelled";
  dueDate: string | null;
  /** The day it was completed, or null. */
  completedOn: string | null;
  /** The day it was last touched — how a cancellation is dated. */
  updatedOn: string;
  revisionRounds: number;
  assigneePersonId: string | null;
  estimateMinutes: number | null;
};

export type AnalyticsPeriod = { from: string; to: string };

export type AnalyticsCell = {
  completed: number;
  /** Of `completed`, those that had a due date. */
  dated: number;
  onTime: number;
  late: number;
  /** Completed with no due date — neither on time nor late. */
  undated: number;
  /** onTime ÷ dated, 0..1; null when nothing dated was completed. */
  onTimeRate: number | null;
  cancelled: number;
  open: number;
  overdue: number;
  /** Distinct people with a completed or open task in the group. */
  contributors: number;
  revisionRounds: number;
  /** revisionRounds ÷ completed; null when nothing was completed. */
  revisionsPerTask: number | null;
  /** Estimated minutes on the tasks still open — what is still to do. */
  openMinutes: number;
};

export type AnalyticsGroup<Key> = { key: Key; cell: AnalyticsCell };

const EMPTY: AnalyticsCell = { completed: 0, dated: 0, onTime: 0, late: 0, undated: 0, onTimeRate: null, cancelled: 0, open: 0, overdue: 0, contributors: 0, revisionRounds: 0, revisionsPerTask: null, openMinutes: 0 };

const isOpen = (task: AnalyticsTask) => task.status === "todo" || task.status === "in_progress";
const completedInPeriod = (task: AnalyticsTask, period: AnalyticsPeriod) => task.status === "done" && task.completedOn !== null && task.completedOn >= period.from && task.completedOn <= period.to;
const cancelledInPeriod = (task: AnalyticsTask, period: AnalyticsPeriod) => task.status === "cancelled" && task.updatedOn >= period.from && task.updatedOn <= period.to;

/** One group's figures. `today` decides what counts as overdue; it is the day the report is read. */
export function summarise(tasks: readonly AnalyticsTask[], period: AnalyticsPeriod, today: string): AnalyticsCell {
  const cell: AnalyticsCell = { ...EMPTY };
  const people = new Set<string>();
  for (const task of tasks) {
    if (completedInPeriod(task, period)) {
      cell.completed++;
      cell.revisionRounds += Math.max(0, task.revisionRounds);
      if (task.dueDate === null) cell.undated++;
      else {
        cell.dated++;
        if (task.completedOn! <= task.dueDate) cell.onTime++;
        else cell.late++;
      }
      if (task.assigneePersonId) people.add(task.assigneePersonId);
    } else if (cancelledInPeriod(task, period)) {
      cell.cancelled++;
    } else if (isOpen(task)) {
      cell.open++;
      cell.openMinutes += Math.max(0, task.estimateMinutes ?? 0);
      if (task.dueDate !== null && task.dueDate < today) cell.overdue++;
      if (task.assigneePersonId) people.add(task.assigneePersonId);
    }
  }
  cell.contributors = people.size;
  cell.onTimeRate = cell.dated > 0 ? cell.onTime / cell.dated : null;
  cell.revisionsPerTask = cell.completed > 0 ? cell.revisionRounds / cell.completed : null;
  return cell;
}

/** Groups by a key the caller extracts, dropping rows with no key (a task with no client). */
export function groupBy<Key extends string>(tasks: readonly AnalyticsTask[], keyOf: (task: AnalyticsTask) => Key | null, period: AnalyticsPeriod, today: string): AnalyticsGroup<Key>[] {
  const buckets = new Map<Key, AnalyticsTask[]>();
  for (const task of tasks) {
    const key = keyOf(task);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  return [...buckets].map(([key, rows]) => ({ key, cell: summarise(rows, period, today) }));
}

export type WorkAnalyticsResult = {
  period: AnalyticsPeriod;
  today: string;
  total: AnalyticsCell;
  byTeam: AnalyticsGroup<string>[];
  byClient: AnalyticsGroup<string>[];
};

/** Everything the report shows, from one list of rows. */
export function analyse(tasks: readonly AnalyticsTask[], period: AnalyticsPeriod, today: string): WorkAnalyticsResult {
  return {
    period,
    today,
    total: summarise(tasks, period, today),
    byTeam: groupBy(tasks, (task) => task.teamId, period, today),
    byClient: groupBy(tasks, (task) => task.clientId, period, today),
  };
}
