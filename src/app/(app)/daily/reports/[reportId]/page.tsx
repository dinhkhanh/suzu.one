import { ChevronDown } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canCommentOnReport, getReportView, loadReportReader, REPORT_BACKFILL_DAYS } from "@/modules/daily/service";
import { ActivityList, TaskLines } from "@/modules/daily/ui/activity-list";
import { hoursOf } from "@/modules/daily/ui/format";
import { ReportThread } from "@/modules/daily/ui/report-thread";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("dailyReport");

// One report, for the person, their team leads and their line-management chain — nobody else
// (the policy answers inside `getReportView`; anyone else gets "not found"). What the report says
// about a task the reader may not open is shown as private work, never by its title.
export default async function ReportViewPage({ params }: PageProps<"/daily/reports/[reportId]">) {
  const user = await requireUser();
  const { reportId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(reportId)) notFound();
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadReportReader(user.person.id, undefined, user.principal)]);
  const view = await getReportView(reader, reportId);
  if (!view) notFound();
  const { report, subject } = view;
  const mine = report.personId === user.person.id;
  const today = todayInVietnam();
  const editable = mine && report.date >= addDays(today, -REPORT_BACKFILL_DAYS);

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href={mine ? "/daily" : "/daily/team"} className="hover:underline">
            {mine ? t("index.title") : t("board.title")}
          </Link>
        }
        title={mine ? t("report.title") : <RecordLink kind="person" id={report.personId}>{subject.fullName}</RecordLink>}
        description={format.dateTime(new Date(`${report.date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          editable ? (
            <Link href={`/daily/report?date=${report.date}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("view.edit")}
            </Link>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {report.status === "submitted" ? <Badge dot variant={report.late ? "warning" : "success"}>{report.late ? t("late") : t("submitted")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}
          {report.submittedAt ? <span className="text-xs text-muted-foreground">{t("view.sentAt", { time: format.dateTime(report.submittedAt, { dateStyle: "short", timeStyle: "short" }) })}</span> : null}
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{t("hours", { value: hoursOf(report.minutesLogged) })}</span>
        </div>
      </PageHeader>

      {report.blockers || view.openBlockers.length > 0 ? (
        <Alert variant="destructive">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-medium">{t("report.blockers")}</p>
            <RichText text={report.blockers} />
            {view.openBlockers.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {view.openBlockers.map((blocker) => (
                  <li key={blocker.blockerId}>
                    {blocker.hidden ? (
                      <span className="italic opacity-80">{t("privateWork")}</span>
                    ) : (
                      <>
                        <RecordLink kind="task" id={blocker.taskId}>
                          <span className="font-mono text-xs opacity-80">{blocker.key}</span> {blocker.title}
                        </RecordLink>{" "}
                        <span className="text-xs opacity-80">· {blocker.reason}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <Section title={t("report.done", { count: report.done.length })}>
        <TaskLines lines={report.done} empty={t("report.noneDone")} />
      </Section>
      <Section title={t("report.notDone", { count: report.notDone.length })}>
        <TaskLines lines={report.notDone} empty={t("report.allPlannedDone")} />
      </Section>
      {report.notes ? (
        <Section title={t("report.notes")}>
          <RichText text={report.notes} />
        </Section>
      ) : null}
      <Section title={t("report.tomorrowPlanned", { count: report.tomorrow.length })}>
        <TaskLines lines={view.tomorrow} empty={t("report.noTomorrow")} />
      </Section>
      <details className="group/activity rounded-[14px] border border-border bg-background">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">{t("report.activity", { count: report.activity.length })}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/activity:rotate-180" />
        </summary>
        <div className="border-t px-4 py-3">
          <ActivityList items={report.activity} />
        </div>
      </details>

      <Section title={t("thread.title", { count: view.comments.length })}>
        {view.comments.length > 0 ? (
          <List>
            {view.comments.map((comment, index) => (
              <ListItem key={comment.id} className="rise flex-col items-stretch gap-1" style={{ "--i": index } as CSSProperties}>
                <p className="text-xs text-muted-foreground">
                  <RecordLink kind="person" id={comment.authorPersonId} className="font-medium text-foreground">
                    {comment.authorName}
                  </RecordLink>{" "}
                  · {format.dateTime(comment.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </p>
                {comment.reaction ? <p className="text-lg leading-tight">{comment.reaction}</p> : null}
                <RichText text={comment.body} />
              </ListItem>
            ))}
          </List>
        ) : null}
        {/* Oversight reads the thread; only the person and the people the report is for write in it. */}
        {canCommentOnReport(reader, view.subject) ? <ReportThread reportId={report.id} /> : null}
      </Section>
    </Page>
  );
}
