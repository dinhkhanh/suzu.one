import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { Pager, readPage } from "@/components/ui/pager";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { isMonthKey } from "@/lib/month-grid";
import { canManageLibrary, canManageOps, canReadOps, type InstanceListItem, listInstancePage, listInstances, opsReach, STATUS_COLOURS, type StatusColour } from "@/modules/ops/service";
import { SyncButton } from "@/modules/ops/ui/library";
import { OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("compliance");

type Band = "overdue" | "soon" | "later";
/** Rows per page of the open and the closed register (PERF-03); a month or a colour is one page of up to 2,000. */
const PAGE_SIZE = { open: 500, closed: 100 } as const;
const BANDS: Band[] = ["overdue", "soon", "later"];

// Obligations by due date (FR-OPS-02): open or closed, or — coming from a dashboard cell — one entity, month and status colour.
export default async function OpsListPage({ searchParams }: PageProps<"/ops/list">) {
  const user = await requireUser();
  const params = await searchParams;
  const show = params.show === "closed" ? "closed" : "open";
  const entityId = typeof params.entity === "string" && /^[0-9a-f-]{36}$/.test(params.entity) ? params.entity : null;
  const today = todayInVietnam();
  const reads = canReadOps(user.principal);
  const query = overviewQuery(params);
  const month = isMonthKey(params.month) ? params.month : null;
  const colour = typeof params.colour === "string" && (STATUS_COLOURS as readonly string[]).includes(params.colour) ? (params.colour as StatusColour) : null;
  // A month or a colour cuts across open and closed: the tabs step aside.
  const narrowed = !!(month || colour);
  const monthEnd = month ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10) : undefined;
  const page = narrowed ? 1 : readPage(params.page);
  const viewer = { principal: user.principal, personId: user.person.id };
  const [{ items: all, total }, entities] = await Promise.all([
    narrowed
      ? listInstances(viewer, { entityId, ...query, dueFrom: month ? `${month}-01` : undefined, dueTo: monthEnd, limit: 2000 }, today).then((items) => ({ items, total: items.length }))
      : listInstancePage(viewer, { open: show === "open", entityId, ...query }, page, PAGE_SIZE[show], today),
    listEntities(),
  ]);
  const items = colour ? all.filter((item) => item.colour === colour) : all;
  const owners = [...new Map(all.flatMap((item) => (item.assigneePersonId ? [[item.assigneePersonId, item.assigneeName ?? ""] as const] : []))).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  // Someone without an ops role still sees what is theirs to do or review — and nothing else.
  if (!reads && items.length === 0 && show === "open" && !entityId && !narrowed) notFound();

  const t = await getTranslations("ops");
  const format = await getFormatter();
  const reach = opsReach(user.principal);
  const visibleEntities = entities.filter((entity) => entity.isActive && (reach.all || reach.entityIds.includes(entity.id)));
  const href = (next: { show?: string; entity?: string | null }) => {
    const entity = next.entity === undefined ? entityId : next.entity;
    // Choosing a tab leaves the month / colour cut; choosing an entity keeps it.
    return `/ops/list${overviewParams(query, { show: (next.show ?? show) === "closed" ? "closed" : null, entity, month: next.show ? null : month, colour: next.show ? null : colour })}`;
  };
  const counts = { overdue: items.filter((item) => item.colour === "overdue").length, dueSoon: items.filter((item) => item.colour === "due_soon").length };

  // The open register reads in three bands: what is already late, what the next thirty days hold,
  // and the rest. The rows arrive sorted by due date, so each band keeps that order.
  const banded = show === "open" && !narrowed;
  const horizon = addDays(today, 30);
  const bandOf = (item: InstanceListItem): Band => (item.colour === "overdue" ? "overdue" : item.dueDate && item.dueDate <= horizon ? "soon" : "later");
  const groups: { band: Band; rows: InstanceListItem[] }[] = banded ? BANDS.map((band) => ({ band, rows: items.filter((item) => bandOf(item) === band) })).filter((group) => group.rows.length > 0) : [{ band: "later", rows: items }];

  const row = (item: InstanceListItem) => (
    <TableRow key={item.taskId}>
      <TableCell className="max-w-96 truncate">
        <RecordLink kind="obligation" id={item.taskId} className="font-medium">
          {item.title}
        </RecordLink>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{t(`enums.authority.${item.authority}`)}</Badge>
      </TableCell>
      <TableCell className={item.assigneeName ? undefined : "text-faint"}>{item.assigneeName ? <RecordLink kind="person" id={item.assigneePersonId}>{item.assigneeName}</RecordLink> : t("unassigned")}</TableCell>
      <TableCell kind="date" className={item.colour === "overdue" ? "text-destructive" : undefined}>
        {item.dueDate ? format.dateTime(new Date(`${item.dueDate}T00:00:00`), { dateStyle: "medium" }) : "—"}
        {item.dueDate && item.dueDate !== item.nominalDueDate ? <span className="ps-1.5 text-xs text-faint">({t("shifted")})</span> : null}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <StatusBadge colour={item.colour} label={t(`enums.colour.${item.colour}`)} />
          {item.escalationLevel > 0 ? <Badge variant="destructive">{t(`escalation.level${item.escalationLevel}`)}</Badge> : null}
          {item.unreviewed ? <Badge variant="outline">{t("unreviewed")}</Badge> : null}
        </span>
      </TableCell>
    </TableRow>
  );

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} actions={canManageOps(user.principal) ? <SyncButton /> : null} />
      <OpsNav active="list" reads={reads} />
      {reads ? <OverviewFilters action="/ops/list" query={query} owners={owners} hidden={{ show: show === "closed" ? "closed" : null, entity: entityId, month, colour }} /> : null}

      <div className="toolbar">
        <Segmented
          aria-label={t("nav.list")}
          value={narrowed ? "" : show}
          options={[
            { value: "open", label: t("tabs.open"), href: href({ show: "open" }) },
            { value: "closed", label: t("tabs.closed"), href: href({ show: "closed" }) },
          ]}
        />
        {visibleEntities.length > 1 ? (
          <Segmented
            aria-label={t("dashboard.entity")}
            value={entityId ?? ""}
            options={[{ value: "", label: t("allEntities"), href: href({ entity: null }) }, ...visibleEntities.map((entity) => ({ value: entity.id, label: <span className="font-mono">{entity.code}</span>, href: href({ entity: entity.id }) }))]}
          />
        ) : null}
      </div>

      {narrowed ? (
        <p className="text-sm text-muted-foreground">
          {t("list.narrowed", { count: items.length, month: month ? month.split("-").reverse().join("/") : "—", colour: colour ? t(`enums.colour.${colour}`) : "—", hasMonth: month ? "yes" : "no", hasColour: colour ? "yes" : "no" })}{" "}
          <Link href={href({ show })} className="text-link hover:underline">
            {t("filters.clear")}
          </Link>
        </p>
      ) : null}
      {banded ? (
        <TileGrid>
          <Tile label={t("tabs.open")} value={total} />
          <Tile label={t("dashboard.tiles.overdue")} value={counts.overdue} tone={counts.overdue > 0 ? "destructive" : undefined} />
          <Tile label={t("dashboard.tiles.dueSoon")} value={counts.dueSoon} tone={counts.dueSoon > 0 ? "warning" : undefined} />
        </TileGrid>
      ) : null}

      <Table numberFrom={(page - 1) * PAGE_SIZE[show] + 1}>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("history.columns.obligation")}</TableHead>
            <TableHead kind="select">{t("filters.authority")}</TableHead>
            <TableHead kind="person">{t("history.columns.owner")}</TableHead>
            <TableHead kind="date">{t("history.columns.dueDate")}</TableHead>
            <TableHead kind="status">{t("history.columns.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
          {groups.map((group) => (
            <GroupRows key={group.band} band={banded ? group.band : null} label={t(`list.bands.${group.band}`)} count={group.rows.length}>
              {group.rows.map(row)}
            </GroupRows>
          ))}
        </TableBody>
      </Table>
      {narrowed ? null : <Pager page={page} pageSize={PAGE_SIZE[show]} total={total} href={(to) => `/ops/list${overviewParams(query, { show: show === "closed" ? "closed" : null, entity: entityId, page: to > 1 ? String(to) : null })}`} />}
      {canManageLibrary(user.principal) && items.some((item) => item.unreviewed) ? <p className="text-xs text-muted-foreground">{t("unreviewedHint")}</p> : null}
    </Page>
  );
}

/** A band's rows under its heading — or just the rows, when the register is not banded. */
function GroupRows({ band, label, count, children }: { band: Band | null; label: string; count: number; children: ReactNode }) {
  if (!band) return <>{children}</>;
  return (
    <>
      <TableGroupRow className={band === "overdue" ? "text-destructive" : band === "soon" ? "text-warning" : undefined}>
        {label} <span className="ps-1 font-mono font-normal text-faint tabular-nums">{count}</span>
      </TableGroupRow>
      {children}
    </>
  );
}
