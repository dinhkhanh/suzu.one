import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "cn";
import { todayInVietnam } from "@/lib/dates";
import { isMonthKey, monthGrid, shiftMonth } from "@/lib/month-grid";
import { getDaysOff } from "@/modules/attendance/service";
import { canReadOps, listForCalendar, readableEntities } from "@/modules/ops/service";
import { isUuid, OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("complianceCalendar");

const MAX_PER_DAY = 6;

// The compliance calendar (FR-OPS-07): every obligation on its (shifted) due date, in its status colour.
export default async function OpsCalendarPage({ searchParams }: PageProps<"/ops/calendar">) {
  const user = await requireUser();
  if (!canReadOps(user.principal)) notFound();
  const params = await searchParams;
  const query = overviewQuery(params);
  const today = todayInVietnam();
  const month = isMonthKey(params.month) ? params.month : today.slice(0, 7);
  const grid = monthGrid(month);
  const entities = await readableEntities(user.principal);
  const entityId = isUuid(params.entity) && entities.some((entity) => entity.id === params.entity) ? params.entity : null;

  const [all, daysOff] = await Promise.all([
    listForCalendar({ principal: user.principal, personId: user.person.id }, grid, { ...query, entityId }, today),
    // Days off of the chosen entity, or the group's calendar when every entity is shown.
    getDaysOff(entityId, grid.from, grid.to),
  ]);
  const items = all.filter((item) => item.colour !== "cancelled" && entities.some((entity) => entity.id === item.entityId));
  const byDate = Map.groupBy(items, (item) => item.dueDate!);
  const offNames = new Map(daysOff.map((day) => [day.date, day.name]));
  const owners = [...new Map(items.flatMap((item) => (item.assigneePersonId ? [[item.assigneePersonId, item.assigneeName ?? ""] as const] : []))).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  const t = await getTranslations("ops");
  const format = await getFormatter();
  const href = (next: { month?: string; entity?: string | null }) => `/ops/calendar${overviewParams(query, { month: next.month ?? month, entity: next.entity === undefined ? entityId : next.entity })}`;
  const weekdays = grid.weeks[0].map((day) => format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short" }));
  const monthLabel = format.dateTime(new Date(`${month}-01T00:00:00`), { month: "long", year: "numeric" });

  return (
    <Page width="wide">
      <PageHeader title={t("calendar.title")} description={t("calendar.description")} />
      <OpsNav active="calendar" reads />
      <OverviewFilters action="/ops/calendar" query={query} owners={owners} hidden={{ month, entity: entityId }} />

      <Section
        title={monthLabel}
        action={
          <span className="flex items-center gap-1">
            <Button nativeButton={false} variant="ghost" size="icon-sm" render={<Link href={href({ month: shiftMonth(month, -1) })} aria-label={t("calendar.previous")} />}>
              <ChevronLeftIcon />
            </Button>
            <Button nativeButton={false} variant="ghost" size="sm" render={<Link href={href({ month: today.slice(0, 7) })} />}>
              {t("calendar.today")}
            </Button>
            <Button nativeButton={false} variant="ghost" size="icon-sm" render={<Link href={href({ month: shiftMonth(month, 1) })} aria-label={t("calendar.next")} />}>
              <ChevronRightIcon />
            </Button>
          </span>
        }
      >
        {entities.length > 1 ? (
          <Segmented
            aria-label={t("dashboard.entity")}
            value={entityId ?? ""}
            className="self-start"
            options={[{ value: "", label: t("allEntities"), href: href({ entity: null }) }, ...entities.map((entity) => ({ value: entity.id, label: <span className="font-mono">{entity.code}</span>, href: href({ entity: entity.id }) }))]}
          />
        ) : null}

        {/* The month grid keeps its shape; on a phone its container scrolls sideways. */}
        <div className="w-full min-w-0 overflow-x-auto">
          <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-[14px] border border-border bg-border text-xs">
            {weekdays.map((weekday) => (
              <div key={weekday} className="bg-canvas px-2 py-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-faint uppercase">
                {weekday}
              </div>
            ))}
            {grid.weeks.flat().map((day) => {
              const own = byDate.get(day.date) ?? [];
              const weekend = [0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay());
              const off = offNames.get(day.date);
              return (
                <div key={day.date} className={cn("flex min-h-28 flex-col gap-1 p-1.5", off || weekend ? "bg-canvas" : "bg-background", !day.inMonth && "opacity-50")}>
                  <p className={cn("flex items-center justify-between gap-1 font-mono tabular-nums", day.date === today ? "font-semibold text-foreground" : "text-faint")}>
                    <span className={day.date === today ? "rounded-full bg-primary px-1.5 text-primary-foreground" : ""}>{Number(day.date.slice(8))}</span>
                    {off ? <span className="truncate font-sans text-[10px]">{off}</span> : null}
                  </p>
                  {own.slice(0, MAX_PER_DAY).map((item) => (
                    <Link key={item.taskId} href={`/ops/obligations/${item.taskId}`} title={`${item.title} · ${item.assigneeName ?? t("unassigned")}`} className="flex items-center gap-1 hover:underline">
                      <StatusBadge colour={item.colour} label={item.entityCode} />
                      <span className="truncate">{item.subjectName ? `${item.templateName} — ${item.subjectName}` : item.templateName}</span>
                    </Link>
                  ))}
                  {own.length > MAX_PER_DAY ? (
                    <Link href={`/ops/list${overviewParams(query, { entity: entityId, month: day.date.slice(0, 7) })}`} className="text-link hover:underline">
                      {t("calendar.more", { count: own.length - MAX_PER_DAY })}
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("calendar.legend")}</p>
      </Section>
    </Page>
  );
}
