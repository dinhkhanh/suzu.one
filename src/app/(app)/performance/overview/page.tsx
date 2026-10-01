import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { shiftMonth } from "@/lib/month-grid";
import { getOverview, type Spread } from "@/modules/performance/service";
import { bpText, MonthPicker, monthLabel, readMonth, ScoreFigure, ScoreState } from "@/modules/performance/ui/kpi";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("performanceOverview");

// The owner's dashboard: per entity and department — who is scored, how the scores spread, which
// months are closed — and where the top goals stand. Whole entities in the viewer's reach only.
export default async function PerformanceOverviewPage({ searchParams }: PageProps<"/performance/overview">) {
  const user = await requireUser();
  const month = readMonth((await searchParams).month, todayInVietnam());
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5));
  const overview = await getOverview({ principal: user.principal, personId: user.person.id }, month, months);
  if (!overview) notFound();
  const t = await getTranslations("performance");
  const format = await getFormatter();
  const spread = (value: Spread) => (value.people === 0 ? "—" : t("overview.spread", { min: bpText(format, value.minBp), median: bpText(format, value.medianBp), max: bpText(format, value.maxBp) }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("overview.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("overview.description")}</p>
      </header>
      <PerformanceNav active="overview" />
      <MonthPicker month={month} href={(next) => `/performance/overview?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />

      <section className="flex flex-col gap-4">
        <h2>{t("overview.kpiTitle", { month: monthLabel(month) })}</h2>
        {overview.entities.map((entity) => (
          <TableCard key={entity.entityId}>
            <TableCardHeader
              title={`${entity.code} · ${entity.name}`}
              actions={
                <>
                  <ScoreState state={entity.state} label={t(`kpi.state.${entity.state}`)} />
                  <span className="text-sm text-muted-foreground">{t("overview.people", { count: entity.spread.people })}</span>
                  <span className="text-sm">
                    <ScoreFigure bp={entity.spread.averageBp} text={bpText(format, entity.spread.averageBp)} />
                  </span>
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
              {entity.months.map((item) => (
                <Link key={item.month} href={`/performance/overview?month=${item.month}`} className={`rounded-md px-2 py-0.5 tabular-nums ${item.status === "closed" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border border-dashed text-muted-foreground"}`} title={t(`kpi.state.${item.status}`)}>
                  {monthLabel(item.month)}
                  {item.overridden ? " *" : ""}
                </Link>
              ))}
              {entity.state === "open" && entity.missing > 0 ? <span className="text-warning">{t("overview.missing", { count: entity.missing })}</span> : null}
            </div>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="org">{t("overview.department")}</TableHead>
                  <TableHead kind="number">{t("overview.scored")}</TableHead>
                  <TableHead kind="percent">{t("overview.average")}</TableHead>
                  <TableHead kind="percent">{t("overview.spreadHeading")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entity.departments.length === 0 ? <TableEmpty>{t("overview.nobody")}</TableEmpty> : null}
                {entity.departments.map((department) => (
                  <TableRow key={department.departmentId ?? "none"}>
                    <TableCell>{department.name ?? t("overview.noDepartment")}</TableCell>
                    <TableCell kind="number">{department.spread.people}</TableCell>
                    <TableCell kind="percent">
                      <ScoreFigure bp={department.spread.averageBp} text={bpText(format, department.spread.averageBp)} />
                    </TableCell>
                    <TableCell kind="percent" className="text-xs text-muted-foreground">{spread(department.spread)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ))}
        <p className="text-xs text-muted-foreground">{t("overview.hint")}</p>
      </section>

      <TableCard>
        <TableCardHeader title={t("overview.goalsTitle", { year: month.slice(0, 4) })} count={overview.goals.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("form.title")}</TableHead>
              <TableHead kind="select">{t("form.level")}</TableHead>
              <TableHead kind="org">{t("overview.unit")}</TableHead>
              <TableHead kind="date">{t("form.period")}</TableHead>
              <TableHead kind="status">{t("checkIn.confidence")}</TableHead>
              <TableHead kind="percent" className="text-left">{t("trace.progress")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.goals.length === 0 ? <TableEmpty>{t("company.empty")}</TableEmpty> : null}
            {overview.goals.map((goal) => (
              <TableRow key={goal.id}>
                <TableCell className="max-w-96">
                  <Link href={`/performance/goals/${goal.id}`} className="block truncate font-medium hover:underline">
                    {goal.title}
                  </Link>
                </TableCell>
                <TableCell>{t(`enums.level.${goal.level}`)}</TableCell>
                <TableCell className="text-muted-foreground">{goal.unitName ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{goal.periodKey}</TableCell>
                <TableCell>
                  <ConfidenceBadge confidence={goal.confidence} label={goal.confidence ? t(`enums.confidence.${goal.confidence}`) : ""} />
                </TableCell>
                <TableCell>
                  <ProgressBar bp={goal.progressBp} label={goal.progressBp === null ? t("notMeasured") : bpText(format, goal.progressBp)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
