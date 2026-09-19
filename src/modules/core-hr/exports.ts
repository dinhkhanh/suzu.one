// Builds export files (FR-PLT-37). Each builder calls the same service function as its screen,
// with the same principal — so a file can never hold more than the list would show. The actions
// in export-actions.ts wrap these in the pipeline that audits who exported what.
import "server-only";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { type CsvFile, EXPORT_ROW_LIMIT, type ExportColumn, toCsv } from "@/modules/platform/export/csv";
import type { Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { getHeadcountReport, type HeadcountFilters } from "./reports";
import { listPeople, type PeopleFilters, type PeopleListRow } from "./service";

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });

export async function buildPeopleExport(principal: Principal, filters: Omit<PeopleFilters, "page">, locale: Locale): Promise<{ file: CsvFile; total: number }> {
  const { rows, total } = await listPeople(principal, { ...filters, page: 1 }, { pageSize: EXPORT_ROW_LIMIT });
  const t = translator(locale);
  // The tier shaping is the list's own: personal-tier cells are already null where the viewer may not read them.
  const columns: ExportColumn<PeopleListRow>[] = [
    { header: t("people.fields.employeeCode"), value: (row) => row.employeeCode },
    { header: t("people.fields.fullName"), value: (row) => row.fullName },
    { header: t("people.fields.workEmail"), value: (row) => row.workEmail },
    { header: t("people.fields.entity"), value: (row) => row.entityName },
    { header: t("people.fields.department"), value: (row) => row.departmentName },
    { header: t("people.fields.position"), value: (row) => row.positionName },
    { header: t("people.fields.managerId"), value: (row) => row.managerName },
    { header: t("people.fields.workforceType"), value: (row) => (row.workforceType ? t(`people.workforceType.${row.workforceType}`) : null) },
    { header: t("people.fields.status"), value: (row) => (row.status ? t(`people.status.${row.status}`) : null) },
  ];
  const file: CsvFile = { fileName: `people-${todayInVietnam()}.csv`, csv: toCsv(columns, rows), rowCount: rows.length, truncated: total > rows.length };
  return { file, total };
}

export async function buildHeadcountExport(principal: Principal, filters: HeadcountFilters, locale: Locale): Promise<{ file: CsvFile; scoped: boolean }> {
  const report = await getHeadcountReport(principal, filters);
  if (!report) throw new ActionError("forbidden");
  const t = translator(locale);
  const label = (group: string, key: string) => {
    const id = `reports.headcount.keys.${group}.${key}`;
    return t.has(id as never) ? t(id as never) : key === "unknown" ? t("reports.headcount.unknown") : key;
  };
  const { snapshot, movement } = report;
  // One long table — section, group, count — which pivots cleanly in a spreadsheet.
  const lines: { section: string; key: string; count: number | string }[] = [
    { section: t("reports.headcount.total"), key: snapshot.asOf, count: snapshot.total },
    ...(["byEntity", "byDepartment", "byWorkforceType", "byGender", "byAge", "bySeniority"] as const).flatMap((group) => snapshot[group].map((row) => ({ section: t(`reports.headcount.groups.${group}`), key: label(group, row.key), count: row.count }))),
    { section: t("reports.headcount.movement"), key: t("reports.headcount.opening"), count: movement.opening },
    { section: t("reports.headcount.movement"), key: t("reports.headcount.joiners"), count: movement.joiners },
    { section: t("reports.headcount.movement"), key: t("reports.headcount.leavers"), count: movement.leavers },
    { section: t("reports.headcount.movement"), key: t("reports.headcount.closing"), count: movement.closing },
    { section: t("reports.headcount.movement"), key: t("reports.headcount.turnover"), count: movement.turnoverBp === null ? "" : `${(movement.turnoverBp / 100).toFixed(2)}%` },
    ...report.contractsExpiring.map((row) => ({ section: t("reports.headcount.contractsExpiring"), key: `${row.employeeCode} ${row.fullName} (${t(`records.contracts.types.${row.type}` as never)})`, count: row.endDate })),
    ...report.probations.map((row) => ({ section: t("reports.headcount.probations"), key: `${row.employeeCode} ${row.fullName}`, count: row.endDate })),
  ];
  const csv = toCsv(
    [
      { header: t("reports.headcount.columns.section"), value: (row: (typeof lines)[number]) => row.section },
      { header: t("reports.headcount.columns.group"), value: (row) => row.key },
      { header: t("reports.headcount.columns.value"), value: (row) => row.count },
    ],
    lines,
  );
  const file: CsvFile = { fileName: `headcount-${filters.asOf}.csv`, csv, rowCount: lines.length, truncated: false };
  return { file, scoped: report.scoped };
}
