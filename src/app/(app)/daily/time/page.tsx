import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getMyTimeWeek, getRunningTimer, weekStartOf } from "@/modules/daily/service";
import { RunningTimer } from "@/modules/daily/ui/timer";
import { SubmitWeekButton } from "@/modules/daily/ui/week-entries";
import { TimeWeek, WeekStatus } from "@/modules/daily/ui/week-view";
import { requireUser } from "@/modules/platform/auth/session";
import { listOpenWorkOf } from "@/modules/work/service";

export const metadata: Metadata = { title: "My time" };

// FR-PJM-24, 25, 26: the person's week of time — the grid (typed into, or copied from last week),
// attendance beside each day, and the weekly submission where a team approves timesheets.
export default async function TimePage({ searchParams }: PageProps<"/daily/time">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const current = weekStartOf(today);
  const { week: asked } = await searchParams;
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? weekStartOf(asked) : current;
  const [t, format, view, open, timer] = await Promise.all([getTranslations("daily"), getFormatter(), getMyTimeWeek(user.person.id, weekStart, today), listOpenWorkOf(user.person.id, today), getRunningTimer(user.person.id)]);
  if (!view) notFound();
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const canSubmit = view.approvalRequired && view.editable && (view.status === "open" || view.status === "returned");
  const locked = view.status === "submitted" || view.status === "approved";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <Link href="/today" className="underline">
            {t("today.title")}
          </Link>
        </p>
        <h1>{t("time.title")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/daily/time?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("time.previousWeek")}
          </Link>
          <span className="font-medium">{t("time.week", { start: day(weekStart), end: day(addDays(weekStart, 6)) })}</span>
          {weekStart < current ? (
            <>
              <Link href={`/daily/time?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t("time.nextWeek")}
              </Link>
              <Link href="/daily/time" className={buttonVariants({ size: "sm", variant: "ghost" })}>
                {t("time.thisWeek")}
              </Link>
            </>
          ) : null}
        </div>
        <WeekStatus view={view} />
        {locked ? <p className="text-sm text-muted-foreground">{view.status === "approved" ? t("time.lockedApproved") : t("time.lockedSubmitted")}</p> : !view.editable ? <p className="text-sm text-muted-foreground">{t("time.tooOld")}</p> : null}
      </header>

      {timer ? <RunningTimer label={timer.key ? `${timer.key} ${timer.title ?? ""}` : t(`time.categories.${(timer.category ?? "internal") as "internal"}`)} startedAt={timer.startedAt.toISOString()} /> : null}

      <TimeWeek view={view} openTasks={open.map(({ taskId, key, title, projectName }) => ({ taskId, key, title, projectName }))} />

      {canSubmit ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-3 sm:flex-row sm:items-center">
          <SubmitWeekButton weekStart={weekStart} again={view.status === "returned"} />
          <p className="text-xs text-muted-foreground">{t("time.submitHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
