// The asset register as a file (FR-AST-01, FR-PLT-37). The same service function as the screen,
// with the same principal — so the file holds the rows the register shows, with the purchase price
// only where the register shows it.
import "server-only";
import { createTranslator } from "next-intl";
import { todayInVietnam } from "@/lib/dates";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, toTable } from "@/modules/platform/export/table";
import type { Principal } from "@/modules/platform/rbac/policy";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { canReadAssetMoney } from "./policy";
import { type AssetFilter, type AssetListRow, listAssetPage } from "./service";

type Locale = "vi" | "en";

export async function buildAssetsExport(principal: Principal, filter: AssetFilter, locale: Locale): Promise<{ file: ExportFile; total: number }> {
  const { rows, total } = await listAssetPage(principal, filter, 1, EXPORT_ROW_LIMIT);
  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en, namespace: "assets" });
  // The page's own rule for the price column; the rows' prices are already null where the reader may not see them.
  const showMoney = canReadAssetMoney(principal, filter.entityId);
  const columns: ExportColumn<AssetListRow>[] = [
    { header: t("columns.code"), value: (row) => row.code },
    { header: t("columns.name"), value: (row) => row.name },
    { header: t("columns.category"), value: (row) => row.categoryName },
    { header: t("columns.entity"), value: (row) => row.entityName },
    { header: t("columns.holder"), value: (row) => row.holderName },
    { header: t("columns.status"), value: (row) => t(`enums.status.${row.status}`) },
    ...(showMoney ? [{ header: t("columns.purchasePrice"), value: (row: AssetListRow) => row.purchasePrice }] : []),
  ];
  const file: ExportFile = { fileName: `assets-${todayInVietnam()}`, table: toTable(columns, rows), rowCount: rows.length, truncated: total > rows.length };
  return { file, total };
}
