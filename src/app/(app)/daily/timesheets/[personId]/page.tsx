import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getTimesheetView, loadTimeReader, weekStartOf } from "@/modules/daily/service";
import { DecideWeek } from "@/modules/daily/ui/timesheet-decide";
import { TimeWeek, WeekStatus } from "@/modules/daily/ui/week-view";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("timesheet");

// FR-PJM-25, 26: somebody's week, read-only — for their approvers with the attendance hint and the
// decision; for the people above them without deciding; for a project's lead, only the rows on
// their project. Anyone else gets a 404, as for a week that does not exist.
export default async function PersonTimesheetPage({ params, searchParams }: PageProps<"/daily/timesheets/[personId]">) {
  const user = await requireUser();
  const { personId } = await params;
  if (!z.uuid().safeParse(personId).success) notFound();
  const today = todayInVietnam();
  const current = weekStartOf(today);
  const { week: asked } = await searchParams;
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? weekStartOf(asked) : current;
  if (personId === user.person.id) redirect(`/daily/time?week=${weekStart}`);
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadTimeReader(user.person.id)]);
  const view = await getTimesheetView(reader, personId, weekStart, today);
  if (!view) notFound();
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const link = (week: string) => `/daily/timesheets/${personId}?week=${week}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <Link href="/daily/timesheets" className="underline">
            {t("timesheets.title")}
          </Link>
        </p>
        <h1>{view.fullName}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={link(addDays(weekStart, -7))} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("time.previousWeek")}
          </Link>
          <span className="font-medium">{t("time.week", { start: day(weekStart), end: day(addDays(weekStart, 6)) })}</span>
          {weekStart < current ? (
            <Link href={link(addDays(weekStart, 7))} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("time.nextWeek")}
            </Link>
          ) : null}
        </div>
        {view.partial ? <p className="text-sm text-muted-foreground">{t("timesheets.partial")}</p> : <WeekStatus view={view} />}
      </header>

      {view.canApprove && view.week ? <DecideWeek weekId={view.week.id} status={view.status} /> : null}

      <TimeWeek view={view} />
    </div>
  );
}
