// Logged time as totals, for other modules (FR-PJM-09 budget burn, FR-PJM-61 utilisation, later
// FR-PJM-63 profitability). Sums only, computed in SQL — never a person's rows — and no
// authorization inside: the caller shows the numbers to whoever its own policy allows (a
// project's hours to its lead, `pjm:commercial` for fees, `pjm:cost` for anything salary-derived).
import "server-only";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";

export type LoggedTotal = { minutes: number; billable: number };

/**
 * Minutes logged per project, optionally between two dates (inclusive). An entry counts on its own
 * project, or on its task's project when it was logged before the task joined one.
 */
export async function sumLoggedMinutesByProject(projectIds: readonly string[], range?: { from: IsoDate; to: IsoDate }): Promise<Map<string, LoggedTotal>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const onProject = sql<string>`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId})`;
  const rows = await db()
    .select({
      projectId: onProject,
      minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int`,
      billable: sql<number>`coalesce(sum(${schema.timeEntry.minutes}) filter (where ${schema.timeEntry.billable}), 0)::int`,
    })
    .from(schema.timeEntry)
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .where(and(isNull(schema.timeEntry.deletedAt), or(inArray(schema.timeEntry.projectId, ids), and(isNull(schema.timeEntry.projectId), inArray(schema.workTask.projectId, ids))), range ? and(gte(schema.timeEntry.date, range.from), lte(schema.timeEntry.date, range.to)) : undefined))
    .groupBy(onProject);
  return new Map(rows.map((row) => [row.projectId, { minutes: Number(row.minutes), billable: Number(row.billable) }]));
}

/** Minutes logged per task, all time. */
export async function sumLoggedMinutesByTask(taskIds: readonly string[]): Promise<Map<string, LoggedTotal>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return new Map();
  const rows = await db()
    .select({
      taskId: schema.timeEntry.taskId,
      minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int`,
      billable: sql<number>`coalesce(sum(${schema.timeEntry.minutes}) filter (where ${schema.timeEntry.billable}), 0)::int`,
    })
    .from(schema.timeEntry)
    .where(and(inArray(schema.timeEntry.taskId, ids), isNull(schema.timeEntry.deletedAt)))
    .groupBy(schema.timeEntry.taskId);
  return new Map(rows.flatMap((row) => (row.taskId ? [[row.taskId, { minutes: Number(row.minutes), billable: Number(row.billable) }] as const] : [])));
}

/** Minutes logged per person and week (weeks named by their Monday). */
export async function loggedMinutesByPersonWeek(personIds: readonly string[], weeks: readonly IsoDate[]): Promise<Map<string, Map<IsoDate, LoggedTotal>>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, Map<IsoDate, LoggedTotal>>();
  if (ids.length === 0 || weeks.length === 0) return result;
  const rows = await db()
    .select({
      personId: schema.timeEntry.personId,
      weekStart: schema.timeEntry.weekStart,
      minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int`,
      billable: sql<number>`coalesce(sum(${schema.timeEntry.minutes}) filter (where ${schema.timeEntry.billable}), 0)::int`,
    })
    .from(schema.timeEntry)
    .where(and(inArray(schema.timeEntry.personId, ids), inArray(schema.timeEntry.weekStart, [...new Set(weeks)]), isNull(schema.timeEntry.deletedAt)))
    .groupBy(schema.timeEntry.personId, schema.timeEntry.weekStart);
  for (const row of rows) {
    const own = result.get(row.personId) ?? new Map<IsoDate, LoggedTotal>();
    own.set(row.weekStart, { minutes: Number(row.minutes), billable: Number(row.billable) });
    result.set(row.personId, own);
  }
  return result;
}
