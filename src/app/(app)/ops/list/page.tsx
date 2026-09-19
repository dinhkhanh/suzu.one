import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { isMonthKey } from "@/lib/month-grid";
import { canManageLibrary, canManageOps, canReadOps, listInstances, opsReach, STATUS_COLOURS, type StatusColour } from "@/modules/ops/service";
import { SyncButton } from "@/modules/ops/ui/library";
import { OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "Compliance" };

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
  const [all, entities] = await Promise.all([
    listInstances({ principal: user.principal, personId: user.person.id }, { open: narrowed ? undefined : show === "open", entityId, ...query, dueFrom: month ? `${month}-01` : undefined, dueTo: monthEnd, limit: narrowed ? 2000 : 500 }, today),
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
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canManageOps(user.principal) ? <SyncButton /> : null}
      </header>
      <OpsNav active="list" reads={reads} />
      {reads ? <OverviewFilters action="/ops/list" query={query} owners={owners} hidden={{ show: show === "closed" ? "closed" : null, entity: entityId, month, colour }} /> : null}

      <nav className="flex flex-wrap items-center gap-1">
        <Link href={href({ show: "open" })} className={tab(show === "open" && !narrowed)}>
          {t("tabs.open")}
        </Link>
        <Link href={href({ show: "closed" })} className={tab(show === "closed" && !narrowed)}>
          {t("tabs.closed")}
        </Link>
        <span className="mx-2 h-4 border-l" />
        <Link href={href({ entity: null })} className={tab(!entityId)}>
          {t("allEntities")}
        </Link>
        {visibleEntities.map((entity) => (
          <Link key={entity.id} href={href({ entity: entity.id })} className={tab(entityId === entity.id)}>
            {entity.code}
          </Link>
        ))}
      </nav>

      {narrowed ? (
        <p className="text-sm text-muted-foreground">
          {t("list.narrowed", { count: items.length, month: month ? month.split("-").reverse().join("/") : "—", colour: colour ? t(`enums.colour.${colour}`) : "—", hasMonth: month ? "yes" : "no", hasColour: colour ? "yes" : "no" })}{" "}
          <Link href={href({ show })} className="underline">
            {t("filters.clear")}
          </Link>
        </p>
      ) : null}
      {show === "open" && !narrowed ? <p className="text-sm text-muted-foreground">{t("summary", { total: items.length, overdue: counts.overdue, dueSoon: counts.dueSoon })}</p> : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item) => (
            <li key={item.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/ops/obligations/${item.taskId}`} className="font-medium hover:underline">
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {[t(`enums.authority.${item.authority}`), item.assigneeName ?? t("unassigned"), item.dueDate ? t("due", { date: format.dateTime(new Date(`${item.dueDate}T00:00:00`), { dateStyle: "medium" }) }) : null, item.dueDate && item.dueDate !== item.nominalDueDate ? t("shifted") : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {item.escalationLevel > 0 ? <Badge variant="destructive">{t(`escalation.level${item.escalationLevel}`)}</Badge> : null}
              {item.unreviewed ? <Badge variant="outline">{t("unreviewed")}</Badge> : null}
              <StatusBadge colour={item.colour} label={t(`enums.colour.${item.colour}`)} />
            </li>
          ))}
        </ul>
      )}
      {canManageLibrary(user.principal) && items.some((item) => item.unreviewed) ? <p className="text-xs text-muted-foreground">{t("unreviewedHint")}</p> : null}
    </div>
  );
}
