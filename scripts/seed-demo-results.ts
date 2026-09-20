// Phase 8 demo data for the final yearly result (FR-PRF-09), called from seed-demo.ts after the
// review cycle. Idempotent: skipped once any result exists.
//
// A seed script cannot load the `server-only` use-cases, so the rows are written the way
// `final-results.ts` writes them — but every **figure** comes from the same pure engines the
// application uses (`engine/result.ts`, `engine/progress.ts`, `engine/kpi-score.ts`), so what is
// seeded is exactly what recomputing the year in the app would produce. Week 3's bonus run reads
// these rows, and the whole chain has to add up.
//
// What is left behind for the 2026 Suzu Media cycle:
//   · one approved, group-wide weighting version in force from 2026-01-01 (configuration, SRS Q14)
//   · a locked-and-published result for everybody whose review was released
//   · one of them carrying an owner override with its reason, so the "explain the amount" path
//     has both halves to show
import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { goal, keyResult, kpiAssignment, kpiDefinition, kpiScore, performanceResult, performanceWeighting, person, reviewCycle, reviewParticipant } from "../src/lib/db/schema";
import { annualKpiScore } from "../src/modules/performance/engine/kpi-score";
import { type GoalInput, goalProgress, weightedAverageBp } from "../src/modules/performance/engine/progress";
import { finalResult, type OkrLevelInput } from "../src/modules/performance/engine/result";
import { type Confidence, coversMonth, DEFAULT_PERFORMANCE_WEIGHTING, type GoalStatus, type KpiFrequency, type MetricType, monthsOfYear, type OkrLevel, periodDueIn } from "../src/modules/performance/enums";

type Db = ReturnType<typeof drizzle>;

const HA = "Nguyễn Thu Hà";
const OWNER = "Trần Đình Khánh";
/** Whose result the owner moves, and why — the "explainable from the override" half of FR-PAY-21. */
const OVERRIDE = { who: "Bùi Thanh Tâm", scoreBp: 11_800, reason: "Gánh phần lớn khối lượng quý 3 khi phòng thiếu người; điểm theo công thức chưa phản ánh việc đó." };

const YEAR = 2026;

