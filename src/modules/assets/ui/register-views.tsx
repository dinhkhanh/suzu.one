// Read-only pieces of the register: the list, the filters, the history and the QR square.
// Server components — nothing here needs the browser.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { ASSET_STATUSES, type AssetStatus } from "../enums";
import type { AssetHistoryEntry, AssetListRow } from "../service";
import { qrSvg } from "../labels";

const STATUS_TONE: Record<AssetStatus, string> = {
  in_stock: "bg-muted text-muted-foreground",
  assigned: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  in_repair: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  lost: "bg-destructive/10 text-destructive",
  disposed: "bg-muted text-muted-foreground line-through",
};

export async function StatusBadge({ status }: { status: AssetStatus }) {
  const t = await getTranslations("assets.enums");
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>;
}

export type RegisterFilters = { entityId?: string; categoryId?: string; status?: string; search?: string };

export async function RegisterFilterBar({ query, entities, categories }: { query: RegisterFilters; entities: { id: string; code: string; shortName: string | null }[]; categories: { id: string; name: string }[] }) {
  const t = await getTranslations("assets.filters");
  return (
    <form method="get" action="/assets" className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("search")}
        <input name="search" defaultValue={query.search ?? ""} placeholder={t("searchHint")} className="h-9 rounded-md border bg-transparent px-3 text-sm text-foreground" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("entity")}
        <Select name="entityId" defaultValue={query.entityId ?? ""} className="h-9">
          <option value="">{t("any")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName ?? entity.code}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("category")}
        <Select name="categoryId" defaultValue={query.categoryId ?? ""} className="h-9">
          <option value="">{t("any")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("status")}
        <Select name="status" defaultValue={query.status ?? ""} className="h-9">
          <option value="">{t("any")}</option>
          {ASSET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </label>
      <button type="submit" className="h-9 rounded-md border px-3 text-sm">
        {t("apply")}
      </button>
    </form>
  );
}

export async function RegisterTable({ rows, showMoney }: { rows: readonly AssetListRow[]; showMoney: boolean }) {
  const t = await getTranslations("assets.columns");
  const tEmpty = await getTranslations("assets");
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{tEmpty("empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">{t("code")}</th>
            <th className="py-2 pr-3">{t("name")}</th>
            <th className="py-2 pr-3">{t("category")}</th>
            <th className="py-2 pr-3">{t("entity")}</th>
            <th className="py-2 pr-3">{t("status")}</th>
            <th className="py-2 pr-3">{t("holder")}</th>
            {showMoney ? <th className="py-2 pr-3 text-right">{t("purchasePrice")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="py-2 pr-3 font-mono text-xs">
                <Link href={`/assets/${row.id}`} className="underline">
                  {row.code}
                </Link>
              </td>
              <td className="py-2 pr-3">
                {row.name}
                {row.serial ? <span className="block text-xs text-muted-foreground">{row.serial}</span> : null}
              </td>
              <td className="py-2 pr-3">{row.categoryName}</td>
              <td className="py-2 pr-3">{row.entityName}</td>
              <td className="py-2 pr-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-2 pr-3">
                {row.holderName ?? "—"}
                {row.holderName && !row.handoverConfirmedAt ? <span className="ml-1 text-xs text-amber-600">●</span> : null}
              </td>
              {showMoney ? <td className="py-2 pr-3 text-right tabular-nums">{row.purchasePrice === null ? "—" : row.purchasePrice.toLocaleString("vi-VN")}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function AssetHistory({ entries }: { entries: readonly AssetHistoryEntry[] }) {
  const t = await getTranslations("assets.events");
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
          <Badge variant="secondary">{t.has(entry.type) ? t(entry.type) : entry.type}</Badge>
          <span className="text-xs text-muted-foreground">{entry.at.toLocaleString("vi-VN")}</span>
          {entry.actorName ? <span className="text-xs text-muted-foreground">· {entry.actorName}</span> : null}
          {entry.note ? <span className="w-full text-muted-foreground">{entry.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The asset's own QR, drawn inline. `dangerouslySetInnerHTML` is safe here in the one way that
 * matters: the SVG is built by `qrSvg` out of a boolean matrix, so no value from the database
 * reaches the markup — only the token decides which squares are black.
 */
export function AssetQr({ url, size = 160 }: { url: string; size?: number }) {
  return <div className="inline-block rounded-md border bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg(url, { size }) }} />;
}
