// Builds the finance export files of the requests screens (FR-PLT-37). Each builder calls the
// same service function as its screen, with the reach the screen takes from the same principal —
// so a file never holds more than the list shows. The actions in export-actions.ts wrap these in
// the pipeline that audits who exported what.
import "server-only";
import { createTranslator } from "next-intl";
import { addDays, todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, exportFile } from "@/modules/platform/export/table";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type ClaimListRow, listExpenseClaims } from "./expense";
import { listPayouts, type PayoutRow } from "./payments";

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });
const dayOf = (value: Date | null) => (value ? todayInVietnam(value) : null);

/** Finance's "to pay" queue: what is waiting and what was paid in the last sixty days, as the screen lists them. */
export async function buildPayoutsExport(principal: Principal, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const today = todayInVietnam();
  // One more than a file carries, so a longer queue is reported as cut.
  const rows = await listPayouts(entityReach(principal, "payroll:pay"), { paidSince: addDays(today, -60), limit: EXPORT_ROW_LIMIT + 1 });
  const t = translator(locale);
  const columns: ExportColumn<PayoutRow>[] = [
    { header: t("requests.pay.columns.requester"), value: (row) => row.requesterName },
    { header: t("requests.pay.columns.request"), value: (row) => row.summary },
    { header: t("approvals.columns.type"), value: (row) => (locale === "en" ? row.nameEn : row.nameVi) },
    { header: t("requests.pay.title"), value: (row) => t(`requests.pay.kinds.${row.payout}`) },
    { header: t("requests.pay.columns.amount"), value: (row) => row.amount },
    { header: t("requests.pay.columns.advance"), value: (row) => row.settlement.nettedAdvance },
    { header: t("requests.pay.columns.toPay"), value: (row) => row.settlement.toPay },
    { header: t("requests.pay.columns.approved"), value: (row) => dayOf(row.approvedAt) },
    { header: t("requests.pay.columns.paid"), value: (row) => row.paidOn },
    { header: t("requests.pay.reference"), value: (row) => row.paidReference },
  ];
  return { file: exportFile(`requests-to-pay-${today}`, columns, rows), total: rows.length };
}

/** Finance's expense-claims desk: every claim in the entities the reader pays, newest first, with where payroll has put it. */
export async function buildExpenseClaimsExport(principal: Principal, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const rows = await listExpenseClaims({ reach: entityReach(principal, "payroll:pay") }, EXPORT_ROW_LIMIT + 1);
  const t = translator(locale);
  const columns: ExportColumn<ClaimListRow>[] = [
    { header: t("requests.expense.columns.requester"), value: (row) => row.requesterName },
    { header: t("requests.expense.columns.summary"), value: (row) => row.summary },
    { header: t("requests.expense.amount"), value: (row) => row.total },
    { header: t("requests.expense.columns.filed"), value: (row) => dayOf(row.createdAt) },
    { header: t("requests.expense.columns.status"), value: (row) => t(`requests.expense.status.${row.status}` as "requests.expense.status.approved") },
    { header: t("requests.expense.columns.payment"), value: (row) => (row.payment ? t("requests.expense.postedTo", { month: row.payment.month }) : row.status === "approved" ? t("requests.expense.awaitingPayroll") : null) },
  ];
  return { file: exportFile(`expense-claims-${todayInVietnam()}`, columns, rows), total: rows.length };
}
