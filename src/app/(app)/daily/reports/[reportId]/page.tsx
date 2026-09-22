import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getReportView, loadReportReader, REPORT_BACKFILL_DAYS } from "@/modules/daily/service";
import { ActivityList, TaskLines } from "@/modules/daily/ui/activity-list";
import { hoursOf } from "@/modules/daily/ui/format";
import { ReportThread } from "@/modules/daily/ui/report-thread";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Daily report" };

// One report, for the person, their team leads and their line-management chain — nobody else
// (the policy answers inside `getReportView`; anyone else gets "not found"). What the report says
// about a task the reader may not open is shown as private work, never by its title.
export default async function ReportViewPage({ params }: PageProps<"/daily/reports/[reportId]">) {
  const user = await requireUser();
  const { reportId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(reportId)) notFound();
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadReportReader(user.person.id)]);
  const view = await getReportView(reader, reportId);
  if (!view) notFound();
  const { report, subject } = view;
  const mine = report.personId === user.person.id;
  const today = todayInVietnam();
  const editable = mine && report.date >= addDays(today, -REPORT_BACKFILL_DAYS);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href={mine ? "/daily" : "/daily/team"} className="underline">
            {mine ? t("index.title") : t("board.title")}
          </Link>
        </p>
        <h1>{mine ? t("report.title") : subject.fullName}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${report.date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <div className="flex flex-wrap items-center gap-2">
          {report.status === "submitted" ? <Badge variant={report.late ? "warning" : "success"}>{report.late ? t("late") : t("submitted")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}
          {report.submittedAt ? <span className="text-xs text-muted-foreground">{t("view.sentAt", { time: format.dateTime(report.submittedAt, { dateStyle: "short", timeStyle: "short" }) })}</span> : null}
          <span className="text-xs text-muted-foreground">{t("hours", { value: hoursOf(report.minutesLogged) })}</span>
          {editable ? (
            <Link href={`/daily/report?date=${report.date}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
              {t("view.edit")}
            </Link>
          ) : null}
        </div>
      </header>

      {report.blockers || view.openBlockers.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-medium text-destructive">{t("report.blockers")}</h2>
          {report.blockers ? <p className="text-sm whitespace-pre-wrap">{report.blockers}</p> : null}
          {view.openBlockers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {view.openBlockers.map((blocker) => (
                <li key={blocker.blockerId}>
                  {blocker.hidden ? (
                    <span className="text-muted-foreground italic">{t("privateWork")}</span>
                  ) : (
                    <>
                      <Link href={`/work/tasks/${blocker.taskId}`} className="hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{blocker.key}</span> {blocker.title}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">· {blocker.reason}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("report.done", { count: report.done.length })}</h2>
        <TaskLines lines={report.done} empty={t("report.noneDone")} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("report.notDone", { count: report.notDone.length })}</h2>
        <TaskLines lines={report.notDone} empty={t("report.allPlannedDone")} />
      </section>
      {report.notes ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("report.notes")}</h2>
          <p className="text-sm whitespace-pre-wrap">{report.notes}</p>
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("report.tomorrowPlanned", { count: report.tomorrow.length })}</h2>
        <TaskLines lines={view.tomorrow} empty={t("report.noTomorrow")} />
      </section>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">{t("report.activity", { count: report.activity.length })}</summary>
        <div className="mt-3">
          <ActivityList items={report.activity} />
        </div>
      </details>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("thread.title", { count: view.comments.length })}</h2>
        {view.comments.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {view.comments.map((comment) => (
              <li key={comment.id} className="flex flex-col gap-0.5 text-sm">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.authorName}</span> · {format.dateTime(comment.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </p>
                {comment.reaction ? <p className="text-lg">{comment.reaction}</p> : null}
                {comment.body ? <p className="whitespace-pre-wrap">{comment.body}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <ReportThread reportId={report.id} />
      </section>
    </div>
  );
}
