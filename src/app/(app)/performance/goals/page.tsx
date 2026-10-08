import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { isPeriodKey, listGoals, periodsOfYear, yearOfPeriod } from "@/modules/performance/service";
import { GoalTree, periodLabel } from "@/modules/performance/ui/goal-tree";
import { Page, PageHeader } from "@/components/ui/page";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("goals");

// The alignment view (FR-PRF-01): group → entity → department → team → individual. Unit goals are
// open to the whole staff; individual goals appear only for the people the viewer reads.
export default async function AlignmentPage({ searchParams }: PageProps<"/performance/goals">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = readYear(params.year, today);
  const periodKey = isPeriodKey(params.period) && yearOfPeriod(params.period) === year ? params.period : null;
  const showCancelled = params.cancelled === "1";
  const all = await listGoals({ principal: user.principal, personId: user.person.id }, { year, periodKey });
  const goals = showCancelled ? all : all.filter((goal) => goal.status !== "cancelled");
  const t = await getTranslations("performance");

  const ids = new Set(goals.map((goal) => goal.id));
  // The tree starts at the group's goals and at anything whose parent is out of sight; a goal below the group that names no parent is unaligned.
  const roots = goals.filter((goal) => (goal.parentGoalId ? !ids.has(goal.parentGoalId) : goal.level === "group"));
  const unaligned = goals.filter((goal) => !goal.parentGoalId && goal.level !== "group");
  const tab = (active: boolean) => `press flex h-9 items-center rounded-[7px] px-3 text-[0.8125rem] whitespace-nowrap md:h-8 ${active ? "pill-on" : "pill-off"}`;
  const href = (next: { year?: number; period?: string | null }) => {
    const search = new URLSearchParams({ year: String(next.year ?? year) });
    const period = next.period === undefined ? periodKey : next.period;
    if (period && !next.year) search.set("period", period);
    if (showCancelled) search.set("cancelled", "1");
    return `/performance/goals?${search}`;
  };

  return (
    <Page>
      <PageHeader
        title={t("alignment.title")}
        description={t("alignment.description")}
        actions={
          <Link href={`/performance/goals/new?year=${year}`} className={buttonVariants()}>
            {t("newGoal")}
          </Link>
        }
      />
      <PerformanceNav active="alignment" year={year} />
      <nav className="flex flex-wrap items-center gap-2">
        <div className="segmented">
          {yearChoices(today).map((choice) => (
            <Link key={choice} href={href({ year: choice })} className={tab(choice === year)}>
              {choice}
            </Link>
          ))}
        </div>
        <div className="segmented">
          <Link href={href({ period: null })} className={tab(!periodKey)}>
            {t("alignment.allPeriods")}
          </Link>
          {periodsOfYear(year)
            .slice(1)
            .map((period) => (
              <Link key={period} href={href({ period })} className={tab(period === periodKey)}>
                {periodLabel(t, period)}
              </Link>
            ))}
        </div>
      </nav>

      {goals.length === 0 ? <p className="text-sm text-muted-foreground">{t("alignment.empty", { year })}</p> : null}
      {roots.length > 0 ? <GoalTree goals={goals} rootIds={roots.map((goal) => goal.id)} /> : null}
      {unaligned.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("alignment.unaligned")} count={unaligned.length} description={t("alignment.unalignedHint")} />
          <GoalTree goals={goals} rootIds={unaligned.map((goal) => goal.id)} />
        </TableCard>
      ) : null}
    </Page>
  );
}
