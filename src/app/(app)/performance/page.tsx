import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { isAnnual, quarterOfMonth } from "@/modules/performance/enums";
import { getScorecard } from "@/modules/performance/kpi-scores";
import { listGoals } from "@/modules/performance/service";
import { CheckInForm } from "@/modules/performance/ui/goal-forms";
import { GoalLine, periodLabel, progressLabel } from "@/modules/performance/ui/goal-tree";
import { readMonth } from "@/modules/performance/ui/kpi";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { ConfidenceBadge, GoalStatusBadge, metricText, ProgressBar } from "@/modules/performance/ui/progress";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("goals");

// My goals (FR-PRF-01): what I own or am accountable for, where each key result stands, and the
// weekly check-in right there. Below: the company's goals at a glance.
export default async function MyGoalsPage({ searchParams }: PageProps<"/performance">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = readYear(params.year, today);
  const month = readMonth(undefined, today);
  const [goals, card, t, format] = await Promise.all([listGoals({ principal: user.principal, personId: user.person.id }, { year }), getScorecard(user.person.id, month), getTranslations("performance"), getFormatter()]);
  const labels = { t, format };

  const mine = goals.filter((goal) => goal.status !== "cancelled" && (goal.personId === user.person.id || goal.ownerPersonId === user.person.id));
  const company = goals.filter((goal) => goal.status !== "cancelled" && goal.status !== "draft" && (goal.level === "group" || (goal.level === "entity" && goal.entityId === user.person.primaryEntityId)));
  const due = mine.filter((goal) => goal.keyResults.some((keyResult) => keyResult.stale)).length;

  // The key figures: this quarter's progress over my goals of the quarter (and the year's), the
  // goals that are at risk, the KPIs of the month just ended that met their target, the check-ins due.
  const quarter = quarterOfMonth(today.slice(0, 7));
  const quarterGoals = mine.filter((goal) => goal.status === "active" && (goal.periodKey === quarter || isAnnual(goal.periodKey)) && goal.progress.progressBp !== null);
  const quarterBp = quarterGoals.length === 0 ? null : Math.round(quarterGoals.reduce((sum, goal) => sum + (goal.progress.progressBp ?? 0), 0) / quarterGoals.length);
  const atRisk = mine.filter((goal) => goal.status === "active" && (goal.progress.confidence === "at_risk" || goal.progress.confidence === "off_track")).length;
  const scored = card.trace.lines.filter((line) => line.counted && line.finalBp !== null);
  const onTarget = scored.filter((line) => (line.finalBp ?? 0) >= 10_000).length;
  const checkIns = mine.reduce((sum, goal) => sum + goal.keyResults.filter((keyResult) => keyResult.stale).length, 0);

  return (
    <Page>
      <PageHeader
        eyebrow={t("period.quarter", { quarter: quarter.slice(-1), year: quarter.slice(0, 4) })}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Segmented aria-label={t("yearLabel")} value={String(year)} options={yearChoices(today).map((choice) => ({ value: String(choice), label: choice, href: `/performance?year=${choice}` }))} />
            <Link href={`/performance/goals/new?year=${year}`} className={buttonVariants()}>
              {t("newGoal")}
            </Link>
          </>
        }
      />
      <PerformanceNav active="mine" year={year} />

      <TileGrid>
        <Tile label={t("tiles.quarter")} value={quarterBp === null ? "—" : `${format.number(quarterBp / 100, { maximumFractionDigits: 0 })}%`} hint={t("tiles.quarterHint", { count: quarterGoals.length })} />
        <Tile label={t("tiles.goals")} value={mine.length} hint={atRisk > 0 ? t("tiles.atRisk", { count: atRisk }) : t("tiles.onTrack")} tone={atRisk > 0 ? "warning" : undefined} />
        <Tile label={t("tiles.kpis")} value={scored.length === 0 ? "—" : `${onTarget}/${scored.length}`} hint={t("tiles.kpisHint")} href="/performance/kpis" />
        <Tile label={t("tiles.checkIns")} value={checkIns} hint={checkIns > 0 ? t("tiles.checkInsDue") : t("tiles.checkInsDone")} tone={checkIns > 0 ? "warning" : undefined} />
      </TileGrid>

      <Section title={t("mine.title")} count={mine.length || null}>
        {due > 0 ? <p className="text-sm text-warning">{t("mine.due", { count: due })}</p> : null}
        {mine.length === 0 ? (
          <TableCard>
            <List>
              <ListEmpty>{t("mine.empty", { year })}</ListEmpty>
            </List>
            <TableAddRow label={t("newGoal")} href={`/performance/goals/new?year=${year}`} />
          </TableCard>
        ) : (
          <div className="flex flex-col gap-3">
            {mine.map((goal, index) => {
              // Everything listed here is mine or mine to answer for: the check-in is open while the goal runs.
              const mayCheckIn = goal.status === "active";
              const stale = goal.keyResults.some((keyResult) => keyResult.stale);
              return (
                <Card key={goal.id} size="sm" className="rise gap-0 py-0" style={{ "--i": index } as CSSProperties}>
                  {/* The goal's row: what it is | how far it is | where it stands. Three columns on a desk, stacked on a phone. */}
                  <div className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-center md:gap-6">
                    <div className="min-w-0">
                      <Link href={`/performance/goals/${goal.id}`} className="font-semibold tracking-[-0.01em] hover:underline">
                        {goal.title}
                      </Link>
                      <p className="truncate text-xs text-faint">
                        {[`${t(`enums.level.${goal.level}`)}${goal.unitName ? ` · ${goal.unitName}` : ""}`, periodLabel(t, goal.periodKey), goal.keyResults.length > 0 ? t("keyResultCount", { count: goal.keyResults.length }) : goal.childIds.length > 0 ? t("mine.rollsUp") : t("mine.noKeyResults"), stale ? t("stale") : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <ProgressBar wide bp={goal.progress.progressBp} label={progressLabel(labels, goal.progress.progressBp)} />
                    <div className="flex items-center gap-1.5 md:justify-end">
                      {goal.status === "active" ? <ConfidenceBadge confidence={goal.progress.confidence} label={goal.progress.confidence ? t(`enums.confidence.${goal.progress.confidence}`) : ""} /> : <GoalStatusBadge status={goal.status} label={t(`enums.status.${goal.status}`)} />}
                      {goal.status === "active" && !goal.progress.confidence ? <Badge variant="outline">{t("enums.status.active")}</Badge> : null}
                    </div>
                  </div>
                  {goal.keyResults.length > 0 ? (
                    <ul className="flex flex-col divide-y divide-border/70 border-t border-border/70 bg-canvas/60">
                      {goal.keyResults.map((keyResult) => (
                        <li key={keyResult.id} className="flex flex-col gap-2 px-4 py-2.5 text-sm">
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-center md:gap-6">
                            <div className="min-w-0">
                              <span className="block truncate">{keyResult.title}</span>
                              <span className="font-mono text-xs text-faint tabular-nums">
                                {metricText(format, keyResult.metricType, keyResult.currentValue, keyResult.milestones)}
                                {keyResult.metricType === "milestone" ? "" : ` → ${metricText(format, keyResult.metricType, keyResult.targetValue)}`}
                              </span>
                            </div>
                            <ProgressBar wide bp={keyResult.progressBp} label={progressLabel(labels, keyResult.progressBp)} />
                            <div className="flex items-center gap-2 md:justify-end">
                              <ConfidenceBadge confidence={keyResult.confidence} label={keyResult.confidence ? t(`enums.confidence.${keyResult.confidence}`) : ""} />
                              {mayCheckIn ? (
                                <Badge variant={keyResult.stale ? "warning" : "outline"} dot={keyResult.stale}>
                                  {keyResult.stale ? t("checkIn.dueNow") : t("checkIn.open")}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          {mayCheckIn ? (
                            <details className="group/check">
                              <summary className="cursor-pointer list-none text-xs font-medium text-link select-none [&::-webkit-details-marker]:hidden">
                                <span className="group-open/check:hidden">{t("checkIn.unfold")}</span>
                                <span className="hidden group-open/check:inline">{t("checkIn.fold")}</span>
                              </summary>
                              <div className="pt-2">
                                <CheckInForm keyResult={{ id: keyResult.id, metricType: keyResult.metricType, currentValue: keyResult.currentValue, milestones: keyResult.milestones, confidence: keyResult.confidence }} />
                              </div>
                            </details>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title={t("company.title")}
        count={company.length || null}
        action={<Link href={`/performance/goals?year=${year}`}>{t("company.all")}</Link>}
      >
        <List>
          {company.length === 0 ? <ListEmpty>{t("company.empty", { year })}</ListEmpty> : null}
          {company.map((goal) => (
            <ListItem key={goal.id} className="block py-0">
              <GoalLine goal={goal} labels={labels} />
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
