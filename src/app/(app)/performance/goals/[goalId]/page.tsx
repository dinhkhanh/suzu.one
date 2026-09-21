import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { goalFormOptions, listGoals, loadGoal } from "@/modules/performance/service";
import { CheckInForm, EditGoalForm, GoalMoves, KeyResultForm, RemoveKeyResultButton, ReparentForm } from "@/modules/performance/ui/goal-forms";
import { GoalLine, periodLabel, progressLabel } from "@/modules/performance/ui/goal-tree";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, GoalStatusBadge, metricText, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Goal" };

// One goal: its key results and check-ins, how its figure is made (the trace), and what the viewer may do with it.
export default async function GoalPage({ params }: PageProps<"/performance/goals/[goalId]">) {
  const user = await requireUser();
  const { goalId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(goalId)) notFound();
  const viewer = { principal: user.principal, personId: user.person.id };
  // Not found and not yours look the same.
  const loaded = await loadGoal(viewer, goalId);
  if (!loaded) notFound();
  const { goal, rights, parent, children, checkIns, lineTitles } = loaded;
  const open = goal.status === "draft" || goal.status === "active";
  const [options, siblings] = rights.edit && open ? await Promise.all([goalFormOptions(viewer), listGoals(viewer, { year: goal.year })]) : [null, []];
  const t = await getTranslations("performance");
  const format = await getFormatter();
  const labels = { t, format };

  const withHistory = new Set(checkIns.map((checkIn) => checkIn.keyResultId));
  const parents = siblings.filter((candidate) => candidate.status === "draft" || candidate.status === "active").map((candidate) => ({ id: candidate.id, title: candidate.title, level: candidate.level, periodKey: candidate.periodKey, unitName: candidate.unitName }));
  const moves = [
    ...(goal.status === "draft" && rights.edit ? (["activate"] as const) : []),
    ...(goal.status === "active" && rights.close ? (["close"] as const) : []),
    ...((goal.status === "draft" && rights.edit) || (goal.status === "active" && rights.close) ? (["cancel"] as const) : []),
    ...((goal.status === "closed" || goal.status === "cancelled") && rights.reopen ? (["reopen"] as const) : []),
  ];
  const dateTime = (value: Date) => format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PerformanceNav active={null} year={goal.year} />
      <header className="flex flex-col gap-2">
        {parent ? (
          <p className="text-sm text-muted-foreground">
            {t("detail.alignedTo")}{" "}
            <Link href={`/performance/goals/${parent.id}`} className="underline">
              {parent.title}
            </Link>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1">{goal.title}</h1>
          <GoalStatusBadge status={goal.status} label={t(`enums.status.${goal.status}`)} />
          <ConfidenceBadge confidence={goal.progress.confidence} label={goal.progress.confidence ? t(`enums.confidence.${goal.progress.confidence}`) : ""} />
        </div>
        <p className="text-sm text-muted-foreground">{[`${t(`enums.level.${goal.level}`)}${goal.unitName ? ` · ${goal.unitName}` : ""}`, t("detail.owner", { name: goal.ownerName }), periodLabel(t, goal.periodKey), t("detail.weight", { weight: goal.weight })].join(" · ")}</p>
        {goal.description ? <p className="text-sm whitespace-pre-line">{goal.description}</p> : null}
        <ProgressBar bp={goal.progress.progressBp} label={progressLabel(labels, goal.progress.progressBp)} />
        {goal.status === "closed" && goal.closedAt ? <p className="text-xs text-muted-foreground">{t("detail.frozen", { date: dateTime(goal.closedAt) })}</p> : null}
        <GoalMoves goalId={goal.id} moves={moves} />
      </header>

      <section className="flex flex-col gap-2">
        <h2>{t("kr.heading")}</h2>
        {goal.keyResults.length === 0 ? <p className="text-sm text-muted-foreground">{children.length > 0 ? t("mine.rollsUp") : t("mine.noKeyResults")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border px-4 empty:hidden">
          {goal.keyResults.map((keyResult) => (
            <li key={keyResult.id} className="flex flex-col gap-2 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 font-medium">{keyResult.title}</span>
                <ConfidenceBadge confidence={keyResult.confidence} label={keyResult.confidence ? t(`enums.confidence.${keyResult.confidence}`) : ""} />
                <ProgressBar bp={keyResult.progressBp} label={progressLabel(labels, keyResult.progressBp)} />
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  t(`enums.metric.${keyResult.metricType}`),
                  keyResult.metricType === "milestone"
                    ? metricText(format, "milestone", 0, keyResult.milestones)
                    : t("kr.fromTo", { start: metricText(format, keyResult.metricType, keyResult.startValue), current: metricText(format, keyResult.metricType, keyResult.currentValue), target: metricText(format, keyResult.metricType, keyResult.targetValue) }),
                  t("detail.weight", { weight: keyResult.weight }),
                  keyResult.lastCheckInAt ? t("kr.lastCheckIn", { date: dateTime(keyResult.lastCheckInAt) }) : t("kr.noCheckIn"),
                  keyResult.stale ? t("stale") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {keyResult.metricType === "milestone" ? (
                <ul className="text-xs text-muted-foreground">
                  {(keyResult.milestones ?? []).map((milestone, index) => (
                    <li key={index}>{`${milestone.done ? "☑" : "☐"} ${milestone.title}`}</li>
                  ))}
                </ul>
              ) : null}
              {rights.checkIn && goal.status === "active" ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">{keyResult.stale ? t("checkIn.dueNow") : t("checkIn.open")}</summary>
                  <div className="pt-2">
                    <CheckInForm keyResult={{ id: keyResult.id, metricType: keyResult.metricType, currentValue: keyResult.currentValue, milestones: keyResult.milestones, confidence: keyResult.confidence }} />
                  </div>
                </details>
              ) : null}
              {rights.edit && open ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">{t("kr.edit")}</summary>
                  <div className="flex flex-col gap-2 pt-2">
                    <KeyResultForm goalId={goal.id} value={{ id: keyResult.id, title: keyResult.title, metricType: keyResult.metricType, startValue: keyResult.startValue, targetValue: keyResult.targetValue, milestones: keyResult.milestones, weight: keyResult.weight, hasCheckIns: withHistory.has(keyResult.id) }} />
                    {withHistory.has(keyResult.id) ? <p className="text-xs text-muted-foreground">{t("kr.keptForTrace")}</p> : <RemoveKeyResultButton keyResultId={keyResult.id} />}
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {rights.edit && open ? (
          <details className="rounded-xl border px-4 py-3" open={goal.keyResults.length === 0 && children.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">{t("kr.add")}</summary>
            <div className="pt-3">
              <KeyResultForm goalId={goal.id} value={{ id: null, title: "", metricType: "number", startValue: 0, targetValue: 0, milestones: null, weight: 1, hasCheckIns: false }} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2>{t("trace.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t(`trace.source.${goal.progress.source}`)}</p>
        {goal.progress.lines.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">{t("trace.line")}</th>
                <th className="py-1 text-right font-normal">{t("form.weight")}</th>
                <th className="py-1 text-right font-normal">{t("trace.progress")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {goal.progress.lines.map((line) => (
                <tr key={line.id} className={line.skipped ? "text-muted-foreground" : ""}>
                  <td className="py-1">{line.redacted ? t("trace.private") : (lineTitles[line.id] ?? "—")}</td>
                  <td className="py-1 text-right tabular-nums">{line.weight}</td>
                  <td className="py-1 text-right tabular-nums">{line.redacted ? "—" : line.skipped ? t(`trace.skipped.${line.skipped}`) : progressLabel(labels, line.progressBp)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1">{t("trace.result")}</td>
                <td />
                <td className="py-1 text-right tabular-nums">{progressLabel(labels, goal.progress.progressBp)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2>{t("detail.children")}</h2>
          <Link href={`/performance/goals/new?year=${goal.year}&parent=${goal.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("detail.addChild")}
          </Link>
        </div>
        {children.length === 0 && goal.hiddenChildren === 0 ? <p className="text-sm text-muted-foreground">{t("detail.noChildren")}</p> : null}
        {children.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-xl border px-4">
            {children.map((child) => (
              <li key={child.id}>
                <GoalLine goal={child} labels={labels} />
              </li>
            ))}
          </ul>
        ) : null}
        {goal.hiddenChildren > 0 ? <p className="text-xs text-muted-foreground">{t("hiddenChildren", { count: goal.hiddenChildren })}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2>{t("checkIn.history")}</h2>
        {checkIns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("checkIn.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border px-4">
            {checkIns.map((checkIn) => {
              const keyResult = goal.keyResults.find((candidate) => candidate.id === checkIn.keyResultId);
              return (
                <li key={checkIn.id} className="flex flex-col gap-1 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1">{checkIn.keyResultTitle}</span>
                    <span className="tabular-nums">{keyResult ? metricText(format, keyResult.metricType, checkIn.value ?? 0, checkIn.milestones) : "—"}</span>
                    <ConfidenceBadge confidence={checkIn.confidence as "on_track" | "at_risk" | "off_track"} label={t(`enums.confidence.${checkIn.confidence as "on_track" | "at_risk" | "off_track"}`)} />
                  </div>
                  <p className="text-xs text-muted-foreground">{[checkIn.authorName, dateTime(checkIn.createdAt), t("checkIn.week", { date: format.dateTime(new Date(`${checkIn.weekStart}T00:00:00`), { dateStyle: "medium" }) })].join(" · ")}</p>
                  {checkIn.note ? <p className="text-sm whitespace-pre-line">{checkIn.note}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {rights.edit && open && options ? (
        <section className="flex flex-col gap-4 rounded-xl border p-4">
          <h2>{t("detail.edit")}</h2>
          <EditGoalForm goal={{ id: goal.id, title: goal.title, description: goal.description, periodKey: goal.periodKey, year: goal.year, weight: goal.weight, ownerPersonId: goal.ownerPersonId, level: goal.level }} owners={options.owners} />
          <ReparentForm goal={{ id: goal.id, level: goal.level, periodKey: goal.periodKey, parentGoalId: goal.parentGoalId }} parents={parents} />
        </section>
      ) : null}
    </div>
  );
}
