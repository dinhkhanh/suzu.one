// Read-only pieces of the digital-asset register: the platform chip, the filters and the list.
// Server components — nothing here needs the browser.
import { getTranslations } from "next-intl/server";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { DIGITAL_KINDS, DIGITAL_PLATFORMS, type AccessStatus, type DigitalPlatform } from "../enums";
import type { DigitalAssetListRow } from "../digital";
import { RecordLink } from "@/components/ui/record-link";

// A hue per platform, to tell them apart at a glance. It means nothing (docs/UI.md: tones).
const PLATFORM_TONE: Record<DigitalPlatform, BadgeVariant> = { facebook: "indigo", instagram: "pink", tiktok: "teal", youtube: "orange", zalo: "info", linkedin: "indigo", threads: "violet", x: "secondary", google: "orange", website: "teal", other: "outline" };

export async function PlatformBadge({ platform }: { platform: DigitalPlatform }) {
  const t = await getTranslations("assets.digital.platform");
  return <Badge variant={PLATFORM_TONE[platform]}>{t(platform)}</Badge>;
}

/** The reader's own standing on an asset: in, or waiting for an answer. */
export async function AccessBadge({ status, level }: { status: AccessStatus; level: string }) {
  const t = await getTranslations("assets.digital");
  return (
    <Badge dot variant={status === "requested" ? "warning" : statusTone(status)}>
      {status === "requested" ? t("access.status.requested") : t(`level.${level}`)}
    </Badge>
  );
}

export type DigitalFilters = { platform?: string; kind?: string; entityId?: string; search?: string; mine?: string };

export async function DigitalFilterBar({ query, entities }: { query: DigitalFilters; entities: { id: string; code: string; shortName: string | null }[] }) {
  const t = await getTranslations("assets.digital");
  return (
    <form method="get" action="/assets/digital" className="toolbar">
      <Input name="search" type="search" defaultValue={query.search ?? ""} placeholder={t("filters.searchHint")} aria-label={t("filters.search")} className="w-full sm:w-64" />
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
        {t("fields.platform")}
        <Select name="platform" defaultValue={query.platform ?? ""}>
          <option value="">{t("filters.any")}</option>
          {DIGITAL_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {t(`platform.${platform}`)}
            </option>
          ))}
        </Select>
      </Label>
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-44">
        {t("fields.kind")}
        <Select name="kind" defaultValue={query.kind ?? ""}>
          <option value="">{t("filters.any")}</option>
          {DIGITAL_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kind.${kind}`)}
            </option>
          ))}
        </Select>
      </Label>
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
        {t("fields.entity")}
        <Select name="entityId" defaultValue={query.entityId ?? ""}>
          <option value="">{t("filters.any")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName ?? entity.code}
            </option>
          ))}
        </Select>
      </Label>
      {query.mine ? <input type="hidden" name="mine" value="1" /> : null}
      <Button type="submit" variant="outline">
        {t("filters.apply")}
      </Button>
    </form>
  );
}

export async function DigitalTable({ rows }: { rows: readonly DigitalAssetListRow[] }) {
  const t = await getTranslations("assets.digital");
  return (
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow>
          <TableHead kind="text">{t("fields.name")}</TableHead>
          <TableHead kind="select">{t("fields.platform")}</TableHead>
          <TableHead kind="org">{t("columns.belongsTo")}</TableHead>
          <TableHead kind="person">{t("fields.owner")}</TableHead>
          <TableHead kind="number">{t("columns.people")}</TableHead>
          <TableHead kind="status">{t("columns.myAccess")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <RecordLink kind="digitalAsset" id={row.id} className="font-medium">
                {row.name}
              </RecordLink>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                <span>{t(`kind.${row.kind}`)}</span>
                {row.handle ? <span className="font-mono">{row.handle}</span> : null}
                {row.status !== "active" ? <Badge variant={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge> : null}
                {row.visibility === "restricted" ? <Badge variant="outline">{t("visibility.restricted")}</Badge> : null}
                {/* What only the person who runs it is shown: somebody waiting, a password to change. */}
                {row.waiting > 0 ? <Badge variant="warning">{t("waitingCount", { count: row.waiting })}</Badge> : null}
                {row.rotationDue ? <Badge variant="destructive">{t("rotation.badge")}</Badge> : null}
              </p>
            </TableCell>
            <TableCell>
              <PlatformBadge platform={row.platform} />
            </TableCell>
            <TableCell>
              {row.ownership === "client" && row.clientName ? <RecordLink kind="account" id={row.clientId}>{row.clientName}</RecordLink> : row.entityName ? <RecordLink kind="entity" id={row.entityId}>{row.entityName}</RecordLink> : "—"}
              {row.ownership === "client" ? <p className="text-xs text-faint">{t("ownership.client")}</p> : null}
            </TableCell>
            <TableCell>{row.ownerName ? <RecordLink kind="person" id={row.ownerPersonId}>{row.ownerName}</RecordLink> : <span className="text-warning">{t("noOwner")}</span>}</TableCell>
            <TableCell kind="number">{row.people}</TableCell>
            <TableCell>{row.mine ? <AccessBadge status={row.mine.status} level={row.mine.level} /> : row.runs ? <span className="text-xs text-muted-foreground">{t("youRun")}</span> : <span className="text-faint">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
