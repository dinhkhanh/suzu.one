import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { listApprovals, listProjectTime, loadTimeReader, weekStartOf } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { WaitingList } from "@/modules/daily/ui/timesheet-decide";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("timesheets");


// FR-PJM-25: the weeks waiting for me — for the people whose team I lead or who report to me
// directly — with bulk approval; the weeks I decided lately (to reopen one); and, for a project's
// lead, the hours logged on their projects.
export default async function TimesheetsPage({ searchParams }: PageProps<"/daily/timesheets">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const current = weekStartOf(today);
  const { week: asked } = await searchParams;
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? weekStartOf(asked) : current;
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadTimeReader(user.person.id, user.principal)]);
  const [{ waiting, recent }, projectTime] = await Promise.all([listApprovals(reader, today), listProjectTime(reader, weekStart)]);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const weekOf = (iso: string) => t("time.week", { start: day(iso), end: day(addDays(iso, 6)) });
  const hours = (minutes: number) => t("hours", { value: hoursOf(minutes) });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1>{t("timesheets.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("timesheets.intro")}</p>
      </header>

      <TableCard>
        <TableCardHeader title={t("timesheets.waiting", { count: waiting.length })} />
        <WaitingList
          rows={waiting.map((week) => ({
            id: week.id,
            href: `/daily/timesheets/${week.personId}?week=${week.weekStart}`,
            name: week.name,
            week: weekOf(week.weekStart),
            hours: hours(week.minutes),
            submitted: week.submittedAt ? t("time.submittedAt", { time: format.dateTime(week.submittedAt, { dateStyle: "short", timeStyle: "short" }) }) : null,
          }))}
        />
      </TableCard>

      {recent.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("timesheets.recent")} count={recent.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("timesheets.columns.person")}</TableHead>
                <TableHead kind="date">{t("timesheets.columns.week")}</TableHead>
                <TableHead kind="status">{t("timesheets.columns.status")}</TableHead>
                <TableHead kind="time">{t("timesheets.columns.hours")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((week) => (
                <TableRow key={week.id}>
                  <TableCell>
                    <Link href={`/daily/timesheets/${week.personId}?week=${week.weekStart}`} className="font-medium hover:underline">
                      {week.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{weekOf(week.weekStart)}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(week.status)}>{t(`time.status.${week.status}`)}</Badge>
                  </TableCell>
                  <TableCell kind="time">{hours(week.minutes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {reader.ledProjectIds.size > 0 ? (
        <TableCard>
          <TableCardHeader
            title={t("timesheets.projectTime")}
            actions={
              <>
                <Link href={`/daily/timesheets?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
                  {t("time.previousWeek")}
                </Link>
                <span className="text-xs">{weekOf(weekStart)}</span>
                {weekStart < current ? (
                  <Link href={`/daily/timesheets?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
                    {t("time.nextWeek")}
                  </Link>
                ) : null}
              </>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("timesheets.columns.person")}</TableHead>
                <TableHead kind="text">{t("timesheets.columns.project")}</TableHead>
                <TableHead kind="time">{t("time.billable")}</TableHead>
                <TableHead kind="time">{t("timesheets.columns.hours")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectTime.length === 0 ? <TableEmpty>{t("timesheets.noProjectTime")}</TableEmpty> : null}
              {projectTime.map((row) => (
                <TableRow key={`${row.personId}:${row.projectId}`}>
                  <TableCell>
                    <Link href={`/daily/timesheets/${row.personId}?week=${weekStart}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.projectName}</TableCell>
                  <TableCell kind="time" className="text-muted-foreground">{row.billable > 0 ? hours(row.billable) : ""}</TableCell>
                  <TableCell kind="time">{hours(row.minutes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
