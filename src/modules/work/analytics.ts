// Work reports (FR-RPT-04): throughput, on-time rate, workload and revision rounds by team and by
// client, over a period.
//
// **Scope.** Exactly the tasks the viewer may open, decided by `visibleTaskCondition` — the same
// WHERE clause the board, the list and the command palette use. A private project the viewer is not
// on contributes nothing, not even to a count; the numbers here are a different shape of the same
// rows, never a wider set. Filtering happens in SQL, so nothing the viewer may not see is loaded.
//
// The figures themselves are worked out by the pure engine (`engine/analytics.ts`).
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { analyse, type AnalyticsCell, type AnalyticsTask, type WorkAnalyticsResult } from "./engine/analytics";
import type { WorkViewer } from "./policy";
import { visibleTaskCondition, WORK_KIND } from "./tasks";

export type { AnalyticsCell, WorkAnalyticsResult } from "./engine/analytics";

export type AnalyticsFilter = { from: IsoDate; to: IsoDate; teamId?: string | null; clientId?: string | null };
export type NamedGroup = { id: string; name: string; cell: AnalyticsCell };
export type WorkAnalytics = {
  period: { from: IsoDate; to: IsoDate };
  today: IsoDate;
  total: AnalyticsCell;
  byTeam: NamedGroup[];
  byClient: NamedGroup[];
  /** Everything the filter bar may offer — teams and clients the viewer has work in. */
  teams: { id: string; name: string }[];
  clients: { id: string; name: string }[];
};

/** The month `today` sits in, up to today: the period the report opens on. */
export function defaultAnalyticsPeriod(today: IsoDate = todayInVietnam()): { from: IsoDate; to: IsoDate } {
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * The report. One query for the rows the viewer may see, one for the names; the arithmetic is pure.
 * Rows outside the period are still loaded — open work has no completion date to filter on, and
 * "what is still open" is half the report.
 */
export async function getWorkAnalytics(viewer: WorkViewer, filter: AnalyticsFilter, today: IsoDate = todayInVietnam()): Promise<WorkAnalytics> {
  const visible = await visibleTaskCondition(viewer);
  const rows = await db()
    .select({
      teamId: schema.workTask.teamId,
      clientId: schema.workTask.clientId,
      status: schema.task.status,
      dueDate: schema.task.dueDate,
      completedOn: sql<string | null>`(${schema.task.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`,
      updatedOn: sql<string>`(${schema.task.updatedAt} at time zone 'Asia/Ho_Chi_Minh')::date`,
      revisionRounds: schema.workTask.revisionRounds,
      assigneePersonId: schema.task.assigneePersonId,
      estimateMinutes: schema.task.estimateMinutes,
    })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .where(
      and(
        eq(schema.task.kind, WORK_KIND),
        isNull(schema.task.deletedAt),
        visible,
        filter.teamId ? eq(schema.workTask.teamId, filter.teamId) : undefined,
        filter.clientId ? eq(schema.workTask.clientId, filter.clientId) : undefined,
      ),
    );

  const tasks: AnalyticsTask[] = rows.map((row) => ({ ...row, status: row.status as AnalyticsTask["status"] }));
  const result: WorkAnalyticsResult = analyse(tasks, { from: filter.from, to: filter.to }, today);

  const teamIds = [...new Set(tasks.map((task) => task.teamId))];
  const clientIds = [...new Set(tasks.map((task) => task.clientId).filter((id): id is string => !!id))];
  const [teams, clients] = await Promise.all([
    teamIds.length ? db().select({ id: schema.workTeam.id, name: schema.workTeam.name }).from(schema.workTeam).where(inArray(schema.workTeam.id, teamIds)).orderBy(asc(schema.workTeam.name)) : [],
    clientIds.length ? db().select({ id: schema.workClient.id, name: schema.workClient.name }).from(schema.workClient).where(inArray(schema.workClient.id, clientIds)).orderBy(asc(schema.workClient.name)) : [],
  ]);
  const name = (list: { id: string; name: string }[], id: string) => list.find((row) => row.id === id)?.name ?? id;
  const named = (groups: { key: string; cell: AnalyticsCell }[], list: { id: string; name: string }[]): NamedGroup[] =>
    groups.map((group) => ({ id: group.key, name: name(list, group.key), cell: group.cell })).sort((left, right) => right.cell.completed - left.cell.completed || left.name.localeCompare(right.name));

  return { period: result.period, today, total: result.total, byTeam: named(result.byTeam, teams), byClient: named(result.byClient, clients), teams, clients };
}
