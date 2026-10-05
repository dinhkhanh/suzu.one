// The CRM's lists as files (FR-PLT-37). Each builder calls the screen's own service function with
// the screen's viewer — so a file holds the rows the list shows, and a money cell only where the
// list shows it (`seesMoney`, `seesReceivables`, a deal's own `value`).
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, toTable } from "@/modules/platform/export/table";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type AccountFilters, type AccountListItem, listAccounts } from "./accounts";
import { type DealFilters, type DealView, listDealPage } from "./deals";
import type { CrmViewer } from "./policy";
import { stageName } from "./stages";

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en, namespace: "crm" });

export async function buildAccountsExport(viewer: CrmViewer, filters: AccountFilters, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const today = todayInVietnam();
  const all = await listAccounts(viewer, filters, today);
  const rows = all.slice(0, EXPORT_ROW_LIMIT);
  const t = translator(locale);
  // The page's own rule: a money column appears when any row may show it; a row that may not has a blank cell.
  const showMoney = all.some((row) => row.seesMoney);
  const showReceivables = all.some((row) => row.seesReceivables);
  const columns: ExportColumn<AccountListItem>[] = [
    { header: t("accounts.columns.account"), value: (row) => row.client.name },
    { header: t("account.fields.code"), value: (row) => row.client.code },
    { header: t("account.fields.tier"), value: (row) => (row.profile?.tier ? t(`enums.tier.${row.profile.tier as "a"}`) : null) },
    { header: t("accounts.columns.lifecycle"), value: (row) => t(`enums.lifecycle.${(row.profile?.lifecycle ?? "prospect") as "active"}`) },
    { header: t("accounts.columns.manager"), value: (row) => row.managerName },
    { header: t("accounts.columns.projects"), value: (row) => row.signals.openProjects },
    { header: t("accounts.columns.deals"), value: (row) => row.signals.openDeals },
    ...(showMoney ? [{ header: t("accounts.columns.pipeline"), value: (row: AccountListItem) => (row.seesMoney ? row.signals.pipelineVnd : null) }] : []),
    ...(showReceivables ? [{ header: t("accounts.columns.overdue"), value: (row: AccountListItem) => (row.seesReceivables ? row.signals.overdueVnd : null) }] : []),
    { header: t("accounts.columns.lastActivity"), value: (row) => row.signals.lastActivityOn },
    { header: t("accounts.columns.nextFollowUp"), value: (row) => row.signals.nextFollowUpOn },
  ];
  const file: ExportFile = { fileName: `accounts-${today}`, table: toTable(columns, rows), rowCount: rows.length, truncated: all.length > rows.length };
  return { file, total: all.length };
}

export async function buildDealsExport(viewer: CrmViewer, filters: DealFilters, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const { rows, total } = await listDealPage(viewer, filters, 1, EXPORT_ROW_LIMIT);
  const t = translator(locale);
  // A deal's value is present only for a reader who may see it (`canSeeDealValue`): the others get blanks.
  const columns: ExportColumn<DealView>[] = [
    { header: t("deals.columns.deal"), value: (row) => row.title },
    { header: t("account.fields.code"), value: (row) => row.code },
    { header: t("deals.columns.account"), value: (row) => row.accountName },
    { header: t("deals.columns.stage"), value: (row) => stageName(row.stage, locale) },
    { header: t("deals.columns.owner"), value: (row) => row.ownerName },
    { header: t("deals.columns.close"), value: (row) => row.expectedCloseOn },
    { header: t("deals.columns.value"), value: (row) => row.value?.totalVnd ?? null },
    { header: t("deals.columns.weighted"), value: (row) => (row.value && row.status === "open" ? row.value.weightedVnd : null) },
  ];
  const file: ExportFile = { fileName: `deals-${todayInVietnam()}`, table: toTable(columns, rows), rowCount: rows.length, truncated: total > rows.length };
  return { file, total };
}
