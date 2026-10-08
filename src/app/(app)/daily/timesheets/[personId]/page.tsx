import { ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
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
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadTimeReader(user.person.id, user.principal)]);
  const view = await getTimesheetView(reader, personId, weekStart, today);
  if (!view) notFound();
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const link = (week: string) => `/daily/timesheets/${personId}?week=${week}`;

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/daily/timesheets" className="hover:underline">
            {t("timesheets.title")}
          </Link>
        }
        title={
          <RecordLink kind="person" id={view.personId}>
            {view.fullName}
          </RecordLink>
        }
        description={view.partial ? t("timesheets.partial") : undefined}
        actions={
          <>
            <Link href={link(addDays(weekStart, -7))} className={buttonVariants({ size: "sm", variant: "outline" })}>
              <ChevronLeft aria-hidden /> {t("time.previousWeek")}
            </Link>
            <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{t("time.week", { start: day(weekStart), end: day(addDays(weekStart, 6)) })}</span>
            {weekStart < current ? (
              <Link href={link(addDays(weekStart, 7))} className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t("time.nextWeek")} <ChevronRight aria-hidden />
              </Link>
            ) : null}
          </>
        }
      >
        {view.partial ? null : (
          <div className="pt-1">
            <WeekStatus view={view} />
          </div>
        )}
      </PageHeader>

      {view.canApprove && view.week ? <DecideWeek weekId={view.week.id} status={view.status} /> : null}

      <TimeWeek view={view} />
    </Page>
  );
}
