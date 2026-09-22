// The compliance dashboard, calendar and archive (FR-OPS-07, 09): all three are views over
// `listInstances`, so none of them can show more than the list would.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { shiftMonth } from "@/lib/month-grid";
import { type CsvFile, EXPORT_ROW_LIMIT, type ExportColumn, toCsv } from "../platform/export/csv";
import { listEntities } from "../platform/org/service";
import type { Principal } from "../platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type DashboardCount, dashboardMatrixFromCounts, type DashboardRow } from "./engine/dashboard";
import { dateInMonth } from "./engine/due-rule";
import { DUE_SOON_DAYS } from "./engine/status";
import { OBLIGATION_FILE_OWNER, type StatusColour } from "./enums";
import { instanceConditions, type InstanceFilter, type InstanceListItem, listInstances } from "./instances";
import { opsReach } from "./policy";

type Viewer = { principal: Principal; personId: string };
export type OverviewFilter = Pick<InstanceFilter, "authority" | "category" | "ownerId">;
export type EntityRef = { id: string; code: string; shortName: string };

/** "2026-09" → its last day. */
const lastDayOf = (month: string): IsoDate => dateInMonth(Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1, "last");

/** The entities whose obligations the viewer reads as a whole (not the odd instance that is theirs to do). */
export async function readableEntities(principal: Principal): Promise<EntityRef[]> {
  const reach = opsReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  return (await listEntities()).filter((entity) => entity.isActive && (reach.all || reach.entityIds.includes(entity.id))).map(({ id, code, shortName }) => ({ id, code, shortName }));
}

export type Dashboard = { months: string[]; rows: DashboardRow<EntityRef>[]; owners: { id: string; name: string }[]; totals: { overdue: number; dueSoon: number; escalated: number } };

/**
 * Entity × month, `monthsBack` behind and `monthsAhead` in front of the current month. Counted in
 * SQL: the dashboard only ever shows entities the viewer reads as a whole, so the filter is those
 * entities (the instances that are merely someone's to do fall outside them anyway). The colour
 * follows `statusColour` exactly.
 */
export async function getDashboard(viewer: Viewer, filter: OverviewFilter = {}, today: IsoDate = todayInVietnam(), span: { monthsBack: number; monthsAhead: number } = { monthsBack: 2, monthsAhead: 3 }): Promise<Dashboard> {
  const current = today.slice(0, 7);
  const months = Array.from({ length: span.monthsBack + span.monthsAhead + 1 }, (_, index) => shiftMonth(current, index - span.monthsBack));
  const entities = await readableEntities(viewer.principal);
  if (entities.length === 0) return { months, rows: [], owners: [], totals: { overdue: 0, dueSoon: 0, escalated: 0 } };
  const inView = { dueFrom: `${months[0]}-01`, dueTo: lastDayOf(months.at(-1)!), entityIds: entities.map((entity) => entity.id) };
  const [counts, owners] = await Promise.all([countByCell({ ...filter, ...inView }, today), ownersInView({ ...filter, ownerId: null, ...inView })]);
  const sum = (pick: (row: DashboardCount) => number) => counts.reduce((total, row) => total + pick(row), 0);
  return {
    months,
    rows: dashboardMatrixFromCounts(entities, months, counts),
    owners,
    totals: { overdue: sum((row) => (row.colour === "overdue" ? row.count : 0)), dueSoon: sum((row) => (row.colour === "due_soon" ? row.count : 0)), escalated: sum((row) => (row.colour === "overdue" ? row.escalated : 0)) },
  };
}

/** `statusColour` in SQL (same rules, same `DUE_SOON_DAYS`). */
const colourSql = (today: IsoDate) => sql<StatusColour>`case
  when ${schema.task.status} = 'cancelled' then 'cancelled'
  when ${schema.task.status} = 'done' then case when ${schema.obligationInstance.completedLate} then 'done_late' else 'done' end
  when ${schema.task.dueDate} is null then 'upcoming'
  when ${schema.task.dueDate} < ${today} then 'overdue'
  when ${schema.task.dueDate} <= ${addDays(today, DUE_SOON_DAYS)} then 'due_soon'
  else 'upcoming' end`;

async function countByCell(filter: InstanceFilter, today: IsoDate): Promise<DashboardCount[]> {
  const colour = colourSql(today);
  const month = sql<string>`to_char(${schema.task.dueDate}, 'YYYY-MM')`;
  // Escalated = open, overdue and a manager or executive was told (what `escalationLevel` > 0 means).
  const escalated = sql<number>`count(*) filter (where ${schema.task.status} in ('todo', 'in_progress') and ${schema.task.dueDate} < ${today} and exists (select 1 from ${schema.obligationNoticeSent} where ${schema.obligationNoticeSent.instanceId} = ${schema.obligationInstance.id} and ${schema.obligationNoticeSent.key} in ('escalate:manager', 'escalate:executive')))`.mapWith(Number);
  const rows = await db()
    .select({ entityId: schema.obligationInstance.entityId, month, colour, count: sql<number>`count(*)`.mapWith(Number), escalated })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .where(and(instanceConditions(filter), isNotNull(schema.task.dueDate)))
    // By position: the colour expression carries parameters, which Postgres would not match to the select list.
    .groupBy(sql`1, 2, 3`);
  return rows;
}

