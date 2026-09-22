// What the table view (FR-PJM-36) needs beyond the list's rows: the minutes logged on each task.
import "server-only";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Minutes logged per task, summed in SQL. `time_entry` belongs to the daily module (FR-PJM-24); this
 * reads totals only, never a person's rows. The caller shows them to whoever `canSeeLoggedTime`.
 */
export async function loggedMinutesByTask(taskIds: readonly string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db()
    .select({ taskId: schema.timeEntry.taskId, minutes: sql<number>`sum(${schema.timeEntry.minutes})::int` })
    .from(schema.timeEntry)
    .where(and(inArray(schema.timeEntry.taskId, [...new Set(taskIds)]), isNull(schema.timeEntry.deletedAt)))
    .groupBy(schema.timeEntry.taskId);
  return new Map(rows.flatMap((row) => (row.taskId ? [[row.taskId, Number(row.minutes)] as const] : [])));
}
