// Read-only pieces of the register: the list, the filters, the history and the QR square.
// Server components — nothing here needs the browser.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
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
  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead kind="id">{t("code")}</TableHead>
          <TableHead kind="text">{t("name")}</TableHead>
          <TableHead kind="select">{t("category")}</TableHead>
          <TableHead kind="org">{t("entity")}</TableHead>
          <TableHead kind="status">{t("status")}</TableHead>
          <TableHead kind="person">{t("holder")}</TableHead>
          {showMoney ? <TableHead kind="money">{t("purchasePrice")}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableEmpty>{tEmpty("empty")}</TableEmpty> : null}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell kind="id">
              <Link href={`/assets/${row.id}`} className="underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              {row.name}
              {row.serial ? <span className="block text-xs text-muted-foreground">{row.serial}</span> : null}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{row.categoryName}</Badge>
            </TableCell>
            <TableCell>{row.entityName}</TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell>
              {row.holderName ?? "—"}
              {row.holderName && !row.handoverConfirmedAt ? <span className="ml-1 text-xs text-amber-600">●</span> : null}
            </TableCell>
            {showMoney ? <TableCell kind="money">{row.purchasePrice === null ? "—" : row.purchasePrice.toLocaleString("vi-VN")}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export async function AssetHistory({ entries }: { entries: readonly AssetHistoryEntry[] }) {
  const t = await getTranslations("assets.events");
  return (
    <List>
      {entries.map((entry) => (
        <ListItem key={entry.id} className="flex-wrap items-baseline gap-2">
          <Badge variant="secondary">{t.has(entry.type) ? t(entry.type) : entry.type}</Badge>
          <span className="text-xs text-muted-foreground">{entry.at.toLocaleString("vi-VN")}</span>
          {entry.actorName ? <span className="text-xs text-muted-foreground">· {entry.actorName}</span> : null}
          <RichText text={entry.note} className="w-full text-muted-foreground" />
        </ListItem>
      ))}
    </List>
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
