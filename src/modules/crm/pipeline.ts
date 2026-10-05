// The pipeline as figures (FR-CRM-13, 34, 50): forecast by close month, won and lost by month, win
// rate, deal size, sales cycle, lost reasons, pipeline by stage. Every figure is summed in SQL over
// the deals whose value this reader may see — the rule of `canSeeDealValue`, as a WHERE clause — so
// nothing is loaded row by row to be added up, and nothing the reader may not value is counted.
import "server-only";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { entityReach } from "../platform/rbac/policy";
import { dealValueSql } from "./accounts";
import { agingSummary, invoiceReach as invoiceReachOf } from "./invoices";
import { winRate } from "./engine/deal";
import type { CrmViewer } from "./policy";

/**
 * The deals whose value this reader may see, as SQL (`canSeeDealValue`): their own, those of the
 * accounts they manage, and every deal of the entities they sell in, run sales in, or bill.
 * undefined = every deal; null = none.
 */
export function dealValueReach(viewer: CrmViewer): SQL | undefined | null {
  const reaches = (["crm:sell", "crm:manage", "pjm:commercial"] as const).map((permission) => entityReach(viewer.principal, permission));
  if (reaches.some((reach) => reach.all)) return undefined;
  const entities = [...new Set(reaches.flatMap((reach) => (reach.all ? [] : reach.entityIds)))];
  const managed = [...viewer.ties].filter(([, ties]) => ties.includes("manager")).map(([clientId]) => clientId);
  const me = viewer.principal.personId;
  const parts = [me ? eq(schema.crmDeal.ownerPersonId, me) : undefined, managed.length ? inArray(schema.crmDeal.clientId, managed) : undefined, entities.length ? inArray(schema.crmDeal.entityId, entities) : undefined].filter((part): part is SQL => !!part);
  return parts.length ? or(...parts)! : null;
}

export type PipelineScope = { entityId?: string | null; teamId?: string | null; ownerId?: string | null };

const scopeOf = (scope: PipelineScope): SQL | undefined =>
  and(scope.entityId ? eq(schema.crmDeal.entityId, scope.entityId) : undefined, scope.teamId ? eq(schema.crmDeal.teamId, scope.teamId) : undefined, scope.ownerId ? eq(schema.crmDeal.ownerPersonId, scope.ownerId) : undefined);

const probabilitySql = sql`coalesce(${schema.crmDeal.probability}, ${schema.crmStage.probability})`;

export type ForecastRow = { month: string; count: number; value: number; weighted: number };

/**
 * Open deals by the month they are expected to close. Deals with no date, or a date already past,
 * are one row, "none" — a forecast that dropped them would look better than it is.
 */
export async function forecast(viewer: CrmViewer, scope: PipelineScope = {}, today: IsoDate = todayInVietnam()): Promise<ForecastRow[]> {
  const reach = dealValueReach(viewer);
  if (reach === null) return [];
  const month = sql<string>`case when ${schema.crmDeal.expectedCloseOn} is null or to_char(${schema.crmDeal.expectedCloseOn}, 'YYYY-MM') < ${today.slice(0, 7)} then 'none' else to_char(${schema.crmDeal.expectedCloseOn}, 'YYYY-MM') end`;
  const rows = await db()
    .select({ month, count: sql<number>`count(*)`, value: sql<number>`coalesce(sum(${dealValueSql}), 0)`, weighted: sql<number>`coalesce(sum(round(${dealValueSql} * ${probabilitySql} / 100.0)), 0)` })
    .from(schema.crmDeal)
    .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDeal.stageId))
    .where(and(reach, scopeOf(scope), eq(schema.crmDeal.status, "open")))
    // By position: the month expression carries a bound parameter, and Postgres does not match a
    // GROUP BY's `$5` to the SELECT's `$1` even when they hold the same value.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const result = rows.map((row) => ({ month: row.month, count: Number(row.count), value: Number(row.value), weighted: Number(row.weighted) }));
  return [...result.filter((row) => row.month === "none"), ...result.filter((row) => row.month !== "none")];
}

export type SalesDashboard = {
  byStage: { stageId: string; name: string; nameEn: string | null; sortOrder: number; count: number; value: number; weighted: number }[];
  byMonth: { month: string; wonCount: number; wonValue: number; lostCount: number }[];
  winRate: number | null;
  averageWon: number | null;
  averageCycleDays: number | null;
  lostReasons: { reason: string; count: number }[];
  staleCount: number;
  openCount: number;
};

