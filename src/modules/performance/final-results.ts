// The final performance result per person per year (FR-PRF-09).
//
//   compute  →  (owner override, with a reason)  →  lock  →  publish
//
// · **Compute** takes the released review figure, the stored KPI score and OKR attainment, and
//   combines them through the approved weighting version (`weighting.ts`) with the pure engine.
//   Recomputing a draft is free; recomputing a locked one is refused.
// · **Override** is the owner's alone and needs a reason. It never rewrites the computed figure:
//   both sit on the row, and the trace carries the reason (SRS D13 / FR-PAY-21 — the amount has
//   to be explainable from the KPI and OKR results *and* any override).
// · **Lock** freezes the row. The bonus run reads locked (or published) results only.
// · **Publish** is what makes it the person's to read.
//
// The provenance is stored with the figure: `kpiScoreIds` names the exact stored month scores and
// `goalIds` the goals behind the OKR figure, so a bonus paid in 2028 can still be pointed at the
// months it came from. No authorization inside; `result-actions.ts` checks first.
import "server-only";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { finalResult, type OkrLevelInput, type ResultTrace } from "./engine/result";
import { type OkrLevel, type PerformanceResultStatus, type PerformanceWeightingValue } from "./enums";
import { getOkrResultsOfPeople, type OkrResults } from "./goals";
import { getKpiResultsOfPeople, type KpiResults } from "./kpi-scores";
import { type Directory, loadDirectory } from "./people";
import { listReleasedReviewScores } from "./reviews";
import { getWeightingVersion, getWeightings, type ResolvedWeighting, weightingDateOf } from "./weighting";

type Executor = Tx | ReturnType<typeof db>;
export type PerformanceResultRow = typeof schema.performanceResult.$inferSelect;

/** The OKR figures in the shape the engine wants: a progress figure and how many goals it came from. */
const okrInput = (okr: OkrResults): Record<OkrLevel, OkrLevelInput> => ({
  individual: { progressBp: okr.individual.progressBp, goals: okr.individual.goals.length },
  team: { progressBp: okr.units.team.progressBp, goals: okr.units.team.goals.length },
  department: { progressBp: okr.units.department.progressBp, goals: okr.units.department.goals.length },
  entity: { progressBp: okr.units.entity.progressBp, goals: okr.units.entity.goals.length },
  group: { progressBp: okr.units.group.progressBp, goals: okr.units.group.goals.length },
});

const goalIdsOf = (okr: OkrResults): string[] => [...new Set([okr.individual, okr.units.team, okr.units.department, okr.units.entity, okr.units.group].flatMap((figure) => figure.goals.map((goal) => goal.goalId)))];

export type ComputedResult = {
  personId: string;
  entityId: string | null;
  year: number;
  trace: ResultTrace;
  kpi: KpiResults;
  okr: OkrResults;
  review: { participantId: string; reviewScoreBp: number | null } | null;
  weighting: { id: string; value: PerformanceWeightingValue };
};

/**
 * What one person's year comes to, without storing anything — the preview HR sees before it
 * computes, and the figures `computeResults` then writes.
 */
type ResultOverrideInput = { scoreBp: number; reason: string; byPersonId: string | null; at: string | null } | null;

export async function previewResult(input: { personId: string; entityId: string | null; year: number; override?: ResultOverrideInput }, executor: Executor = db()): Promise<ComputedResult> {
  return (await previewResults([{ personId: input.personId, entityId: input.entityId, override: input.override ?? null }], input.year, executor))[0];
}

/**
 * `previewResult` for many people at once: the weighting versions, the KPI scores, the year's goals
 * and the released reviews are each read once for everybody, not once a person.
 */
async function previewResults(people: readonly { personId: string; entityId: string | null; override: ResultOverrideInput }[], year: number, executor: Executor): Promise<ComputedResult[]> {
  if (people.length === 0) return [];
  const personIds = people.map((person) => person.personId);
  const [weightings, kpis, okrs, released] = await Promise.all([
    getWeightings(
      people.map((person) => person.entityId),
      weightingDateOf(year),
      executor,
    ),
    getKpiResultsOfPeople({ personIds, year }, executor),
    getOkrResultsOfPeople({ personIds, year }, executor),
    listReleasedReviewScores(year, executor),
  ]);
  return people.map((person) => {
    const weighting: ResolvedWeighting = weightings.get(person.entityId)!;
    const kpi = kpis.get(person.personId)!;
    const okr = okrs.get(person.personId)!;
    const review = released.get(person.personId) ?? null;
    const trace = finalResult({ reviewScoreBp: review?.reviewScoreBp ?? null, kpiScoreBp: kpi.scoreBp, okr: okrInput(okr), override: person.override, weightingVersionId: weighting.id }, weighting.value);
    return { personId: person.personId, entityId: person.entityId, year, trace, kpi, okr, review: review ? { participantId: review.participantId, reviewScoreBp: review.reviewScoreBp } : null, weighting: { id: weighting.id, value: weighting.value } };
  });
}

