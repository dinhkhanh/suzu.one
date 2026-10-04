import { ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getReportForm, reportLink, withinReportWindow } from "@/modules/daily/service";
import { EodNotesDraftButton } from "@/modules/ai/ui/draft-button";
import { ReportForm } from "@/modules/daily/ui/report-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("dailyReport");

// FR-PJM-22: the day's report, already written from the record — the person adds judgement and
// sends. Today's by default; `?date=` opens a day of the back-fill window, and the header steps
// from day to day inside it, so a report missed yesterday can still be written (it is marked late).
export default async function ReportPage({ searchParams }: PageProps<"/daily/report">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { date: asked } = await searchParams;
  const date = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && withinReportWindow(asked, today) ? asked : today;
  const [t, format, form] = await Promise.all([getTranslations("daily"), getFormatter(), getReportForm(user.person.id, date)]);
  const day = form.day;
  const submitted = form.report?.status === "submitted";
  const isToday = date === today;
  const previous = addDays(date, -1);

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}
        title={t("report.title")}
        description={t("report.prefilledHint")}
        actions={
          <>
            {withinReportWindow(previous, today) ? (
              <Link href={reportLink(previous)} className={buttonVariants({ size: "sm", variant: "outline" })}>
                <ChevronLeft aria-hidden /> {t("board.previous")}
              </Link>
            ) : null}
            {isToday ? null : (
              <>
                <Link href={reportLink(addDays(date, 1))} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  {t("board.next")} <ChevronRight aria-hidden />
                </Link>
                <Link href={reportLink(today)} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                  {t("today.title")}
                </Link>
              </>
            )}
          </>
        }
      >
        <div className="flex flex-wrap gap-1.5 pt-1">
          {submitted ? (
            <Badge dot variant={form.report!.late ? "warning" : "success"}>{form.report!.late ? t("late") : t("submitted")}</Badge>
          ) : !day?.report.required ? (
            <Badge variant="secondary">{t("report.optional")}</Badge>
          ) : isToday ? (
            <Badge variant="outline">{t("report.dueBy", { time: day.rules.reportDeadline })}</Badge>
          ) : (
            <Badge dot variant="warning">{t("report.missed")}</Badge>
          )}
        </div>
      </PageHeader>
      <ReportForm
        // Keyed by its day: stepping to another day starts a new form, not the last one's words.
        key={date}
        date={date}
        draft={form.draft}
        candidates={form.candidates.map(({ taskId, key, title, dueDate, projectName, projectId }) => ({ taskId, key, title, dueDate, projectName, billable: !!projectId && form.billableProjects.includes(projectId) }))}
        tomorrow={form.tomorrow}
        initial={{ blockers: form.report?.blockers ?? null, notes: form.report?.notes ?? null }}
        submitted={submitted}
        timeRequired={day?.rules.timeMode === "required" && !day.dayOff}
        // Keyed: the form renders it beside its label, and an element made on the server without a
        // key trips React's list-key warning there.
        notesDraft={<EodNotesDraftButton key="notes-draft" date={date} targetId="notes" />}
      />
    </Page>
  );
}