/** The sales dashboard over the reader's valued deals: the last `months` months of outcomes and the pipeline as it stands. */
export async function salesDashboard(viewer: CrmViewer, scope: PipelineScope = {}, today: IsoDate = todayInVietnam(), months = 6, staleDays = 14): Promise<SalesDashboard | null> {
  const reach = dealValueReach(viewer);
  if (reach === null) return null;
  const from = `${addDays(`${today.slice(0, 7)}-01`, -31 * (months - 1)).slice(0, 7)}-01`;
  const where = and(reach, scopeOf(scope));
  const closedMonth = sql<string>`to_char(coalesce(${schema.crmDeal.wonAt}, ${schema.crmDeal.lostAt}) at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM')`;
  const closedSince = sql`coalesce(${schema.crmDeal.wonAt}, ${schema.crmDeal.lostAt}) >= ${from}::date`;
  const [byStage, byMonth, [summary], lostReasons] = await Promise.all([
    db()
      .select({ stageId: schema.crmStage.id, name: schema.crmStage.name, nameEn: schema.crmStage.nameEn, sortOrder: schema.crmStage.sortOrder, count: sql<number>`count(*)`, value: sql<number>`coalesce(sum(${dealValueSql}), 0)`, weighted: sql<number>`coalesce(sum(round(${dealValueSql} * ${probabilitySql} / 100.0)), 0)` })
      .from(schema.crmDeal)
      .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDeal.stageId))
      .where(and(where, eq(schema.crmDeal.status, "open")))
      .groupBy(schema.crmStage.id, schema.crmStage.name, schema.crmStage.nameEn, schema.crmStage.sortOrder)
      .orderBy(schema.crmStage.sortOrder),
    db()
      .select({ month: closedMonth, wonCount: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'won')`, wonValue: sql<number>`coalesce(sum(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'won'), 0)`, lostCount: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'lost')` })
      .from(schema.crmDeal)
      .where(and(where, inArray(schema.crmDeal.status, ["won", "lost"]), closedSince))
      .groupBy(closedMonth)
      .orderBy(closedMonth),
    db()
      .select({
        won: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'won' and ${closedSince})`,
        lost: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'lost' and ${closedSince})`,
        averageWon: sql<number | null>`round(avg(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'won' and ${closedSince}))`,
        averageCycle: sql<number | null>`round(avg(extract(epoch from (${schema.crmDeal.wonAt} - ${schema.crmDeal.createdAt})) / 86400) filter (where ${schema.crmDeal.status} = 'won' and ${closedSince}))`,
        open: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'open')`,
        stale: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'open' and ${schema.crmDeal.stageChangedAt} < ${addDays(today, -staleDays)}::date and not exists (select 1 from ${schema.crmActivity} where ${schema.crmActivity.dealId} = ${schema.crmDeal.id} and coalesce(${schema.crmActivity.occurredAt}, ${schema.crmActivity.doneAt}) >= ${addDays(today, -staleDays)}::date))`,
      })
      .from(schema.crmDeal)
      .where(where),
    db()
      .select({ reason: sql<string>`coalesce(${schema.crmDeal.lostReason}, 'other')`, count: sql<number>`count(*)` })
      .from(schema.crmDeal)
      .where(and(where, eq(schema.crmDeal.status, "lost"), closedSince))
      .groupBy(sql`coalesce(${schema.crmDeal.lostReason}, 'other')`)
      .orderBy(sql`count(*) desc`),
  ]);
  return {
    byStage: byStage.map((row) => ({ ...row, count: Number(row.count), value: Number(row.value), weighted: Number(row.weighted) })),
    byMonth: byMonth.map((row) => ({ month: row.month, wonCount: Number(row.wonCount), wonValue: Number(row.wonValue), lostCount: Number(row.lostCount) })),
    winRate: winRate(Number(summary?.won ?? 0), Number(summary?.lost ?? 0)),
    averageWon: summary?.averageWon === null || summary?.averageWon === undefined ? null : Number(summary.averageWon),
    averageCycleDays: summary?.averageCycle === null || summary?.averageCycle === undefined ? null : Number(summary.averageCycle),
    lostReasons: lostReasons.map((row) => ({ reason: row.reason, count: Number(row.count) })),
    staleCount: Number(summary?.stale ?? 0),
    openCount: Number(summary?.open ?? 0),
  };
}

export type RevenueOutlookRow = { month: string; contracted: number; weighted: number };

/**
 * Revenue outlook (FR-CRM-34), per month for the next `months` months: contracted — active retainers'
 * monthly fees of the reader's valued accounts' projects — beside the weighted pipeline expected to
 * close in the month. Only for readers with `pjm:commercial`, who may read retainer fees.
 */