const rowValues = (computed: ComputedResult) => ({
  entityId: computed.entityId,
  weightingVersionId: computed.weighting.id,
  participantId: computed.review?.participantId ?? null,
  reviewScoreBp: computed.review?.reviewScoreBp ?? null,
  kpiScoreBp: computed.kpi.scoreBp,
  okrScoreBp: computed.trace.okr.scoreBp,
  computedScoreBp: computed.trace.computedScoreBp,
  computedBand: computed.trace.computedBand?.key ?? null,
  finalScoreBp: computed.trace.finalScoreBp,
  finalBand: computed.trace.finalBand?.key ?? null,
  multiplierBp: computed.trace.multiplierBp,
  trace: computed.trace,
  kpiScoreIds: computed.kpi.months.map((month) => month.scoreId),
  goalIds: goalIdsOf(computed.okr),
  updatedAt: new Date(),
});

export type ComputeSummary = { computed: number; skipped: { personId: string; reason: "locked" | "published" }[] };

/**
 * Compute (or recompute) the year for a set of people. A locked or published row is left exactly
 * as it is and reported back: a figure somebody has signed off is not quietly replaced.
 */
export async function computeResults(input: { personIds: readonly string[]; year: number }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<ComputeSummary> {
  const directory = await loadDirectory(executor);
  const summary: ComputeSummary = { computed: 0, skipped: [] };
  const personIds = [...new Set(input.personIds)].filter((personId) => directory.has(personId));
  if (personIds.length === 0) return summary;
  const existing = new Map((await executor.select().from(schema.performanceResult).where(and(eq(schema.performanceResult.year, input.year), inArray(schema.performanceResult.personId, personIds)))).map((row) => [row.personId, row]));
  const drafts = personIds.filter((personId) => {
    const row = existing.get(personId);
    if (row && row.status !== "draft") summary.skipped.push({ personId, reason: row.status as "locked" | "published" });
    return !row || row.status === "draft";
  });
  // A draft keeps an override that was already typed in: recomputing refreshes the inputs, not the decision.
  const overrideOf = (row: PerformanceResultRow | undefined): ResultOverrideInput => (row && row.overrideScoreBp !== null ? { scoreBp: row.overrideScoreBp, reason: row.overrideReason ?? "", byPersonId: row.overrideByPersonId, at: row.overrideAt?.toISOString() ?? null } : null);
  const computed = await previewResults(
    drafts.map((personId) => ({ personId, entityId: directory.get(personId)!.entityId ?? null, override: overrideOf(existing.get(personId)) })),
    input.year,
    executor,
  );
  if (computed.length === 0) return summary;
  // One statement for everybody. A row somebody locked in the meantime is left alone by the
  // `where`: the figure they signed off is not quietly replaced.
  const values = computed.map((result) => ({ ...rowValues(result), personId: result.personId, year: input.year, status: "draft" as const }));
  const columns = getTableColumns(schema.performanceResult);
  const replaced = Object.fromEntries(Object.keys(rowValues(computed[0])).map((key) => [key, sql.raw(`excluded."${columns[key as keyof typeof columns].name}"`)]));
  const written = await executor
    .insert(schema.performanceResult)
    .values(values)
    .onConflictDoUpdate({ target: [schema.performanceResult.personId, schema.performanceResult.year], set: replaced, setWhere: eq(schema.performanceResult.status, "draft") })
    .returning({ id: schema.performanceResult.id });
  summary.computed = written.length;
  void actorPersonId;
  return summary;
}


export async function findResult(personId: string, year: number, executor: Executor = db()): Promise<PerformanceResultRow | null> {
  const [row] = await executor.select().from(schema.performanceResult).where(and(eq(schema.performanceResult.personId, personId), eq(schema.performanceResult.year, year))).limit(1);
  return row ?? null;
}

export async function findResultById(resultId: string, executor: Executor = db()): Promise<PerformanceResultRow | null> {
  const [row] = await executor.select().from(schema.performanceResult).where(eq(schema.performanceResult.id, resultId)).limit(1);
  return row ?? null;
}

/**
 * The owner's override: a different figure, with the reason on the record. Only while the result
 * is still a draft — after the lock the year is settled. Passing `null` takes the override back.
 */
export async function overrideResult(resultId: string, input: { scoreBp: number | null; reason: string }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: PerformanceResultRow; after: PerformanceResultRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.performanceResult).where(eq(schema.performanceResult.id, resultId)).limit(1).for("update");
    if (!before) throw new ActionError("result_not_found");
    if (before.status !== "draft") throw new ActionError("result_locked");
    const weighting = await getWeightingVersion(before.weightingVersionId ?? "", tx).catch(() => null);
    if (!weighting) throw new ActionError("weighting_missing");
    const now = new Date();
    const override = input.scoreBp === null ? null : { scoreBp: input.scoreBp, reason: input.reason, byPersonId: actorPersonId, at: now.toISOString() };
    // Recombine from the figures already stored: the override changes the outcome, not the inputs.
    const trace = finalResult(
      {
        reviewScoreBp: before.reviewScoreBp,
        kpiScoreBp: before.kpiScoreBp,
        // The OKR mix is already settled on the stored trace; feed its lines back in unchanged.
        okr: Object.fromEntries(before.trace.okr.lines.map((line) => [line.level, { progressBp: line.progressBp, goals: line.goals }])) as Record<OkrLevel, OkrLevelInput>,
        override,
        weightingVersionId: weighting.id,
      },
      weighting.value,
    );
    const [after] = await tx
      .update(schema.performanceResult)
      .set({
        overrideScoreBp: override?.scoreBp ?? null,
        overrideReason: override?.reason ?? null,
        overrideByPersonId: override ? actorPersonId : null,
        overrideAt: override ? now : null,
        finalScoreBp: trace.finalScoreBp,
        finalBand: trace.finalBand?.key ?? null,
        multiplierBp: trace.multiplierBp,
        trace,
        updatedAt: now,
      })
      .where(eq(schema.performanceResult.id, resultId))
      .returning();
    return { before, after };
  });
}

