import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getReportForm, REPORT_BACKFILL_DAYS } from "@/modules/daily/service";
import { EodNotesDraftButton } from "@/modules/ai/ui/draft-button";
import { ReportForm } from "@/modules/daily/ui/report-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("dailyReport");

// FR-PJM-22: the day's report, already written from the record — the person adds judgement and sends.
export default async function ReportPage({ searchParams }: PageProps<"/daily/report">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { date: asked } = await searchParams;
  const date = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today && asked >= addDays(today, -REPORT_BACKFILL_DAYS) ? asked : today;
  const [t, format, form] = await Promise.all([getTranslations("daily"), getFormatter(), getReportForm(user.person.id, date)]);
  const day = form.day;
  const submitted = form.report?.status === "submitted";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/today" className="underline">
            {t("today.title")}
          </Link>
        </p>
        <h1>{t("report.title")}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="flex flex-wrap gap-2">
          {submitted ? <Badge variant={form.report!.late ? "warning" : "success"}>{form.report!.late ? t("late") : t("submitted")}</Badge> : day?.report.required ? <Badge variant="outline">{t("report.dueBy", { time: day.rules.reportDeadline })}</Badge> : <Badge variant="secondary">{t("report.optional")}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{t("report.prefilledHint")}</p>
      </header>
      <ReportForm
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
    </div>
  );
}
