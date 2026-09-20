import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { isMonthKey, monthGrid, shiftMonth } from "@/lib/month-grid";
import { getDaysOff } from "@/modules/attendance/service";
import { canReadOps, listForCalendar, readableEntities } from "@/modules/ops/service";
import { isUuid, OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Compliance calendar" };

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
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;
  const weekdays = grid.weeks[0].map((day) => format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short" }));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("calendar.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("calendar.description")}</p>
      </header>
      <OpsNav active="calendar" reads />
      <OverviewFilters action="/ops/calendar" query={query} owners={owners} hidden={{ month, entity: entityId }} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1">
          <Link href={href({ entity: null })} className={tab(!entityId)}>
            {t("allEntities")}
          </Link>
          {entities.map((entity) => (
            <Link key={entity.id} href={href({ entity: entity.id })} className={tab(entityId === entity.id)}>
              {entity.code}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-sm">
          <Link href={href({ month: shiftMonth(month, -1) })} className="rounded-md border px-2 py-1 hover:bg-muted" aria-label={t("calendar.previous")}>
            ←
          </Link>
          <span className="min-w-32 text-center font-medium">{format.dateTime(new Date(`${month}-01T00:00:00`), { month: "long", year: "numeric" })}</span>
          <Link href={href({ month: shiftMonth(month, 1) })} className="rounded-md border px-2 py-1 hover:bg-muted" aria-label={t("calendar.next")}>
            →
          </Link>
          <Link href={href({ month: today.slice(0, 7) })} className="underline">
            {t("calendar.today")}
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border text-xs">
          {weekdays.map((weekday) => (
            <div key={weekday} className="bg-muted px-2 py-1 font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}
          {grid.weeks.flat().map((day) => {
            const own = byDate.get(day.date) ?? [];
            const weekend = [0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay());
            const off = offNames.get(day.date);
            return (
              <div key={day.date} className={`flex min-h-28 flex-col gap-1 p-1.5 ${off || weekend ? "bg-muted/60" : "bg-background"} ${day.inMonth ? "" : "opacity-50"}`}>
                <p className={`flex items-center justify-between gap-1 ${day.date === today ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  <span className={day.date === today ? "rounded-full bg-foreground px-1.5 text-background" : ""}>{Number(day.date.slice(8))}</span>
                  {off ? <span className="truncate text-[10px]">{off}</span> : null}
                </p>
                {own.slice(0, MAX_PER_DAY).map((item) => (
                  <Link key={item.taskId} href={`/ops/obligations/${item.taskId}`} title={`${item.title} · ${item.assigneeName ?? t("unassigned")}`} className="flex items-center gap-1 hover:underline">
                    <StatusBadge colour={item.colour} label={item.entityCode} />
                    <span className="truncate">{item.subjectName ? `${item.templateName} — ${item.subjectName}` : item.templateName}</span>
                  </Link>
                ))}
                {own.length > MAX_PER_DAY ? (
                  <Link href={`/ops/list${overviewParams(query, { entity: entityId, month: day.date.slice(0, 7) })}`} className="text-muted-foreground underline">
                    {t("calendar.more", { count: own.length - MAX_PER_DAY })}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("calendar.legend")}</p>
    </div>
  );
}
