// Time on one task, for the task's own page (FR-PJM-24, 37): D22 asks everyone to log time, so the
// task is a place to log it from — the quick log and the timer, the same actions Today uses. What
// the page shows of the hours follows the time access rule (policy.ts `canViewTimeEntry`): the
// viewer's own always; everyone's only where the viewer may read every entry on the task.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { loadSubjects } from "./people";
import { canViewTimeEntry, type TimeReader } from "./policy";
import { billableByDefault, getRunningTimer, TIME_BACKFILL_DAYS } from "./time";
import type { LoggedTotal } from "./totals";

export type TaskTime = {
  /** The viewer's own time on the task. */
  mine: LoggedTotal;
  /**
   * Everyone's time on the task — for a viewer who may read each of those entries (the lead of the
   * project they were logged on, the leads and managers of everyone who logged, oversight). Null
   * for anyone else: a total they may only partly read would be the rest by subtraction.
   */
  total: LoggedTotal | null;
  /** The viewer's timer is running on this task now. */
  running: boolean;
  /** Time on the task's project is billed to the client by default: what the log's box starts from. */
  billable: boolean;
  /** The earliest day the log still takes (`TIME_BACKFILL_DAYS`). */
  earliest: IsoDate;
};

export async function getTaskTime(reader: TimeReader, task: { taskId: string; projectId: string | null }, today: IsoDate): Promise<TaskTime> {
  const self = reader.personId;
  const [rows, timer, billable] = await Promise.all([
    // One row per person and project the time was logged on, summed in Postgres: nobody's entries
    // cross the wire for a line that shows two totals.
    db()
      .select({
        personId: schema.timeEntry.personId,
        projectId: schema.timeEntry.projectId,
        minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int`,
        billable: sql<number>`coalesce(sum(${schema.timeEntry.minutes}) filter (where ${schema.timeEntry.billable}), 0)::int`,
      })
      .from(schema.timeEntry)
      .where(and(eq(schema.timeEntry.taskId, task.taskId), isNull(schema.timeEntry.deletedAt), isNull(schema.timeEntry.timerStartedAt)))
      .groupBy(schema.timeEntry.personId, schema.timeEntry.projectId),
    self ? getRunningTimer(self) : null,
    billableByDefault(task.projectId),
  ]);
  const sum = (list: typeof rows): LoggedTotal => ({ minutes: list.reduce((total, row) => total + Number(row.minutes), 0), billable: list.reduce((total, row) => total + Number(row.billable), 0) });
  const others = rows.filter((row) => row.personId !== self);
  const subjects = others.length > 0 ? await loadSubjects(others.map((row) => row.personId)) : new Map();
  const readsAll = others.every((row) => {
    const subject = subjects.get(row.personId);
    return !!subject && canViewTimeEntry(reader, subject, row);
  });
  return {
    mine: sum(rows.filter((row) => row.personId === self)),
    total: readsAll ? sum(rows) : null,
    running: !!timer && timer.taskId === task.taskId,
    billable,
    earliest: addDays(today, -TIME_BACKFILL_DAYS),
  };
}
