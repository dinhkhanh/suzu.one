import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { getWorkload, loadViewer } from "@/modules/work/service";

export const metadata: Metadata = { title: "Workload" };

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

// FR-WRK-13: open tasks and estimated hours per person per week for the teams the viewer leads,
// against a capacity reduced by approved leave and holidays. Leave shows as "away" — never its type.
export default async function WorkloadPage({ searchParams }: PageProps<"/work/workload">) {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const params = await searchParams;
  const today = todayInVietnam();
  const teamId = typeof params.team === "string" && /^[0-9a-f-]{36}$/.test(params.team) ? params.team : null;
  const view = await getWorkload(viewer, today, { teamId });
  if (!view) notFound();

  const t = await getTranslations("work.workload");
  const tWork = await getTranslations("work");
  const format = await getFormatter();
  const day = (date: string) => format.dateTime(new Date(`${date}T00:00:00`), { day: "numeric", month: "numeric" });
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {tWork("title")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {view.teams.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1">
          <Link href="/work/workload" className={tab(!teamId)}>
            {t("allTeams")}
          </Link>
          {view.teams.map((team) => (
            <Link key={team.id} href={`/work/workload?team=${team.id}`} className={tab(teamId === team.id)}>
              {team.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-44 px-2 font-medium">{t("person")}</th>
                {view.weeks.map((week, index) => (
                  <th key={week.start} className={`px-2 font-medium ${index === 0 ? "text-foreground" : ""}`}>
                    {index === 0 ? t("thisWeek") : t("weekOf", { date: day(week.start) })}
                    <span className="block font-normal">
                      {day(week.start)} – {day(week.end)}
                    </span>
                  </th>
                ))}
                <th className="px-2 font-medium">{t("later")}</th>
                <th className="px-2 font-medium">{t("unscheduled")}</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.person.id}>
                  <th scope="row" className="px-2 text-left align-top font-medium">
                    {row.person.fullName}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.week.start} className={`rounded-lg border p-2 align-top ${cell.over ? "border-destructive/50 bg-destructive/5" : cell.tasks === 0 ? "text-muted-foreground" : ""}`}>
                      <p className="font-medium tabular-nums">
                        {t("hours", { hours: hours(cell.minutes) })} <span className="text-xs font-normal text-muted-foreground">/ {t("hours", { hours: hours(cell.capacityMinutes) })}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("tasks", { count: cell.tasks })}
                        {cell.unestimated > 0 ? ` · ${t("unestimated", { count: cell.unestimated })}` : ""}
                      </p>
                      {cell.awayDays > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("away", { days: cell.awayDays })}</p> : null}
                      {cell.holidayDays > 0 ? <p className="text-xs text-muted-foreground">{t("holiday", { days: cell.holidayDays })}</p> : null}
                      {cell.over ? <p className="text-xs font-medium text-destructive">{t("over")}</p> : null}
                    </td>
                  ))}
                  {[row.later, row.unscheduled].map((rest, index) => (
                    <td key={index} className="rounded-lg border p-2 align-top text-muted-foreground">
                      {rest.tasks === 0 && rest.minutes === 0 ? (
                        "—"
                      ) : (
                        <>
                          <p className="tabular-nums">{t("hours", { hours: hours(rest.minutes) })}</p>
                          <p className="text-xs">{t("tasks", { count: rest.tasks })}</p>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.daysOff.length > 0 ? <p className="text-xs text-muted-foreground">{t("daysOff", { list: view.daysOff.map((off) => `${day(off.date)} ${off.name}`).join(", ") })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("legend")}</p>
    </div>
  );
}