export async function seedPerformanceResults(db: Db): Promise<string> {
  const [already] = await db.select({ id: performanceResult.id }).from(performanceResult).limit(1);
  if (already) return "0 performance results (already seeded)";

  const people = await db.select({ id: person.id, fullName: person.fullName, entityId: person.primaryEntityId, departmentId: person.departmentId, teamId: person.teamId }).from(person);
  const byName = new Map(people.map((row) => [row.fullName, row]));
  const byId = new Map(people.map((row) => [row.id, row]));
  const hr = byName.get(HA);
  const owner = byName.get(OWNER) ?? hr;
  if (!hr || !owner) return "0 performance results (run the people seed first)";

  // ── The weighting: configuration the owner approved, not a constant in code ────────────────
  const [weighting] = await db
    .insert(performanceWeighting)
    .values({
      entityId: null,
      value: DEFAULT_PERFORMANCE_WEIGHTING,
      validFrom: `${YEAR}-01-01`,
      status: "approved",
      note: "Phiên bản đầu: KPI 50 %, đánh giá 30 %, OKR 20 %. Năm nào dùng phiên bản hiệu lực đến 31/12 năm đó.",
      proposedByPersonId: hr.id,
      decidedByPersonId: owner.id,
      decidedAt: new Date(`${YEAR}-11-20T02:00:00Z`),
    })
    .returning();

  // ── The released review figures of the year's annual cycles ────────────────────────────────
  const released = await db
    .select({ participantId: reviewParticipant.id, personId: reviewParticipant.personId, entityId: reviewParticipant.entityId, reviewScoreBp: reviewParticipant.reviewScoreBp })
    .from(reviewParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewParticipant.cycleId))
    .where(and(eq(reviewCycle.year, YEAR), eq(reviewCycle.kind, "annual")));
  const withReview = released.filter((row) => row.reviewScoreBp !== null);
  if (withReview.length === 0) return "0 performance results (no released review)";

  // ── OKR attainment, the way `getOkrResults` works it out ──────────────────────────────────
  const goals = await db.select().from(goal).where(eq(goal.year, YEAR)).orderBy(asc(goal.createdAt), asc(goal.id));
  const keyResults = goals.length === 0 ? [] : await db.select().from(keyResult).where(inArray(keyResult.goalId, goals.map((row) => row.id)));
  const children = new Map<string, string[]>();
  for (const row of goals) if (row.parentGoalId) children.set(row.parentGoalId, [...(children.get(row.parentGoalId) ?? []), row.id]);
  const inputs = new Map<string, GoalInput>(
    goals.map((row) => [
      row.id,
      {
        id: row.id,
        status: row.status as GoalStatus,
        weight: row.weight,
        finalProgressBp: row.finalProgressBp,
        childIds: children.get(row.id) ?? [],
        keyResults: keyResults
          .filter((kr) => kr.goalId === row.id)
          .map((kr) => ({ id: kr.id, metricType: kr.metricType as MetricType, startValue: kr.startValue, targetValue: kr.targetValue, currentValue: kr.currentValue, milestones: kr.milestones, weight: kr.weight, confidence: kr.confidence as Confidence | null })),
      },
    ]),
  );
  const counted = goals.filter((row) => row.status === "active" || row.status === "closed");
  /** The weighted average of the top-most goals of one owner, and the goals behind it. */
  const figure = (rows: typeof goals): { progressBp: number | null; goals: string[] } => {
    const ids = new Set(rows.map((row) => row.id));
    const top = rows.filter((row) => !row.parentGoalId || !ids.has(row.parentGoalId));
    return { progressBp: weightedAverageBp(top.map((row) => ({ weight: row.weight, progressBp: goalProgress(row.id, inputs).progressBp }))), goals: rows.map((row) => row.id) };
  };

  // ── The stored KPI scores of the year ──────────────────────────────────────────────────────
  const scores = await db.select().from(kpiScore).where(and(like(kpiScore.month, `${YEAR}-%`), isNull(kpiScore.supersededAt))).orderBy(asc(kpiScore.month));
  const assignments = await db.select({ assignment: kpiAssignment, frequency: kpiDefinition.frequency }).from(kpiAssignment).innerJoin(kpiDefinition, eq(kpiDefinition.id, kpiAssignment.kpiId));

  let published = 0;
  let overridden = 0;
  for (const row of withReview) {
    const who = byId.get(row.personId);
    if (!who) continue;

    const mine = scores.filter((score) => score.personId === row.personId);
    const kpi = annualKpiScore(mine.map((score) => score.trace));
    const closedMonths = mine.map((score) => score.month);
    const myAssignments = assignments.filter((line) => line.assignment.personId === row.personId);
    const openMonths = monthsOfYear(YEAR).filter((month) => !closedMonths.includes(month) && myAssignments.some(({ assignment, frequency }) => coversMonth(assignment, month) && periodDueIn(frequency as KpiFrequency, month) !== null));

    const ofEntity = (item: (typeof goals)[number]) => !item.entityId || item.entityId === who.entityId;
    const levels: Record<OkrLevel, { progressBp: number | null; goals: string[] }> = {
      individual: figure(counted.filter((item) => item.level === "individual" && item.personId === row.personId)),
      team: figure(who.teamId ? counted.filter((item) => item.level === "team" && item.teamId === who.teamId) : []),
      department: figure(who.departmentId ? counted.filter((item) => item.level === "department" && item.departmentId === who.departmentId && ofEntity(item)) : []),
      entity: figure(who.entityId ? counted.filter((item) => item.level === "entity" && item.entityId === who.entityId) : []),
      group: figure(counted.filter((item) => item.level === "group")),
    };
    const okrInput = Object.fromEntries(Object.entries(levels).map(([level, value]) => [level, { progressBp: value.progressBp, goals: value.goals.length } satisfies OkrLevelInput])) as Record<OkrLevel, OkrLevelInput>;

    const isOverridden = who.fullName === OVERRIDE.who;
    const override = isOverridden ? { scoreBp: OVERRIDE.scoreBp, reason: OVERRIDE.reason, byPersonId: owner.id, at: `${YEAR}-12-27T03:00:00Z` } : null;
    const trace = finalResult({ reviewScoreBp: row.reviewScoreBp, kpiScoreBp: kpi.scoreBp, okr: okrInput, override, weightingVersionId: weighting.id }, DEFAULT_PERFORMANCE_WEIGHTING);
    // Nothing at all to score would make a row nobody can lock — leave it out, as HR would.
    if (trace.finalScoreBp === null) continue;

    await db.insert(performanceResult).values({
      personId: row.personId,
      entityId: row.entityId,
      year: YEAR,
      weightingVersionId: weighting.id,
      participantId: row.participantId,
      reviewScoreBp: row.reviewScoreBp,
      kpiScoreBp: kpi.scoreBp,
      okrScoreBp: trace.okr.scoreBp,
      computedScoreBp: trace.computedScoreBp,
      computedBand: trace.computedBand?.key ?? null,
      overrideScoreBp: override?.scoreBp ?? null,
      overrideReason: override?.reason ?? null,
      overrideByPersonId: override ? owner.id : null,
      overrideAt: override ? new Date(override.at) : null,
      finalScoreBp: trace.finalScoreBp,
      finalBand: trace.finalBand?.key ?? null,
      multiplierBp: trace.multiplierBp,
      trace,
      kpiScoreIds: mine.map((score) => score.id),
      goalIds: [...new Set(Object.values(levels).flatMap((value) => value.goals))],
      status: "published",
      lockedAt: new Date(`${YEAR}-12-28T02:00:00Z`),
      lockedByPersonId: hr.id,
      publishedAt: new Date(`${YEAR}-12-29T02:00:00Z`),
      publishedByPersonId: hr.id,
    });
    published++;
    if (isOverridden) overridden++;
    void openMonths;
  }

  return `1 approved weighting version, ${published} published ${YEAR} results (${overridden} with an owner override)`;
}
