import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { getTeamDashboard } from "@/modules/performance/service";
import { bpText, MonthPicker, readMonth, ScoreFigure, ScoreState } from "@/modules/performance/ui/kpi";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("teamPerformance");

// The manager's dashboard (FR-PRF-02): everyone below me — or in my role's scope — with the month's
// KPI score, what is still missing, and where their goals stand. Nobody to look after: 404.
export default async function TeamPerformancePage({ searchParams }: PageProps<"/performance/team">) {
  const user = await requireUser();
  const month = readMonth((await searchParams).month, todayInVietnam());
  const rows = await getTeamDashboard({ principal: user.principal, personId: user.person.id }, month);
  if (rows.length === 0) notFound();
  const t = await getTranslations("performance");
  const format = await getFormatter();
  const measured = rows.filter((row) => row.kpi || row.okr);
  const missing = rows.reduce((sum, row) => sum + (row.kpi?.missing ?? 0), 0);
  const entersFor = rows.some((row) => row.canEnter && row.kpi);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("team.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("team.description")}</p>
        </div>
        {entersFor ? (
          <Link href={`/performance/team/actuals?month=${month}`} className={buttonVariants()}>
            {t("team.enter")}
          </Link>
        ) : null}
      </header>
      <PerformanceNav active="team" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} href={(next) => `/performance/team?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
        <p className="text-sm text-muted-foreground">{t("team.summary", { people: rows.length, measured: measured.length, missing })}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="p-2 font-medium">{t("team.person")}</th>
              <th className="p-2 font-medium">{t("team.kpiScore")}</th>
              <th className="p-2 text-right font-medium">{t("team.missing")}</th>
              <th className="p-2 font-medium">{t("team.goals")}</th>
              <th className="p-2 text-right font-medium">{t("team.stale")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} className="border-b last:border-0">
                <td className="p-2">
                  <Link href={`/performance/kpis/${row.personId}?month=${month}`} className="font-medium hover:underline">
                    {row.fullName}
                  </Link>
                </td>
                <td className="p-2">
                  {row.kpi ? (
                    <span className="flex items-center gap-2">
                      <ScoreFigure bp={row.kpi.scoreBp} text={bpText(format, row.kpi.scoreBp)} />
                      <ScoreState state={row.kpi.state} label={t(`kpi.state.${row.kpi.state}`)} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("team.noKpis")}</span>
                  )}
                </td>
                <td className={`p-2 text-right tabular-nums ${row.kpi && row.kpi.missing > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{row.kpi ? `${row.kpi.missing}/${row.kpi.lines}` : "—"}</td>
                <td className="p-2">
                  {row.okr ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <ProgressBar bp={row.okr.progressBp} label={row.okr.progressBp === null ? t("notMeasured") : bpText(format, row.okr.progressBp)} />
                      <ConfidenceBadge confidence={row.okr.confidence} label={row.okr.confidence ? t(`enums.confidence.${row.okr.confidence}`) : ""} />
                      <span className="text-xs text-muted-foreground">{t("team.goalCount", { count: row.okr.goals })}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("team.noGoals")}</span>
                  )}
                </td>
                <td className={`p-2 text-right tabular-nums ${row.okr && row.okr.stale > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{row.okr ? row.okr.stale : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("team.hint")}</p>
    </div>
  );
}
