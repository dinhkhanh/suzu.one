// "All requests" as a file (FR-PLT-37): the oversight list's own query, with the same entity reach.
// The names of the request builder's types live in the composition root, which a module may not
// import, so the caller (the action in src/app/(app)/approvals) passes them in as `typeLabels`;
// every other type is named from the message bundle, as on the page.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, exportFile } from "@/modules/platform/export/table";
import type { entityReach } from "@/modules/platform/rbac/policy";
import en from "../../../../messages/en.json";
import vi from "../../../../messages/vi.json";
import { listAllRequests, type OversightFilter, type OversightRow } from "./service";

type Locale = "vi" | "en";

export async function buildAllRequestsExport(reach: ReturnType<typeof entityReach>, filter: OversightFilter, typeLabels: ReadonlyMap<string, string>, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  // One more than a file carries, so that "there were more" is known.
  const rows = await listAllRequests(reach, filter, EXPORT_ROW_LIMIT + 1);
  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en });
  const label = (type: string) => typeLabels.get(type) ?? (t.has(`approvals.types.${type}` as never) ? t(`approvals.types.${type}` as never) : type);
  const columns: ExportColumn<OversightRow>[] = [
    { header: t("approvals.columns.type"), value: (row) => label(row.type) },
    { header: t("approvals.columns.request"), value: (row) => row.summary || label(row.type) },
    { header: t("approvals.columns.requester"), value: (row) => row.requesterName },
    { header: t("approvals.columns.status"), value: (row) => t(`approvals.status.${row.status}` as never) },
    { header: t("approvals.columns.waitingOn"), value: (row) => row.waitingOn },
    { header: t("approvals.columns.submitted"), value: (row) => todayInVietnam(row.createdAt) },
    { header: t("approvals.columns.decided"), value: (row) => (row.decidedAt ? todayInVietnam(row.decidedAt) : null) },
  ];
  return { file: exportFile(`requests-${todayInVietnam()}`, columns, rows, rows.length), total: rows.length };
}
