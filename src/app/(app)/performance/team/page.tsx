import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { getTeamDashboard } from "@/modules/performance/service";
import { bpText, MonthPicker, readMonth, ScoreFigure, ScoreState } from "@/modules/performance/ui/kpi";
import { Page, PageHeader } from "@/components/ui/page";
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
    <Page>
      <PageHeader
        title={t("team.title")}
        description={t("team.description")}
        actions={
          entersFor ? (
            <Link href={`/performance/team/actuals?month=${month}`} className={buttonVariants()}>
              {t("team.enter")}
            </Link>
          ) : null
        }
      />
      <PerformanceNav active="team" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} href={(next) => `/performance/team?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
        <p className="text-sm text-muted-foreground">{t("team.summary", { people: rows.length, measured: measured.length, missing })}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("team.person")}</TableHead>
            <TableHead kind="percent" className="text-left">
              {t("team.kpiScore")}
            </TableHead>
            <TableHead kind="number">{t("team.missing")}</TableHead>
            <TableHead kind="percent" className="text-left">
              {t("team.goals")}
            </TableHead>
            <TableHead kind="number">{t("team.stale")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/performance/kpis/${row.personId}?month=${month}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
              </TableCell>
              <TableCell>
                {row.kpi ? (
                  <span className="flex items-center gap-2">
                    <ScoreFigure bp={row.kpi.scoreBp} text={bpText(format, row.kpi.scoreBp)} />
                    <ScoreState state={row.kpi.state} label={t(`kpi.state.${row.kpi.state}`)} />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("team.noKpis")}</span>
                )}
              </TableCell>
              <TableCell kind="number" className={row.kpi && row.kpi.missing > 0 ? "text-warning" : "text-muted-foreground"}>
                {row.kpi ? `${row.kpi.missing}/${row.kpi.lines}` : "—"}
              </TableCell>
              <TableCell>
                {row.okr ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <ProgressBar bp={row.okr.progressBp} label={row.okr.progressBp === null ? t("notMeasured") : bpText(format, row.okr.progressBp)} />
                    <ConfidenceBadge confidence={row.okr.confidence} label={row.okr.confidence ? t(`enums.confidence.${row.okr.confidence}`) : ""} />
                    <span className="text-xs text-muted-foreground">{t("team.goalCount", { count: row.okr.goals })}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("team.noGoals")}</span>
                )}
              </TableCell>
              <TableCell kind="number" className={row.okr && row.okr.stale > 0 ? "text-warning" : "text-muted-foreground"}>
                {row.okr ? row.okr.stale : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t("team.hint")}</p>
    </Page>
  );
}
