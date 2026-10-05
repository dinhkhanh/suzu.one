import { ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getMyTimeWeek, getRunningTimer, weekStartOf } from "@/modules/daily/service";
import { RunningTimer } from "@/modules/daily/ui/timer";
import { RecallWeekButton, SubmitWeekButton } from "@/modules/daily/ui/week-entries";
import { TimeWeek, WeekStatus } from "@/modules/daily/ui/week-view";
import { requireUser } from "@/modules/platform/auth/session";
import { jobNumbersOf } from "@/modules/projects/service";
import { listOpenWorkOf } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myTime");

// FR-PJM-24, 25, 26: the person's week of time — the grid (typed into, or copied from last week),
// attendance beside each day, and the weekly submission where a team approves timesheets; a week
// sent in and not yet decided can be taken back.
export default async function TimePage({ searchParams }: PageProps<"/daily/time">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const current = weekStartOf(today);
  const { week: asked } = await searchParams;
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? weekStartOf(asked) : current;
  const [t, format, view, open, timer] = await Promise.all([getTranslations("daily"), getFormatter(), getMyTimeWeek(user.person.id, weekStart, today), listOpenWorkOf(user.person.id, today), getRunningTimer(user.person.id)]);
  if (!view) notFound();
  // The open tasks come from the work module, which knows no job numbers: the route adds them (FR-PJM-02).
  const jobNumbers = await jobNumbersOf(open.map((task) => task.projectId));
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const canSubmit = view.approvalRequired && view.editable && (view.status === "open" || view.status === "returned");
  const locked = view.status === "submitted" || view.status === "approved";

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={t("time.week", { start: day(weekStart), end: day(addDays(weekStart, 6)) })}
        title={t("time.title")}
        description={locked ? (view.status === "approved" ? t("time.lockedApproved") : t("time.lockedSubmitted")) : !view.editable ? t("time.tooOld") : undefined}
        actions={
          <>
            <Link href={`/daily/time?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label={t("time.previousWeek")}>
              <ChevronLeft aria-hidden /> {t("time.previousWeek")}
            </Link>
            {weekStart < current ? (
              <>
                <Link href={`/daily/time?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  {t("time.nextWeek")} <ChevronRight aria-hidden />
                </Link>
                <Link href="/daily/time" className={buttonVariants({ size: "sm", variant: "ghost" })}>
                  {t("time.thisWeek")}
                </Link>
              </>
            ) : null}
          </>
        }
      >
        <div className="pt-1">
          <WeekStatus view={view} />
        </div>
      </PageHeader>

      {timer ? <RunningTimer label={timer.key ? `${timer.key} ${timer.title ?? ""}` : t(`time.categories.${(timer.category ?? "internal") as "internal"}`)} startedAt={timer.startedAt.toISOString()} /> : null}

      <TimeWeek view={view} openTasks={open.map(({ taskId, key, title, projectId, projectName }) => ({ taskId, key, title, projectId, projectName, jobNumber: projectId ? (jobNumbers.get(projectId) ?? null) : null }))} />

      {canSubmit ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <SubmitWeekButton weekStart={weekStart} again={view.status === "returned"} />
          <p className="text-xs text-muted-foreground">{t("time.submitHint")}</p>
        </div>
      ) : null}
      {view.status === "submitted" ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <RecallWeekButton weekStart={weekStart} />
          <p className="text-xs text-muted-foreground">{t("time.recallHint")}</p>
        </div>
      ) : null}
    </Page>
  );
}
