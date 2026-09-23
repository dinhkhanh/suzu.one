import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { listApprovals, listProjectTime, loadTimeReader, weekStartOf } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { WaitingList } from "@/modules/daily/ui/timesheet-decide";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("timesheets");

const STATUS_BADGE = { open: "outline", submitted: "info", approved: "success", returned: "warning" } as const;

// FR-PJM-25: the weeks waiting for me — for the people whose team I lead or who report to me
// directly — with bulk approval; the weeks I decided lately (to reopen one); and, for a project's
// lead, the hours logged on their projects.
export default async function TimesheetsPage({ searchParams }: PageProps<"/daily/timesheets">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const current = weekStartOf(today);
  const { week: asked } = await searchParams;
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? weekStartOf(asked) : current;
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadTimeReader(user.person.id)]);
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("timesheets.waiting", { count: waiting.length })}</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("timesheets.none")}</p>
        ) : (
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
        )}
      </section>

      {recent.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("timesheets.recent")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {recent.map((week) => (
              <li key={week.id} className="flex flex-wrap items-center gap-2 p-3">
                <Link href={`/daily/timesheets/${week.personId}?week=${week.weekStart}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-medium">{week.name}</span>
                  <span className="block text-xs text-muted-foreground">{weekOf(week.weekStart)}</span>
                </Link>
                <Badge variant={STATUS_BADGE[week.status]}>{t(`time.status.${week.status}`)}</Badge>
                <span className="tabular-nums">{hours(week.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reader.ledProjectIds.size > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-medium">{t("timesheets.projectTime")}</h2>
            <Link href={`/daily/timesheets?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
              {t("time.previousWeek")}
            </Link>
            <span className="text-xs">{weekOf(weekStart)}</span>
            {weekStart < current ? (
              <Link href={`/daily/timesheets?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
                {t("time.nextWeek")}
              </Link>
            ) : null}
          </div>
          {projectTime.length === 0 ? <p className="text-sm text-muted-foreground">{t("timesheets.noProjectTime")}</p> : null}
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {projectTime.map((row) => (
              <li key={`${row.personId}:${row.projectId}`} className="flex flex-wrap items-center gap-2 p-3">
                <Link href={`/daily/timesheets/${row.personId}?week=${weekStart}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-medium">{row.name}</span>
                  <span className="block text-xs text-muted-foreground">{row.projectName}</span>
                </Link>
                {row.billable > 0 ? <span className="text-xs text-muted-foreground">{t("timesheets.billableHours", { value: hoursOf(row.billable) })}</span> : null}
                <span className="tabular-nums">{hours(row.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
