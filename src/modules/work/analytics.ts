// Work reports (FR-RPT-04): throughput, on-time rate, workload and revision rounds by team and by
// client, over a period.
//
// **Scope.** Exactly the tasks the viewer may open, decided by `visibleTaskCondition` — the same
// WHERE clause the board, the list and the command palette use. A private project the viewer is not
// on contributes nothing, not even to a count; the numbers here are a different shape of the same
// rows, never a wider set. Filtering happens in SQL, so nothing the viewer may not see is loaded.
//
// The figures follow the definitions of the pure engine (`engine/analytics.ts`); Postgres counts them.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { workDirectory } from "./directory";
import { type AnalyticsCell, summarise } from "./engine/analytics";
import type { WorkViewer } from "./policy";
import { visibleTaskCondition, WORK_KIND } from "./tasks";
import { listClients } from "./teams";

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
 * The report, counted by Postgres in one pass: the whole scope, each team and each client
 * (GROUPING SETS), with the definitions of `engine/analytics.ts` written as FILTER clauses. A
 * PGlite test keeps the two in step. Rows outside the period still count — open work has no
 * completion date to filter on, and "what is still open" is half the report.
 */
export async function getWorkAnalytics(viewer: WorkViewer, filter: AnalyticsFilter, today: IsoDate = todayInVietnam()): Promise<WorkAnalytics> {
  const [visible, directory, allClients] = await Promise.all([visibleTaskCondition(viewer), workDirectory(), listClients()]);
  const completedOn = sql`(${schema.task.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`;
  const updatedOn = sql`(${schema.task.updatedAt} at time zone 'Asia/Ho_Chi_Minh')::date`;
  const completed = sql`${schema.task.status} = 'done' and ${completedOn} between ${filter.from}::date and ${filter.to}::date`;
  const cancelled = sql`${schema.task.status} = 'cancelled' and ${updatedOn} between ${filter.from}::date and ${filter.to}::date`;
  const open = sql`${schema.task.status} in ('todo', 'in_progress')`;
  const rows = await db()
    .select({
      level: sql<number>`grouping(${schema.workTask.teamId}, ${schema.workTask.clientId})::int`,
      teamId: schema.workTask.teamId,
      clientId: schema.workTask.clientId,
      completed: sql<number>`count(*) filter (where ${completed})::int`,
      dated: sql<number>`count(*) filter (where ${completed} and ${schema.task.dueDate} is not null)::int`,
      onTime: sql<number>`count(*) filter (where ${completed} and ${completedOn} <= ${schema.task.dueDate})::int`,
      late: sql<number>`count(*) filter (where ${completed} and ${completedOn} > ${schema.task.dueDate})::int`,
      undated: sql<number>`count(*) filter (where ${completed} and ${schema.task.dueDate} is null)::int`,
      cancelled: sql<number>`count(*) filter (where ${cancelled})::int`,
      open: sql<number>`count(*) filter (where ${open})::int`,
      overdue: sql<number>`count(*) filter (where ${open} and ${schema.task.dueDate} < ${today}::date)::int`,
      contributors: sql<number>`count(distinct ${schema.task.assigneePersonId}) filter (where (${completed}) or (${open}))::int`,
      revisionRounds: sql<number>`coalesce(sum(greatest(0, ${schema.workTask.revisionRounds})) filter (where ${completed}), 0)::int`,
      openMinutes: sql<number>`coalesce(sum(greatest(0, coalesce(${schema.task.estimateMinutes}, 0))) filter (where ${open}), 0)::int`,
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
    )
    .groupBy(sql`grouping sets ((), (${schema.workTask.teamId}), (${schema.workTask.clientId}))`);

  const cellOf = (row: (typeof rows)[number]): AnalyticsCell => ({
    completed: row.completed,
    dated: row.dated,
    onTime: row.onTime,
    late: row.late,
    undated: row.undated,
    onTimeRate: row.dated > 0 ? row.onTime / row.dated : null,
    cancelled: row.cancelled,
    open: row.open,
    overdue: row.overdue,
    contributors: row.contributors,
    revisionRounds: row.revisionRounds,
    revisionsPerTask: row.completed > 0 ? row.revisionRounds / row.completed : null,
    openMinutes: row.openMinutes,
  });
  // grouping(): 3 = the whole scope, 1 = one team, 2 = one client (a task with no client has none).
  const totalRow = rows.find((row) => row.level === 3);
  const total = totalRow ? cellOf(totalRow) : summarise([], filter, today);
  const byTeam = rows.filter((row) => row.level === 1).map((row) => ({ key: row.teamId, cell: cellOf(row) }));
  const byClient = rows.filter((row): row is typeof row & { clientId: string } => row.level === 2 && row.clientId !== null).map((row) => ({ key: row.clientId, cell: cellOf(row) }));

  // The filter bar offers the teams and clients the viewer has work in, by name.
  const teamIds = new Set(byTeam.map((group) => group.key));
  const clientIds = new Set(byClient.map((group) => group.key));
  const teams = directory.teams.filter((team) => teamIds.has(team.id)).map(({ id, name }) => ({ id, name }));
  const clients = allClients.filter((client) => clientIds.has(client.id)).map(({ id, name }) => ({ id, name }));
  const name = (list: { id: string; name: string }[], id: string) => list.find((row) => row.id === id)?.name ?? id;
  const named = (groups: { key: string; cell: AnalyticsCell }[], list: { id: string; name: string }[]): NamedGroup[] =>
    groups.map((group) => ({ id: group.key, name: name(list, group.key), cell: group.cell })).sort((left, right) => right.cell.completed - left.cell.completed || left.name.localeCompare(right.name));

  return { period: { from: filter.from, to: filter.to }, today, total, byTeam: named(byTeam, teams), byClient: named(byClient, clients), teams, clients };
}
