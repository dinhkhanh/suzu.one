// Builds the leave export file (FR-PLT-37). The builder calls the same service function as the HR
// balances screen, with the same principal — so the file never holds more than the list shows.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { type ExportColumn, type ExportFile, exportFile } from "@/modules/platform/export/table";
import type { Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type BalanceRow, listBalancesForAdmin } from "./admin";

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });

/** HR's balance table for a year: one row per person, a balance and a held-by-pending column per leave type, in days. */
export async function buildLeaveBalancesExport(principal: Principal, year: number, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const rows = await listBalancesForAdmin(principal, year);
  const t = translator(locale);
  const codes = [...new Set(rows.flatMap((row) => row.balances.map((balance) => balance.code)))];
  const days = (row: BalanceRow, code: string, key: "balanceCenti" | "pendingCenti") => {
    const balance = row.balances.find((candidate) => candidate.code === code);
    return balance ? balance[key] / 100 : null;
  };
  const columns: ExportColumn<BalanceRow>[] = [
    { header: t("leave.admin.balances.person"), value: (row) => row.fullName },
    { header: t("people.fields.entity"), value: (row) => row.entityName },
    { header: t("people.fields.department"), value: (row) => row.departmentName },
    ...codes.flatMap((code) => [
      { header: code, value: (row: BalanceRow) => days(row, code, "balanceCenti") },
      { header: `${code} (${t("leave.status.pending")})`, value: (row: BalanceRow) => days(row, code, "pendingCenti") },
    ]),
  ];
  return { file: exportFile(`leave-balances-${year}-${todayInVietnam()}`, columns, rows), total: rows.length };
}
