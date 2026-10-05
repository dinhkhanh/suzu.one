// The audit log as a file (FR-PLT-37): the same query as /admin/audit with the same entity reach,
// minus the before/after snapshots — those stay on the screen, one entry at a time.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, toTable } from "@/modules/platform/export/table";
import { listEntities } from "@/modules/platform/org/service";
import en from "../../../../messages/en.json";
import vi from "../../../../messages/vi.json";
import { type AuditFilters, type AuditRow, listAuditEntries } from "./service";

type Locale = "vi" | "en";
type Reach = { all: true } | { all: false; entityIds: string[] };

/** `2026-10-05 14:30`, Vietnam time. */
const vietnamMinute = (at: Date) => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

export async function buildAuditExport(reach: Reach, filters: Omit<AuditFilters, "page">, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const [{ rows, total }, entities] = await Promise.all([listAuditEntries(reach, { ...filters, page: 1 }, { pageSize: EXPORT_ROW_LIMIT }), listEntities()]);
  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en });
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const columns: ExportColumn<AuditRow>[] = [
    { header: t("audit.when"), value: (row) => vietnamMinute(row.occurredAt) },
    { header: t("audit.who"), value: (row) => row.actorEmail ?? t("audit.system") },
    { header: t("audit.action"), value: (row) => row.action },
    { header: t("audit.filters.resourceType"), value: (row) => row.resourceType },
    { header: t("audit.resourceId"), value: (row) => row.resourceId },
    { header: t("audit.filters.entity"), value: (row) => (row.entityId ? (entityName.get(row.entityId) ?? row.entityId) : null) },
    { header: t("audit.summary"), value: (row) => row.summary },
  ];
  const file: ExportFile = { fileName: `audit-${todayInVietnam()}`, table: toTable(columns, rows), rowCount: rows.length, truncated: total > rows.length };
  return { file, total };
}
