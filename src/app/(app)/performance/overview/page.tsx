import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { shiftMonth } from "@/lib/month-grid";
import { getOverview, type Spread } from "@/modules/performance/service";
import { bpText, MonthPicker, monthLabel, readMonth, ScoreFigure, ScoreState } from "@/modules/performance/ui/kpi";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Performance overview" };

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("overview.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("overview.description")}</p>
      </header>
      <PerformanceNav active="overview" />
      <MonthPicker month={month} href={(next) => `/performance/overview?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("overview.kpiTitle", { month: monthLabel(month) })}</h2>
        {overview.entities.map((entity) => (
          <article key={entity.entityId} className="rounded-xl border">
            <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
              <h3 className="font-medium">{`${entity.code} · ${entity.name}`}</h3>
              <ScoreState state={entity.state} label={t(`kpi.state.${entity.state}`)} />
              <span className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">{t("overview.people", { count: entity.spread.people })}</span>
                <ScoreFigure bp={entity.spread.averageBp} text={bpText(format, entity.spread.averageBp)} />
              </span>
            </header>
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
              {entity.months.map((item) => (
                <Link key={item.month} href={`/performance/overview?month=${item.month}`} className={`rounded-md px-2 py-0.5 tabular-nums ${item.status === "closed" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border border-dashed text-muted-foreground"}`} title={t(`kpi.state.${item.status}`)}>
                  {monthLabel(item.month)}
                  {item.overridden ? " *" : ""}
                </Link>
              ))}
              {entity.state === "open" && entity.missing > 0 ? <span className="text-amber-700 dark:text-amber-300">{t("overview.missing", { count: entity.missing })}</span> : null}
            </div>
            {entity.departments.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{t("overview.nobody")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2 font-medium">{t("overview.department")}</th>
                    <th className="p-2 text-right font-medium">{t("overview.scored")}</th>
                    <th className="p-2 text-right font-medium">{t("overview.average")}</th>
                    <th className="p-2 text-right font-medium">{t("overview.spreadHeading")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entity.departments.map((department) => (
                    <tr key={department.departmentId ?? "none"} className="border-b last:border-0">
                      <td className="p-2">{department.name ?? t("overview.noDepartment")}</td>
                      <td className="p-2 text-right tabular-nums">{department.spread.people}</td>
                      <td className="p-2 text-right">
                        <ScoreFigure bp={department.spread.averageBp} text={bpText(format, department.spread.averageBp)} />
                      </td>
                      <td className="p-2 text-right text-xs text-muted-foreground tabular-nums">{spread(department.spread)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
        <p className="text-xs text-muted-foreground">{t("overview.hint")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("overview.goalsTitle", { year: month.slice(0, 4) })}</h2>
        {overview.goals.length === 0 ? <p className="text-sm text-muted-foreground">{t("company.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {overview.goals.map((goal) => (
            <li key={goal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/performance/goals/${goal.id}`} className="font-medium hover:underline">
                  {goal.title}
                </Link>
                <p className="text-xs text-muted-foreground">{[t(`enums.level.${goal.level}`), goal.unitName, goal.periodKey].filter(Boolean).join(" · ")}</p>
              </div>
              <ConfidenceBadge confidence={goal.confidence} label={goal.confidence ? t(`enums.confidence.${goal.confidence}`) : ""} />
              <ProgressBar bp={goal.progressBp} label={goal.progressBp === null ? t("notMeasured") : bpText(format, goal.progressBp)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
