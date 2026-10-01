import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { CAPACITY_WEEKS, getCapacity, isMonday, mondayOf } from "@/modules/projects/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("capacity");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/**
 * Capacity against bookings (FR-PJM-13): the people whose time the viewer plans — the teams they
 * lead, the people below them, or where they hold `work:manage` — over the next eight weeks, as a
 * heat map of load against what each can work. Available = work schedule − approved leave −
 * holidays; confirmed bookings are the load, tentative ones are marked and never counted. Leave
 * shows as "away", never its type. Filters live in the URL. Skills are not recorded yet
 * (FR-CHR-14): people are filtered by position.
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
  const thisMonday = mondayOf(today);
  // The cell's tint: fine up to 90% of what the person can work, a warning up to full, wrong over it.
  const tint = (percent: number | null, confirmed: number) => (percent === null ? "bg-muted text-faint" : confirmed === 0 ? "bg-canvas text-faint" : percent > 100 ? "bg-destructive/10 text-destructive" : percent > 90 ? "bg-warning/12 text-warning" : "bg-success/10 text-success");

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/projects" className="hover:text-foreground">
            {tProjects("title")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button nativeButton={false} variant="outline" size="sm" render={<Link href={query(addDays(from, -7 * CAPACITY_WEEKS))} />}>
              {t("earlier")}
            </Button>
            <Button nativeButton={false} variant="outline" size="sm" render={<Link href={query(thisMonday)} />}>
              {t("thisWeek")}
            </Button>
            <Button nativeButton={false} variant="outline" size="sm" render={<Link href={query(addDays(from, 7 * CAPACITY_WEEKS))} />}>
              {t("later")}
            </Button>
          </>
        }
      />

      <form method="get" className="toolbar">
        <input type="hidden" name="from" value={from} />
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
          {t("team")}
          <Select name="team" defaultValue={pick("team") ?? ""} className="md:w-48">
            <option value="">{t("allTeams")}</option>
            {view.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
          {t("position")}
          <Select name="position" defaultValue={pick("position") ?? ""} className="md:w-48">
            <option value="">{t("allPositions")}</option>
            {view.positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
          {t("freeAtLeast")}
          <Input name="free" type="number" min={0} max={80} step="0.5" defaultValue={freeHours ?? ""} className="md:w-28" />
        </label>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>

      <TableCard>
        <TableCardHeader title={t("heatmap")} count={view.rows.length || null} description={t("skillsNote")} />
        <Table numbered={false} className="min-w-[840px]">
          <TableHeader>
            <TableRow>
              <TableHead kind="person" className="w-52">
                {t("person")}
              </TableHead>
              {view.weeks.map((week) => (
                <TableHead key={week.start} className={`text-center ${week.start === thisMonday ? "text-foreground" : ""}`}>
                  {t("weekOf", { date: day(week.start) })}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {view.rows.map((row) => (
              <TableRow key={row.person.id}>
                <TableCell className="whitespace-normal">
                  <span className="block truncate font-medium">{row.person.fullName}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {row.person.positionName ? <span>{row.person.positionName}</span> : null}
                    {row.overWeeks ? <span className="font-medium text-destructive">{t("overWeeks", { count: row.overWeeks })}</span> : null}
                  </span>
                </TableCell>
                {row.cells.map((cell) => {
                  const own = view.bookings.get(`${row.person.id}:${cell.week.start}`) ?? [];
                  const percent = cell.availableMinutes > 0 ? Math.round((cell.confirmedMinutes / cell.availableMinutes) * 100) : null;
                  const lines = [
                    `${t("hours", { hours: hours(cell.confirmedMinutes) })} / ${t("hours", { hours: hours(cell.availableMinutes) })}`,
                    cell.tentativeMinutes > 0 ? t("tentativeHours", { hours: hours(cell.tentativeMinutes) }) : null,
                    cell.awayDays > 0 ? t("away", { days: cell.awayDays }) : null,
                    cell.holidayDays > 0 ? t("holiday", { days: cell.holidayDays }) : null,
                    cell.over ? t("over", { hours: hours(-cell.freeMinutes) }) : cell.atRisk ? t("atRisk") : null,
                    ...own.map((booking) => `${booking.projectName ?? t("otherProject")}: ${hours(booking.minutes)} h${booking.status === "tentative" ? ` (${t("tentative")})` : ""}`),
                  ].filter(Boolean);
                  return (
                    <TableCell key={cell.week.start} className="p-1.5">
                      <div title={lines.join("\n")} className={`flex h-8 items-center justify-center gap-0.5 rounded-md font-mono text-xs tabular-nums ${tint(percent, cell.confirmedMinutes)}`}>
                        <span>{percent === null ? "—" : `${percent}%`}</span>
                        {cell.tentativeMinutes > 0 ? <span className="text-faint">+</span> : null}
                        {cell.awayDays > 0 ? <span aria-label={t("away", { days: cell.awayDays })} className="size-1.5 rounded-full bg-warning" /> : null}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-1 border-t px-4 py-3 text-xs text-muted-foreground">
          <p>{t("heatmapLegend")}</p>
          {view.daysOff.length > 0 ? <p>{t("daysOff", { list: view.daysOff.map((off) => `${day(off.date)} ${off.name}`).join(", ") })}</p> : null}
        </div>
      </TableCard>

      {view.openPlaceholders.length ? (
        <TableCard>
          <TableCardHeader title={t("openRoles")} count={view.openPlaceholders.length} description={t("openRolesHint")} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{tProjects("fields.name")}</TableHead>
                <TableHead kind="select">{tProjects("bookings.placeholderRole")}</TableHead>
                <TableHead kind="date">{tProjects("bookings.forWeeks")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.openPlaceholders.map((open) => (
                <TableRow key={`${open.projectId}:${open.placeholderRole}`}>
                  <TableCell>
                    <Link href={`/projects/${open.projectId}/team`} className="font-medium hover:underline">
                      {open.projectName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{open.placeholderRole}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{open.weeks.map((week) => `${day(week.weekStart)}: ${hours(week.minutes)}h${week.status === "tentative" ? "?" : ""}`).join(" · ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </Page>
  );
}