/** Lock a draft: the figure is settled and the bonus run may read it. */
export async function lockResult(resultId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: PerformanceResultRow; after: PerformanceResultRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.performanceResult).where(eq(schema.performanceResult.id, resultId)).limit(1).for("update");
    if (!before) throw new ActionError("result_not_found");
    if (before.status !== "draft") throw new ActionError("result_locked");
    if (before.finalScoreBp === null) throw new ActionError("result_nothing_scored");
    const [after] = await tx.update(schema.performanceResult).set({ status: "locked" satisfies PerformanceResultStatus, lockedAt: new Date(), lockedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.performanceResult.id, resultId)).returning();
    return { before, after };
  });
}

/** Publishing hands it to the person: they read their own band and the working out behind it. */
export async function publishResult(resultId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: PerformanceResultRow; after: PerformanceResultRow }> {
  const result = await executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.performanceResult).where(eq(schema.performanceResult.id, resultId)).limit(1).for("update");
    if (!before) throw new ActionError("result_not_found");
    if (before.status === "draft") throw new ActionError("result_not_locked");
    if (before.status === "published") throw new ActionError("result_published");
    const [after] = await tx.update(schema.performanceResult).set({ status: "published" satisfies PerformanceResultStatus, publishedAt: new Date(), publishedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.performanceResult.id, resultId)).returning();
    return { before, after };
  });
  await notify({ recipients: [result.after.personId], kind: "performance.result_published", params: { year: result.after.year }, link: `/performance/results?year=${result.after.year}` });
  return result;
}

/** Taking a locked result back to draft: HR's, audited, and only while nothing has been paid from it. */
export async function unlockResult(resultId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: PerformanceResultRow; after: PerformanceResultRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.performanceResult).where(eq(schema.performanceResult.id, resultId)).limit(1).for("update");
    if (!before) throw new ActionError("result_not_found");
    if (before.status === "draft") throw new ActionError("result_not_locked");
    const [use] = await tx.select({ id: schema.kpiScoreUse.id }).from(schema.kpiScoreUse).where(and(eq(schema.kpiScoreUse.personId, before.personId), eq(schema.kpiScoreUse.year, before.year))).limit(1);
    if (use) throw new ActionError("result_consumed");
    const [after] = await tx
      .update(schema.performanceResult)
      .set({ status: "draft" satisfies PerformanceResultStatus, lockedAt: null, lockedByPersonId: null, publishedAt: null, publishedByPersonId: null, updatedAt: new Date() })
      .where(eq(schema.performanceResult.id, resultId))
      .returning();
    return { before, after };
  });
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────

