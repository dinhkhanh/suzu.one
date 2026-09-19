// The alignment view (FR-PRF-01): goals as a tree from the group down to individuals, each with its
// figure, confidence and owner. Server-rendered; the viewer's visibility was applied by the service.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { isAnnual } from "../enums";
import type { GoalView } from "../goals";
import { ConfidenceBadge, GoalStatusBadge, ProgressBar } from "./progress";

type Labels = { t: Awaited<ReturnType<typeof getTranslations>>; format: Awaited<ReturnType<typeof getFormatter>> };

export const periodLabel = (t: Labels["t"], periodKey: string) => (isAnnual(periodKey) ? t("period.annual", { year: periodKey }) : t("period.quarter", { quarter: periodKey.slice(-1), year: periodKey.slice(0, 4) }));
export const progressLabel = ({ t, format }: Labels, bp: number | null) => (bp === null ? t("notMeasured") : `${format.number(bp / 100, { maximumFractionDigits: 2 })} %`);

export function GoalLine({ goal, labels }: { goal: GoalView; labels: Labels }) {
  const { t } = labels;
  const stale = goal.keyResults.some((keyResult) => keyResult.stale);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <Link href={`/performance/goals/${goal.id}`} className={`font-medium hover:underline ${goal.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
          {goal.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {[`${t(`enums.level.${goal.level}`)}${goal.unitName ? ` · ${goal.unitName}` : ""}`, goal.level === "individual" ? null : goal.ownerName, periodLabel(t, goal.periodKey), stale ? t("stale") : null, goal.hiddenChildren > 0 ? t("hiddenChildren", { count: goal.hiddenChildren }) : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      {goal.status === "active" ? null : <GoalStatusBadge status={goal.status} label={t(`enums.status.${goal.status}`)} />}
      <ConfidenceBadge confidence={goal.progress.confidence} label={goal.progress.confidence ? t(`enums.confidence.${goal.progress.confidence}`) : ""} />
      <ProgressBar bp={goal.progress.progressBp} label={progressLabel(labels, goal.progress.progressBp)} />
    </div>
  );
}

export async function GoalTree({ goals, rootIds }: { goals: GoalView[]; rootIds: string[] }) {
  const labels: Labels = { t: await getTranslations("performance"), format: await getFormatter() };
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const node = (id: string, path: ReadonlySet<string>) => {
    const goal = byId.get(id);
    if (!goal || path.has(id)) return null;
    const children = goal.childIds.filter((childId) => byId.has(childId));
    return (
      <li key={id}>
        <GoalLine goal={goal} labels={labels} />
        {children.length > 0 ? <ul className="ml-3 border-l pl-4">{children.map((childId) => node(childId, new Set(path).add(id)))}</ul> : null}
      </li>
    );
  };
  return <ul className="flex flex-col divide-y">{rootIds.map((id) => node(id, new Set()))}</ul>;
}