export async function revenueOutlook(viewer: CrmViewer, today: IsoDate = todayInVietnam(), months = 6): Promise<RevenueOutlookRow[] | null> {
  const commercial = entityReach(viewer.principal, "pjm:commercial");
  if (!commercial.all && commercial.entityIds.length === 0) return null;
  const list = Array.from({ length: months }, (_, index) => {
    const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + index);
    return date.toISOString().slice(0, 7);
  });
  const monthSeries = sql`(select to_char(generate_series(${`${list[0]}-01`}::date, ${`${list.at(-1)}-01`}::date, interval '1 month'), 'YYYY-MM') as month) as m`;
  const entityFilter = commercial.all ? sql`true` : sql`${schema.workProject.entityId} in (${sql.join(commercial.entityIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const contracted = await db().execute<{ month: string; amount: string | number }>(sql`
    select m.month, coalesce(sum(${schema.projectRetainer.feePerMonthVnd}), 0) as amount
    from ${monthSeries}
    left join ${schema.projectRetainer} on ${schema.projectRetainer.isActive} = true and ${schema.projectRetainer.startMonth} <= m.month and (${schema.projectRetainer.endMonth} is null or ${schema.projectRetainer.endMonth} >= m.month)
    left join ${schema.workProject} on ${schema.workProject.id} = ${schema.projectRetainer.projectId} and ${entityFilter}
    where ${schema.projectRetainer.id} is null or ${schema.workProject.id} is not null
    group by m.month order by m.month`);
  const pipeline = new Map((await forecast(viewer, {}, today)).map((row) => [row.month, row.weighted]));
  const rows = (Array.isArray(contracted) ? contracted : (contracted as { rows: { month: string; amount: string | number }[] }).rows) as { month: string; amount: string | number }[];
  const amountOf = new Map(rows.map((row) => [row.month, Number(row.amount)]));
  return list.map((month) => ({ month, contracted: amountOf.get(month) ?? 0, weighted: pipeline.get(month) ?? 0 }));
}

export type SalesTile = { wonCount: number; wonVnd: number; openDeals: number; weightedVnd: number; overdueVnd: number | null; collectedVnd: number | null };

/**
 * The owner dashboard's sales tile (FR-CRM-51): this month's wins and the weighted pipeline over the
 * deals the reader may value, and — for a reader of receivables — what is overdue and what was
 * collected this month. null when the reader values no deal and reads no receivable.
 */
export async function salesTile(viewer: CrmViewer, today: IsoDate = todayInVietnam()): Promise<SalesTile | null> {
  const reach = dealValueReach(viewer);
  const invoices = invoiceReachOf(viewer);
  if (reach === null && invoices === null) return null;
  const monthStart = `${today.slice(0, 7)}-01`;
  const [[deals], aging, [collected]] = await Promise.all([
    reach === null
      ? Promise.resolve([undefined])
      : db()
          .select({
            wonCount: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'won' and (${schema.crmDeal.wonAt} at time zone 'Asia/Ho_Chi_Minh')::date >= ${monthStart}::date)`,
            wonVnd: sql<number>`coalesce(sum(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'won' and (${schema.crmDeal.wonAt} at time zone 'Asia/Ho_Chi_Minh')::date >= ${monthStart}::date), 0)`,
            openDeals: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'open')`,
            weightedVnd: sql<number>`coalesce(sum(round(${dealValueSql} * ${probabilitySql} / 100.0)) filter (where ${schema.crmDeal.status} = 'open'), 0)`,
          })
          .from(schema.crmDeal)
          .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDeal.stageId))
          .where(reach),
    invoices === null ? Promise.resolve(null) : agingSummary(viewer, {}, today),
    invoices === null
      ? Promise.resolve([undefined])
      : db()
          .select({ amount: sql<number>`coalesce(sum(${schema.crmPayment.amountVnd}), 0)` })
          .from(schema.crmPayment)
          .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
          .where(and(invoices, isNull(schema.crmPayment.reversedAt), sql`${schema.crmPayment.receivedOn} >= ${monthStart}::date`)),
  ]);
  if (!deals && !aging) return null;
  if (deals && Number(deals.openDeals) === 0 && Number(deals.wonCount) === 0 && (!aging || aging.total === 0)) return null;
  return {
    wonCount: Number(deals?.wonCount ?? 0),
    wonVnd: Number(deals?.wonVnd ?? 0),
    openDeals: Number(deals?.openDeals ?? 0),
    weightedVnd: Number(deals?.weightedVnd ?? 0),
    overdueVnd: aging ? aging.total - aging.current : null,
    collectedVnd: collected ? Number(collected.amount) : null,
  };
}
