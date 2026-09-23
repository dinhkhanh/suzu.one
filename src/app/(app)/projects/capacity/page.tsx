import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { CAPACITY_WEEKS, getCapacity, isMonday, mondayOf } from "@/modules/projects/service";

export const metadata: Metadata = { title: "Capacity" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/**
 * Capacity against bookings (FR-PJM-13): the people whose time the viewer plans — the teams they
 * lead, the people below them, or where they hold `work:manage` — over the next eight weeks. Available = work schedule − approved leave − holidays; confirmed bookings are the
 * load, tentative ones are shown apart and never counted. Leave shows as "away", never its type.
 * Filters live in the URL. Skills are not recorded yet (FR-CHR-14): people are filtered by position.
 */
export default async function CapacityPage({ searchParams }: PageProps<"/projects/capacity">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const pick = (key: string) => (typeof params[key] === "string" && UUID.test(params[key]) ? params[key] : null);
  const from = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) && isMonday(params.from) ? params.from : mondayOf(today);
  const freeHours = typeof params.free === "string" && /^\d{1,2}(\.\d)?$/.test(params.free) ? Number(params.free) : null;
  const view = await getCapacity(user, today, { teamId: pick("team"), positionId: pick("position"), freeMinutes: freeHours === null ? null : Math.round(freeHours * 60), from });
  if (!view) notFound();

  const [t, tProjects, format] = await Promise.all([getTranslations("projects.capacity"), getTranslations("projects"), getFormatter()]);
  const day = (date: string) => format.dateTime(new Date(`${date}T00:00:00`), { day: "numeric", month: "numeric" });
  const query = (start: string) => {
    const next = new URLSearchParams(Object.entries({ team: pick("team"), position: pick("position"), free: freeHours === null ? null : String(freeHours), from: start }).flatMap(([key, value]) => (value ? [[key, value]] : [])));
    return `/projects/capacity?${next.toString()}`;
  };

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/projects" className="underline">
            {tProjects("title")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="from" value={from} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("team")}</span>
          <Select name="team" defaultValue={pick("team") ?? ""} className="w-52">
            <option value="">{t("allTeams")}</option>
            {view.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("position")}</span>
          <Select name="position" defaultValue={pick("position") ?? ""} className="w-52">
            <option value="">{t("allPositions")}</option>
            {view.positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("freeAtLeast")}</span>
          <Input name="free" type="number" min={0} max={80} step="0.5" defaultValue={freeHours ?? ""} className="w-28" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
        <nav className="ml-auto flex items-center gap-3 text-sm">
          <Link href={query(addDays(from, -7 * CAPACITY_WEEKS))} className="underline">
            {t("earlier")}
          </Link>
          <Link href={query(mondayOf(today))} className="underline">
            {t("thisWeek")}
          </Link>
          <Link href={query(addDays(from, 7 * CAPACITY_WEEKS))} className="underline">
            {t("later")}
          </Link>
        </nav>
      </form>
      <p className="text-xs text-muted-foreground">{t("skillsNote")}</p>

      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-48 px-2 font-medium">{t("person")}</th>
                {view.weeks.map((week) => (
                  <th key={week.start} className={`px-2 font-medium ${week.start === mondayOf(today) ? "text-foreground" : ""}`}>
                    {t("weekOf", { date: day(week.start) })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.person.id}>
                  <th scope="row" className="px-2 text-left align-top font-medium">
                    {row.person.fullName}
                    {row.person.positionName ? <span className="block text-xs font-normal text-muted-foreground">{row.person.positionName}</span> : null}
                    {row.overWeeks ? <span className="block text-xs font-medium text-destructive">{t("overWeeks", { count: row.overWeeks })}</span> : null}
                  </th>
                  {row.cells.map((cell) => {
                    const own = view.bookings.get(`${row.person.id}:${cell.week.start}`) ?? [];
                    const title = own.map((booking) => `${booking.projectName ?? t("otherProject")}: ${hours(booking.minutes)} h${booking.status === "tentative" ? ` (${t("tentative")})` : ""}`).join("\n");
                    return (
                      <td key={cell.week.start} title={title || undefined} className={`rounded-lg border p-2 align-top ${cell.over ? "border-destructive/50 bg-destructive/5" : cell.atRisk ? "border-amber-600/40 bg-amber-500/5" : cell.confirmedMinutes === 0 ? "text-muted-foreground" : ""}`}>
                        <p className="font-medium tabular-nums">
                          {t("hours", { hours: hours(cell.confirmedMinutes) })} <span className="text-xs font-normal text-muted-foreground">/ {t("hours", { hours: hours(cell.availableMinutes) })}</span>
                        </p>
                        {cell.tentativeMinutes > 0 ? <p className="text-xs text-muted-foreground">{t("tentativeHours", { hours: hours(cell.tentativeMinutes) })}</p> : null}
                        {cell.awayDays > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("away", { days: cell.awayDays })}</p> : null}
                        {cell.holidayDays > 0 ? <p className="text-xs text-muted-foreground">{t("holiday", { days: cell.holidayDays })}</p> : null}
                        {cell.over ? <p className="text-xs font-medium text-destructive">{t("over", { hours: hours(-cell.freeMinutes) })}</p> : cell.atRisk ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("atRisk")}</p> : null}
                        {own.length ? (
                          <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                            {own.map((booking, index) => (
                              <li key={index} className="truncate">
                                {booking.projectId ? (
                                  <Link href={`/projects/${booking.projectId}/team`} className="hover:underline">
                                    {booking.projectName}
                                  </Link>
                                ) : (
                                  t("otherProject")
                                )}{" "}
                                {hours(booking.minutes)}h{booking.status === "tentative" ? "?" : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.daysOff.length > 0 ? <p className="text-xs text-muted-foreground">{t("daysOff", { list: view.daysOff.map((off) => `${day(off.date)} ${off.name}`).join(", ") })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("legend")}</p>

      {view.openPlaceholders.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{t("openRoles")}</h2>
          <p className="text-sm text-muted-foreground">{t("openRolesHint")}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {view.openPlaceholders.map((open) => (
              <li key={`${open.projectId}:${open.placeholderRole}`} className="flex flex-wrap gap-x-2">
                <Link href={`/projects/${open.projectId}/team`} className="font-medium hover:underline">
                  {open.projectName}
                </Link>
                <span>{open.placeholderRole}</span>
                <span className="text-muted-foreground">{open.weeks.map((week) => `${day(week.weekStart)}: ${hours(week.minutes)}h${week.status === "tentative" ? "?" : ""}`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
