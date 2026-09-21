import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { isPeriodKey, listGoals, periodsOfYear, yearOfPeriod } from "@/modules/performance/service";
import { GoalTree, periodLabel } from "@/modules/performance/ui/goal-tree";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Goals" };

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
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;
  const href = (next: { year?: number; period?: string | null }) => {
    const search = new URLSearchParams({ year: String(next.year ?? year) });
    const period = next.period === undefined ? periodKey : next.period;
    if (period && !next.year) search.set("period", period);
    if (showCancelled) search.set("cancelled", "1");
    return `/performance/goals?${search}`;
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("alignment.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("alignment.description")}</p>
        </div>
        <Link href={`/performance/goals/new?year=${year}`} className={buttonVariants()}>
          {t("newGoal")}
        </Link>
      </header>
      <PerformanceNav active="alignment" year={year} />
      <nav className="flex flex-wrap items-center gap-1">
        {yearChoices(today).map((choice) => (
          <Link key={choice} href={href({ year: choice })} className={tab(choice === year)}>
            {choice}
          </Link>
        ))}
        <span className="mx-2 h-4 border-l" />
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
      </nav>

      {goals.length === 0 ? <p className="text-sm text-muted-foreground">{t("alignment.empty", { year })}</p> : null}
      {roots.length > 0 ? (
        <section className="rounded-xl border px-4">
          <GoalTree goals={goals} rootIds={roots.map((goal) => goal.id)} />
        </section>
      ) : null}
      {unaligned.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2>{t("alignment.unaligned")}</h2>
          <p className="text-sm text-muted-foreground">{t("alignment.unalignedHint")}</p>
          <div className="rounded-xl border px-4">
            <GoalTree goals={goals} rootIds={unaligned.map((goal) => goal.id)} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
