// What one person got done in a period, as a few counts (FR-PRF-07: the evidence panel of a
// review). Counts only — no titles, no clients, no projects: the reviewer is told how much work
// went through, and looks at the work itself in the work module, where its own policy applies.
//
// **No authorization inside.** The caller (performance's evidence panel) has already decided that
// this viewer may read this person's performance data.
import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { IsoDate } from "@/lib/dates";
import { WORK_KIND } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;

export type PersonTaskStats = {
  from: IsoDate;
  to: IsoDate;
  /** Work-management tasks assigned to the person that were completed inside the period. */
  completed: number;
  /** Of those, the ones finished on or before the day they were due. A task with no due date counts as on time. */
  onTime: number;
  /** Completed after the due date. */
  late: number;
  /** Still open today, whenever they were created. */
  open: number;
  /** Open and already past their due date. */
  overdue: number;
  /** Cancelled in the period — context for a low "completed" figure. */
  cancelled: number;
};

const live = isNull(schema.task.deletedAt);
const mine = (personId: string) => and(eq(schema.task.kind, WORK_KIND), eq(schema.task.assigneePersonId, personId), live);

/**
 * One person's task statistics over a period — a year, for an annual review. Six counts in one
 * query over the person's tasks; nothing that says what the work was.
 */
export async function getPersonTaskStats(input: { personId: string; from: IsoDate; to: IsoDate; today?: IsoDate }, executor: Executor = db()): Promise<PersonTaskStats> {
  const inPeriod = and(gte(sql`${schema.task.completedAt}::date`, input.from), lte(sql`${schema.task.completedAt}::date`, input.to));
  const done = and(eq(schema.task.status, "done"), inPeriod);
  const open = sql`${schema.task.status} IN ('todo', 'in_progress')`;
  const today = input.today ?? input.to;
  const [row] = await executor
    .select({
      completed: sql<number>`count(*) filter (where ${done})::int`,
      // No due date = nothing was missed, so it counts as on time.
      onTime: sql<number>`count(*) filter (where ${and(done, sql`(${schema.task.dueDate} IS NULL OR ${schema.task.completedAt}::date <= ${schema.task.dueDate})`)})::int`,
      open: sql<number>`count(*) filter (where ${open})::int`,
      overdue: sql<number>`count(*) filter (where ${open} and ${schema.task.dueDate} < ${today}::date)::int`,
      cancelled: sql<number>`count(*) filter (where ${and(eq(schema.task.status, "cancelled"), gte(sql`${schema.task.updatedAt}::date`, input.from), lte(sql`${schema.task.updatedAt}::date`, input.to))})::int`,
    })
    .from(schema.task)
    .where(mine(input.personId));
  const completed = row?.completed ?? 0;
  const onTime = row?.onTime ?? 0;
  return { from: input.from, to: input.to, completed, onTime, late: completed - onTime, open: row?.open ?? 0, overdue: row?.overdue ?? 0, cancelled: row?.cancelled ?? 0 };
}
