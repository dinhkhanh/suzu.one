// Read-only pieces of the register: the list, the filters, the history and the QR square.
// Server components — nothing here needs the browser.
import { getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordLink } from "@/components/ui/record-link";
import type { RecordKind } from "@/lib/record-routes";
import { List, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { ASSET_STATUSES, type AssetStatus } from "../enums";
import type { AssetHistoryEntry, AssetListRow } from "../service";
import { qrSvg } from "../labels";

export async function StatusBadge({ status }: { status: AssetStatus }) {
  const t = await getTranslations("assets.enums");
  return (
    <Badge dot variant={statusTone(status)} className={status === "disposed" ? "line-through" : undefined}>
      {t(`status.${status}`)}
    </Badge>
  );
}

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
};

/** The holder as a disc of initials beside the name; a hollow dot on the disc while the handover is unconfirmed. */
function Holder({ name, confirmed, kind, id }: { name: string; confirmed: boolean; kind: RecordKind; id: string | null }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar size="sm" className="relative">
        <AvatarFallback className="text-[0.625rem] font-medium">{initialsOf(name)}</AvatarFallback>
        {confirmed ? null : <span aria-hidden className="absolute -top-0.5 -right-0.5 z-10 size-2 rounded-full bg-warning ring-2 ring-background" />}
      </Avatar>
      <RecordLink kind={kind} id={id} className="truncate">
        {name}
      </RecordLink>
    </span>
  );
}

/** Where a holder's name leads: the person, the team's people, or the entity that keeps it. */
const holderLink = (row: Pick<AssetListRow, "holderType" | "holderPersonId" | "holderTeamId" | "holderEntityId">): { kind: RecordKind; id: string | null } =>
  row.holderType === "person" ? { kind: "person", id: row.holderPersonId } : row.holderType === "team" ? { kind: "unit", id: row.holderTeamId } : { kind: "entity", id: row.holderEntityId };

export type RegisterFilters = { entityId?: string; categoryId?: string; status?: string; search?: string };

export async function RegisterFilterBar({ query, entities, categories }: { query: RegisterFilters; entities: { id: string; code: string; shortName: string | null }[]; categories: { id: string; name: string }[] }) {
  const [t, tStatus] = await Promise.all([getTranslations("assets.filters"), getTranslations("assets.enums.status")]);
  return (
    <form method="get" action="/assets" className="toolbar">
      <Input name="search" type="search" defaultValue={query.search ?? ""} placeholder={t("searchHint")} aria-label={t("search")} className="w-full sm:w-64" />
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
        {t("entity")}
        <Select name="entityId" defaultValue={query.entityId ?? ""}>
          <option value="">{t("any")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName ?? entity.code}
            </option>
          ))}
        </Select>
      </Label>
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-44">
        {t("category")}
        <Select name="categoryId" defaultValue={query.categoryId ?? ""}>
          <option value="">{t("any")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </Label>
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
        {t("status")}
        <Select name="status" defaultValue={query.status ?? ""}>
          <option value="">{t("any")}</option>
          {ASSET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {tStatus(status)}
            </option>
          ))}
        </Select>
      </Label>
      <Button type="submit" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );
}

export async function RegisterTable({ rows, showMoney, numberFrom }: { rows: readonly AssetListRow[]; showMoney: boolean; /** The first row's number on a later page. */ numberFrom?: number }) {
  const t = await getTranslations("assets.columns");
  const tEmpty = await getTranslations("assets");
  return (
    <Table className="min-w-[720px]" numberFrom={numberFrom}>
      <TableHeader>
        <TableRow>
          <TableHead kind="id">{t("code")}</TableHead>
          <TableHead kind="text">{t("name")}</TableHead>
          <TableHead kind="select">{t("category")}</TableHead>
          <TableHead kind="org">{t("entity")}</TableHead>
          <TableHead kind="person">{t("holder")}</TableHead>
          <TableHead kind="status">{t("status")}</TableHead>
          {showMoney ? <TableHead kind="money">{t("purchasePrice")}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableEmpty>{tEmpty("empty")}</TableEmpty> : null}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell kind="id">
              <RecordLink kind="asset" id={row.id} className="font-medium text-foreground">
                {row.code}
              </RecordLink>
            </TableCell>
            <TableCell>
              <span className="font-medium">{row.name}</span>
              {row.serial ? <span className="block font-mono text-xs text-faint">{row.serial}</span> : null}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{row.categoryName}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <RecordLink kind="entity" id={row.entityId}>
                {row.entityName}
              </RecordLink>
            </TableCell>
            <TableCell>{row.holderName ? <Holder name={row.holderName} confirmed={!!row.handoverConfirmedAt} {...holderLink(row)} /> : <span className="text-faint">—</span>}</TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
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
          <span className="font-mono text-xs text-faint tabular-nums">{entry.at.toLocaleString("vi-VN")}</span>
          {entry.actorName ? (
            <span className="text-xs text-faint">
              ·{" "}
              <RecordLink kind="person" id={entry.actorPersonId}>
                {entry.actorName}
              </RecordLink>
            </span>
          ) : null}
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
  return <div className="inline-block rounded-[10px] border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg(url, { size }) }} />;
}
