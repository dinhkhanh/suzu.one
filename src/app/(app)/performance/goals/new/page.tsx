import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { GOAL_LEVELS, type GoalLevel, goalFormOptions, listGoals } from "@/modules/performance/service";
import { NewGoalForm } from "@/modules/performance/ui/goal-forms";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "New goal" };

const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

// A new goal: for oneself, for someone in one's reporting line, or — with the permission — for a unit.
export default async function NewGoalPage({ searchParams }: PageProps<"/performance/goals/new">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = readYear(params.year, today);
  const viewer = { principal: user.principal, personId: user.person.id };
  const [choices, goals] = await Promise.all([goalFormOptions(viewer), listGoals(viewer, { year })]);
  if (choices.levels.length === 0) notFound();
  const t = await getTranslations("performance");

  const parents = goals.filter((goal) => goal.status === "draft" || goal.status === "active").map((goal) => ({ id: goal.id, title: goal.title, level: goal.level, periodKey: goal.periodKey, unitName: goal.unitName }));
  const asked = typeof params.level === "string" && (GOAL_LEVELS as readonly string[]).includes(params.level) ? (params.level as GoalLevel) : null;
  const level = asked && choices.levels.includes(asked) ? asked : choices.levels.includes("individual") ? "individual" : choices.levels[0];
  const parentGoalId = isUuid(params.parent) && parents.some((parent) => parent.id === params.parent) ? params.parent : "";
  const personId = isUuid(params.person) && choices.people.some((person) => person.id === params.person) ? params.person : user.person.id;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("newGoal")}</h1>
        <p className="text-sm text-muted-foreground">{t("form.intro")}</p>
      </header>
      <PerformanceNav active={null} year={year} />
      <nav className="flex flex-wrap items-center gap-1">
        {yearChoices(today).map((choice) => (
          <Link key={choice} href={`/performance/goals/new?year=${choice}`} className={`rounded-md px-2 py-1 text-sm ${choice === year ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
            {choice}
          </Link>
        ))}
      </nav>
      <NewGoalForm key={year} year={year} choices={choices} parents={parents} defaults={{ level, parentGoalId, personId, ownerPersonId: user.person.id }} />
    </div>
  );
}
