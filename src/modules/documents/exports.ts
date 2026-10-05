// The issued-documents register as a file (FR-PLT-37). It calls the register's own query with the
// same viewer, so the tier of each paper is re-checked against its subject exactly as on /documents.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, exportFile } from "@/modules/platform/export/table";
import type { Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type DocumentListRow, listIssuedDocuments, type RegisterFilter } from "./service";

type Locale = "vi" | "en";

export async function buildIssuedDocumentsExport(principal: Principal, filter: RegisterFilter, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  // One more than a file carries, so that "the register had more" is known.
  const rows = await listIssuedDocuments(principal, filter, { limit: EXPORT_ROW_LIMIT + 1 });
  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en });
  const columns: ExportColumn<DocumentListRow>[] = [
    { header: t("documents.columns.number"), value: (row) => row.number },
    { header: t("documents.columns.template"), value: (row) => row.templateName },
    { header: t("documents.register.kind"), value: (row) => t(`documents.kind.${row.kind}`) },
    { header: t("documents.columns.subject"), value: (row) => row.subjectName },
    { header: t("documents.columns.tier"), value: (row) => t(`documents.tier.${row.tier}`) },
    { header: t("documents.columns.by"), value: (row) => row.generatedByName },
    { header: t("documents.columns.at"), value: (row) => todayInVietnam(row.createdAt) },
  ];
  return { file: exportFile(`documents-${todayInVietnam()}`, columns, rows, rows.length), total: rows.length };
}
