import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listMyReports } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myDays");

// The person's own daily reports, newest first, with the ways into the day's screens.
export default async function DailyIndexPage() {
  const user = await requireUser();
  const [t, format, reports] = await Promise.all([getTranslations("daily"), getFormatter(), listMyReports(user.person.id)]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1>{t("index.title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/daily/plan" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("index.plan")}
          </Link>
          <Link href="/daily/report" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("index.report")}
          </Link>
          <Link href="/daily/team" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("board.title")}
          </Link>
          <Link href="/daily/weekly" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("weekly.title")}
          </Link>
          <Link href="/daily/time" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("time.title")}
          </Link>
          <Link href="/daily/timesheets" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("timesheets.title")}
          </Link>
          <Link href="/daily/utilisation" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("utilisation.title")}
          </Link>
        </div>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("index.recent")}</h2>
        {reports.length === 0 ? <p className="text-sm text-muted-foreground">{t("index.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {reports.map((report) => (
            <li key={report.id} className="flex flex-wrap items-center gap-2 p-3">
              <Link href={`/daily/reports/${report.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                {format.dateTime(new Date(`${report.date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" })}
              </Link>
              {report.blockers?.trim() ? <Badge variant="destructive">{t("index.hasBlockers")}</Badge> : null}
              <span className="text-xs text-muted-foreground">{t("hours", { value: hoursOf(report.minutesLogged) })}</span>
              {report.status === "submitted" ? <Badge variant={report.late ? "warning" : "success"}>{report.late ? t("late") : t("submitted")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
