// What a stored KPI score has already been paid from (`kpi_score_use`).
//
// Phase 3.5 stores a month's scores immutably and lets group HR reopen the month: the snapshot is
// superseded and the next close writes revision n + 1. Phase 8 adds the one case where that must
// not happen — **a month a year-end bonus run has already been approved from**. The money is out
// (or about to be), and the figure behind it is evidence; correcting it is a matter for the next
// year, not a rewrite of the one that was paid.
//
// The consumer lives in another module (payroll's bonus run, FR-PAY-21), so it calls
// `markScoresConsumed` through `performance/service.ts` when its run is approved. Keeping the
// table here means `reopenMonth` can refuse without performance ever importing payroll — the
// dependency runs one way only.
//
// No authorization inside: the bonus use-case has already checked who may approve a run.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;
export type KpiScoreUseRow = typeof schema.kpiScoreUse.$inferSelect;

export type ScoreUse = { scoreId: string; personId: string; entityId: string; month: string };

/**
 * Record that `consumerId` has been approved off these stored scores. Idempotent: a second
 * approval of the same run adds nothing (unique on consumer + score).
 */
export async function markScoresConsumed(input: { consumerType: string; consumerId: string; year: number; uses: readonly ScoreUse[] }, executor: Executor = db()): Promise<number> {
  if (input.uses.length === 0) return 0;
  const rows = await executor
    .insert(schema.kpiScoreUse)
    .values(input.uses.map((use) => ({ consumerType: input.consumerType, consumerId: input.consumerId, year: input.year, scoreId: use.scoreId, personId: use.personId, entityId: use.entityId, month: use.month })))
    .onConflictDoNothing()
    .returning({ id: schema.kpiScoreUse.id });
  return rows.length;
}

/** Undo the record — for a bonus run that was cancelled before anything was paid. */
export async function releaseConsumedScores(consumerId: string, executor: Executor = db()): Promise<number> {
  const rows = await executor.delete(schema.kpiScoreUse).where(eq(schema.kpiScoreUse.consumerId, consumerId)).returning({ id: schema.kpiScoreUse.id });
  return rows.length;
}

/** Has anything been paid from this entity's month? What `reopenMonth` asks before it supersedes. */
export async function monthConsumers(entityId: string, month: string, executor: Executor = db()): Promise<KpiScoreUseRow[]> {
  return executor.select().from(schema.kpiScoreUse).where(and(eq(schema.kpiScoreUse.entityId, entityId), eq(schema.kpiScoreUse.month, month)));
}

export const isMonthConsumed = async (entityId: string, month: string, executor: Executor = db()): Promise<boolean> => (await monthConsumers(entityId, month, executor)).length > 0;

/** The whole year, for the bonus screens: "2026 has already been paid for SZM". */
export async function isYearConsumed(entityId: string, year: number, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor.select({ id: schema.kpiScoreUse.id }).from(schema.kpiScoreUse).where(and(eq(schema.kpiScoreUse.entityId, entityId), eq(schema.kpiScoreUse.year, year))).limit(1);
  return !!row;
}

/** Which of these entities' months are frozen — for the periods screen, in one query. */
export async function consumedMonths(entityIds: readonly string[], executor: Executor = db()): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const rows = await executor.selectDistinct({ entityId: schema.kpiScoreUse.entityId, month: schema.kpiScoreUse.month }).from(schema.kpiScoreUse).where(inArray(schema.kpiScoreUse.entityId, [...entityIds]));
  return new Set(rows.map((row) => `${row.entityId}:${row.month}`));
}
