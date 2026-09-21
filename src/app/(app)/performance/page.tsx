import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { listGoals } from "@/modules/performance/service";
import { CheckInForm } from "@/modules/performance/ui/goal-forms";
import { GoalLine, progressLabel } from "@/modules/performance/ui/goal-tree";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, metricText, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Goals" };

// My goals (FR-PRF-01): what I own or am accountable for, where each key result stands, and the
// weekly check-in right there. Below: the company's goals at a glance.
export default async function MyGoalsPage({ searchParams }: PageProps<"/performance">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = readYear(params.year, today);
  const goals = await listGoals({ principal: user.principal, personId: user.person.id }, { year });
  const t = await getTranslations("performance");
  const format = await getFormatter();
  const labels = { t, format };

  const mine = goals.filter((goal) => goal.status !== "cancelled" && (goal.personId === user.person.id || goal.ownerPersonId === user.person.id));
  const company = goals.filter((goal) => goal.status !== "cancelled" && goal.status !== "draft" && (goal.level === "group" || (goal.level === "entity" && goal.entityId === user.person.primaryEntityId)));
  const due = mine.filter((goal) => goal.keyResults.some((keyResult) => keyResult.stale)).length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href={`/performance/goals/new?year=${year}`} className={buttonVariants()}>
          {t("newGoal")}
        </Link>
      </header>
      <PerformanceNav active="mine" year={year} />
      <nav className="flex flex-wrap items-center gap-1">
        {yearChoices(today).map((choice) => (
          <Link key={choice} href={`/performance?year=${choice}`} className={`rounded-md px-2 py-1 text-sm ${choice === year ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
            {choice}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <h2>{t("mine.title")}</h2>
        {due > 0 ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("mine.due", { count: due })}</p> : null}
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("mine.empty", { year })}</p> : null}
        {mine.map((goal) => {
          // Everything listed here is mine or mine to answer for: the check-in is open while the goal runs.
          const mayCheckIn = goal.status === "active";
          return (
            <article key={goal.id} className="rounded-xl border px-4 py-2">
              <GoalLine goal={goal} labels={labels} />
              {goal.keyResults.length === 0 ? <p className="pb-2 text-xs text-muted-foreground">{goal.childIds.length > 0 ? t("mine.rollsUp") : t("mine.noKeyResults")}</p> : null}
              <ul className="flex flex-col divide-y border-t">
                {goal.keyResults.map((keyResult) => (
                  <li key={keyResult.id} className="flex flex-col gap-2 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1">{keyResult.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {metricText(format, keyResult.metricType, keyResult.currentValue, keyResult.milestones)}
                        {keyResult.metricType === "milestone" ? "" : ` → ${metricText(format, keyResult.metricType, keyResult.targetValue)}`}
                      </span>
                      <ConfidenceBadge confidence={keyResult.confidence} label={keyResult.confidence ? t(`enums.confidence.${keyResult.confidence}`) : ""} />
                      <ProgressBar bp={keyResult.progressBp} label={progressLabel(labels, keyResult.progressBp)} />
                    </div>
                    {mayCheckIn ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">{keyResult.stale ? t("checkIn.dueNow") : t("checkIn.open")}</summary>
                        <div className="pt-2">
                          <CheckInForm keyResult={{ id: keyResult.id, metricType: keyResult.metricType, currentValue: keyResult.currentValue, milestones: keyResult.milestones, confidence: keyResult.confidence }} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2>{t("company.title")}</h2>
          <Link href={`/performance/goals?year=${year}`} className="text-sm underline">
            {t("company.all")}
          </Link>
        </div>
        {company.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("company.empty", { year })}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border px-4">
            {company.map((goal) => (
              <li key={goal.id}>
                <GoalLine goal={goal} labels={labels} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
