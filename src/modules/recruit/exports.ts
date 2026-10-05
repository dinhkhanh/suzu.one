// Builds the candidate export file (FR-PLT-37). The builder calls the same service function as the
// candidates screen, with the same principal — so the file holds the rows the viewer's own
// recruitment reach (`candidateReach`) lets the list show, and the columns the list shows.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, toTable } from "@/modules/platform/export/table";
import type { Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type CandidateListRow, listCandidatePage } from "./service";

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });

export type CandidateExportFilters = { query?: string; talentPool?: boolean };

export async function buildCandidatesExport(principal: Principal, filters: CandidateExportFilters, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const { rows, total } = await listCandidatePage(principal, { query: filters.query, talentPool: filters.talentPool }, 1, EXPORT_ROW_LIMIT);
  const t = translator(locale);
  const columns: ExportColumn<CandidateListRow>[] = [
    { header: t("recruit.columns.candidate"), value: (row) => row.fullName },
    { header: t("recruit.columns.currentTitle"), value: (row) => row.currentTitle },
    { header: t("recruit.columns.source"), value: (row) => t(`recruit.source.${row.source}`) },
    { header: t("recruit.columns.tags"), value: (row) => row.tags.join("; ") },
    { header: t("recruit.columns.createdAt"), value: (row) => todayInVietnam(row.createdAt) },
    { header: t("recruit.reports.applications"), value: (row) => row.applications },
  ];
  const file: ExportFile = { fileName: `candidates-${filters.talentPool ? "talent-pool-" : ""}${todayInVietnam()}`, table: toTable(columns, rows), rowCount: rows.length, truncated: total > rows.length };
  return { file, total };
}