export type ResultLine = {
  id: string;
  personId: string;
  personName: string;
  entityId: string | null;
  departmentId: string | null;
  year: number;
  reviewScoreBp: number | null;
  kpiScoreBp: number | null;
  okrScoreBp: number | null;
  computedScoreBp: number | null;
  computedBand: string | null;
  finalScoreBp: number | null;
  finalBand: string | null;
  multiplierBp: number | null;
  overridden: boolean;
  overrideReason: string | null;
  status: PerformanceResultStatus;
};

const toLine = (row: PerformanceResultRow, directory: Directory): ResultLine => ({
  id: row.id,
  personId: row.personId,
  personName: directory.get(row.personId)?.fullName ?? "—",
  entityId: row.entityId,
  departmentId: directory.get(row.personId)?.departmentId ?? null,
  year: row.year,
  reviewScoreBp: row.reviewScoreBp,
  kpiScoreBp: row.kpiScoreBp,
  okrScoreBp: row.okrScoreBp,
  computedScoreBp: row.computedScoreBp,
  computedBand: row.computedBand,
  finalScoreBp: row.finalScoreBp,
  finalBand: row.finalBand,
  multiplierBp: row.multiplierBp,
  overridden: row.overrideScoreBp !== null,
  overrideReason: row.overrideReason,
  status: row.status as PerformanceResultStatus,
});

/**
 * Every result of a year, optionally narrowed to some entities. **No authorization inside** — the
 * page filters by `canReadPerformanceOf`, and the bonus run (payroll) decides for itself.
 */
export async function listResults(filter: { year: number; entityIds?: readonly string[]; statuses?: readonly PerformanceResultStatus[] }, executor: Executor = db()): Promise<ResultLine[]> {
  return (await listResultDetails(filter, executor)).map(({ line }) => line);
}

/** `listResults` with each stored row alongside its line — the trace, the provenance, the override. */
export async function listResultDetails(filter: { year: number; entityIds?: readonly string[]; statuses?: readonly PerformanceResultStatus[] }, executor: Executor = db()): Promise<{ line: ResultLine; row: PerformanceResultRow }[]> {
  const rowsQuery = executor
    .select()
    .from(schema.performanceResult)
    .where(
      and(
        eq(schema.performanceResult.year, filter.year),
        filter.entityIds ? inArray(schema.performanceResult.entityId, [...filter.entityIds]) : undefined,
        filter.statuses ? inArray(schema.performanceResult.status, [...filter.statuses]) : undefined,
      ),
    )
    .orderBy(desc(schema.performanceResult.finalScoreBp), asc(schema.performanceResult.createdAt));
  const [rows, directory] = await Promise.all([rowsQuery, loadDirectory(executor)]);
  return rows.map((row) => ({ line: toLine(row, directory), row }));
}

/**
 * What the year-end bonus run reads (FR-PAY-21): the settled results of a year, by person.
 * Locked and published only — a draft is still being argued about.
 */
export async function listFinalResults(filter: { year: number; entityIds?: readonly string[] }, executor: Executor = db()): Promise<Map<string, PerformanceResultRow>> {
  const rows = await executor
    .select()
    .from(schema.performanceResult)
    .where(and(eq(schema.performanceResult.year, filter.year), inArray(schema.performanceResult.status, ["locked", "published"]), filter.entityIds ? inArray(schema.performanceResult.entityId, [...filter.entityIds]) : undefined));
  return new Map(rows.map((row) => [row.personId, row]));
}

/** One person's settled result, for the bonus line that explains an amount. */
export async function getFinalResult(personId: string, year: number, executor: Executor = db()): Promise<PerformanceResultRow | null> {
  const row = await findResult(personId, year, executor);
  return row && row.status !== "draft" ? row : null;
}

/** The person's own published result — what they are shown on their review page. */
export async function getPublishedResult(personId: string, year: number, executor: Executor = db()): Promise<PerformanceResultRow | null> {
  const row = await findResult(personId, year, executor);
  return row?.status === "published" ? row : null;
}

/** The years that have any result at all — what the year picker offers. */
export async function resultYears(executor: Executor = db()): Promise<number[]> {
  const rows = await executor.selectDistinct({ year: schema.performanceResult.year }).from(schema.performanceResult).orderBy(desc(schema.performanceResult.year));
  return rows.map((row) => row.year);
}