/** The owner filter offers the people who own something in view — before the owner filter narrows it. */
async function ownersInView(filter: InstanceFilter): Promise<{ id: string; name: string }[]> {
  const rows = await db()
    .selectDistinct({ id: schema.person.id, name: schema.person.fullName })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .innerJoin(schema.person, eq(schema.person.id, schema.task.assigneePersonId))
    .where(instanceConditions(filter));
  return rows.map((row) => ({ id: row.id, name: row.name ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything due inside a date range, for the calendar grid. */
export const listForCalendar = (viewer: Viewer, range: { from: IsoDate; to: IsoDate }, filter: OverviewFilter & { entityId?: string | null } = {}, today: IsoDate = todayInVietnam()) => listInstances(viewer, { ...filter, dueFrom: range.from, dueTo: range.to, limit: 2000 }, today);

// ── Archive (FR-OPS-09) ─────────────────────────────────────────────────────────────────────

export type HistoryFile = { id: string; fileName: string };
export type HistoryRow = InstanceListItem & { files: HistoryFile[] };

/** `entityIds` narrows to those entities (the archive screen passes the ones the viewer reads as a whole). */
export type HistoryFilter = { templateId?: string; entityId?: string | null; year?: number | null; entityIds?: readonly string[] };

/** Every period of an obligation that is past or closed, newest first, with its evidence — what an inspector asks for. */
export async function getHistory(viewer: Viewer, filter: HistoryFilter, today: IsoDate = todayInVietnam()): Promise<HistoryRow[]> {
  const range = filter.year ? { dueFrom: `${filter.year}-01-01`, dueTo: `${filter.year}-12-31` } : {};
  const items = await listInstances(viewer, { templateId: filter.templateId, entityId: filter.entityId, entityIds: filter.entityIds, pastOrClosedOn: today, ...range, limit: EXPORT_ROW_LIMIT }, today);
  items.sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "") || a.entityCode.localeCompare(b.entityCode) || a.title.localeCompare(b.title));
  const files = items.length === 0 ? [] : await db().select({ id: schema.storedFile.id, fileName: schema.storedFile.fileName, ownerId: schema.storedFile.ownerId }).from(schema.storedFile).where(and(eq(schema.storedFile.ownerType, OBLIGATION_FILE_OWNER), inArray(schema.storedFile.ownerId, items.map((item) => item.instanceId)), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).orderBy(asc(schema.storedFile.createdAt));
  const byInstance = Map.groupBy(files, (file) => file.ownerId);
  return items.map((item) => ({ ...item, files: (byInstance.get(item.instanceId) ?? []).map(({ id, fileName }) => ({ id, fileName })) }));
}

type Locale = "vi" | "en";
const display = (date: IsoDate | null) => (date ? date.split("-").reverse().join("/") : null);

export async function buildHistoryExport(viewer: Viewer, filter: HistoryFilter, locale: Locale, today: IsoDate = todayInVietnam()): Promise<CsvFile> {
  const rows = await getHistory(viewer, filter, today);
  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en });
  const columns: ExportColumn<HistoryRow>[] = [
    { header: t("ops.history.columns.entity"), value: (row) => row.entityCode },
    { header: t("ops.history.columns.code"), value: (row) => row.templateCode },
    { header: t("ops.history.columns.obligation"), value: (row) => row.title },
    { header: t("ops.history.columns.period"), value: (row) => (row.periodKey.startsWith("event:") ? (row.subjectName ?? "") : row.periodKey) },
    { header: t("ops.history.columns.dueDate"), value: (row) => display(row.dueDate) },
    { header: t("ops.history.columns.status"), value: (row) => t(`ops.enums.colour.${row.colour}`) },
    { header: t("ops.history.columns.owner"), value: (row) => row.assigneeName },
    { header: t("ops.history.columns.completedBy"), value: (row) => row.completedByName },
    { header: t("ops.history.columns.completedOn"), value: (row) => (row.completedAt ? display(todayInVietnam(row.completedAt)) : null) },
    { header: t("ops.history.columns.submittedDate"), value: (row) => display(row.submittedDate) },
    { header: t("ops.history.columns.reference"), value: (row) => row.referenceNumber },
    { header: t("ops.history.columns.amount"), value: (row) => row.amountPaid },
    { header: t("ops.history.columns.files"), value: (row) => row.files.map((file) => file.fileName).join("; ") },
  ];
  return { fileName: `compliance-history-${today}.csv`, csv: toCsv(columns, rows), rowCount: rows.length, truncated: rows.length >= EXPORT_ROW_LIMIT };
}
