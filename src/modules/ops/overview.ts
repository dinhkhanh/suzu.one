// The compliance dashboard, calendar and archive (FR-OPS-07, 09): all three are views over
// `listInstances`, so none of them can show more than the list would.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { shiftMonth } from "@/lib/month-grid";
import { type CsvFile, EXPORT_ROW_LIMIT, type ExportColumn, toCsv } from "../platform/export/csv";
import type { Principal } from "../platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { dashboardMatrix, type DashboardRow } from "./engine/dashboard";
import { dateInMonth } from "./engine/due-rule";
import { OBLIGATION_FILE_OWNER } from "./enums";
import { type InstanceFilter, type InstanceListItem, listInstances } from "./instances";
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
  const rows = await db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).where(and(eq(schema.entity.isActive, true), reach.all ? undefined : inArray(schema.entity.id, reach.entityIds))).orderBy(asc(schema.entity.code));
  return rows;
}

export type Dashboard = { months: string[]; rows: DashboardRow<EntityRef>[]; owners: { id: string; name: string }[]; totals: { overdue: number; dueSoon: number; escalated: number } };

/** Entity × month, `monthsBack` behind and `monthsAhead` in front of the current month. */
export async function getDashboard(viewer: Viewer, filter: OverviewFilter = {}, today: IsoDate = todayInVietnam(), span: { monthsBack: number; monthsAhead: number } = { monthsBack: 2, monthsAhead: 3 }): Promise<Dashboard> {
  const current = today.slice(0, 7);
  const months = Array.from({ length: span.monthsBack + span.monthsAhead + 1 }, (_, index) => shiftMonth(current, index - span.monthsBack));
  const entities = await readableEntities(viewer.principal);
  const items = entities.length === 0 ? [] : await listInstances(viewer, { ...filter, dueFrom: `${months[0]}-01`, dueTo: lastDayOf(months.at(-1)!), limit: 5000 }, today);
  // The owner filter offers the people who own something in view — before the owner filter narrows it.
  const unfiltered = filter.ownerId ? await listInstances(viewer, { ...filter, ownerId: null, dueFrom: `${months[0]}-01`, dueTo: lastDayOf(months.at(-1)!), limit: 5000 }, today) : items;
  const owners = [...new Map(unfiltered.filter((item) => item.assigneePersonId && entities.some((entity) => entity.id === item.entityId)).map((item) => [item.assigneePersonId!, item.assigneeName ?? ""])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const inReach = items.filter((item) => entities.some((entity) => entity.id === item.entityId));
  return {
    months,
    rows: dashboardMatrix(entities, months, inReach),
    owners,
    totals: { overdue: inReach.filter((item) => item.colour === "overdue").length, dueSoon: inReach.filter((item) => item.colour === "due_soon").length, escalated: inReach.filter((item) => item.colour === "overdue" && item.escalationLevel > 0).length },
  };
}

/** Everything due inside a date range, for the calendar grid. */
export const listForCalendar = (viewer: Viewer, range: { from: IsoDate; to: IsoDate }, filter: OverviewFilter & { entityId?: string | null } = {}, today: IsoDate = todayInVietnam()) => listInstances(viewer, { ...filter, dueFrom: range.from, dueTo: range.to, limit: 2000 }, today);

// ── Archive (FR-OPS-09) ─────────────────────────────────────────────────────────────────────

export type HistoryFile = { id: string; fileName: string };
export type HistoryRow = InstanceListItem & { files: HistoryFile[] };

/** Every period of an obligation that is past or closed, newest first, with its evidence — what an inspector asks for. */
export async function getHistory(viewer: Viewer, filter: { templateId?: string; entityId?: string | null; year?: number | null }, today: IsoDate = todayInVietnam()): Promise<HistoryRow[]> {
  const range = filter.year ? { dueFrom: `${filter.year}-01-01`, dueTo: `${filter.year}-12-31` } : {};
  const items = (await listInstances(viewer, { templateId: filter.templateId, entityId: filter.entityId, ...range, limit: EXPORT_ROW_LIMIT }, today)).filter((item) => item.status === "done" || item.status === "cancelled" || (item.dueDate !== null && item.dueDate < today));
  items.sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "") || a.entityCode.localeCompare(b.entityCode) || a.title.localeCompare(b.title));
  const files = items.length === 0 ? [] : await db().select({ id: schema.storedFile.id, fileName: schema.storedFile.fileName, ownerId: schema.storedFile.ownerId }).from(schema.storedFile).where(and(eq(schema.storedFile.ownerType, OBLIGATION_FILE_OWNER), inArray(schema.storedFile.ownerId, items.map((item) => item.instanceId)), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).orderBy(asc(schema.storedFile.createdAt));
  const byInstance = Map.groupBy(files, (file) => file.ownerId);
  return items.map((item) => ({ ...item, files: (byInstance.get(item.instanceId) ?? []).map(({ id, fileName }) => ({ id, fileName })) }));
}

type Locale = "vi" | "en";
const display = (date: IsoDate | null) => (date ? date.split("-").reverse().join("/") : null);

export async function buildHistoryExport(viewer: Viewer, filter: { templateId?: string; entityId?: string | null; year?: number | null }, locale: Locale): Promise<CsvFile> {
  const rows = await getHistory(viewer, filter);
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
  return { fileName: `compliance-history-${todayInVietnam()}.csv`, csv: toCsv(columns, rows), rowCount: rows.length, truncated: rows.length >= EXPORT_ROW_LIMIT };
}
