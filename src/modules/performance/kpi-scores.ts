// Actuals, the scorecard, and the monthly close that stores the scores (FR-PRF-02). The year-end
// bonus reads these scores (SRS D13): while a month is open the figure is provisional and
// recomputed on every read; closing writes a snapshot with everything it was computed from; a
// reopen (group HR, with a reason) marks the snapshot superseded and the next close writes a new
// revision beside it — a stored score is never rewritten (a database trigger refuses it).
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like, lte, or, gte } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { monthConsumers } from "./consumption";
import { annualKpiScore, type AnnualKpiScore, canonicalInputs, type KpiLineInput, kpiMonthScore, type KpiTrace } from "./engine/kpi-score";
import { coversMonth, isKpiMonth, type KpiDirection, type KpiFrequency, type KpiUnit, monthsOfYear, parseMetricValue, periodDueIn, periodFits, scoringMonthOf } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type KpiActualRow = typeof schema.kpiActual.$inferSelect;
export type KpiPeriodRow = typeof schema.kpiPeriod.$inferSelect;
export type KpiScoreRow = typeof schema.kpiScore.$inferSelect;

export const hashInputs = (month: string, lines: readonly KpiLineInput[], missingAs: KpiTrace["missingAs"]): string => createHash("sha256").update(canonicalInputs(month, lines, missingAs)).digest("hex");

// ── Lines: what is due in a month, with what has been entered ───────────────────────────────

/** Per person: the KPI lines due in `month` (monthly ones; quarterly ones when a quarter ends), each with its actual if any. */
export async function loadMonthLines(filter: { entityId?: string; personIds?: readonly string[] }, month: string, executor: Executor = db()): Promise<Map<string, KpiLineInput[]>> {
  const lines = new Map<string, KpiLineInput[]>();
  if (filter.personIds?.length === 0) return lines;
  for (const { personId, line } of await dueLines({ entityIds: filter.entityId ? [filter.entityId] : undefined, personIds: filter.personIds }, month, executor)) lines.set(personId, [...(lines.get(personId) ?? []), line]);
  return lines;
}

/** `loadMonthLines` for several entities in one read: per entity, per person. */
export async function loadMonthLinesByEntity(entityIds: readonly string[], month: string, executor: Executor = db()): Promise<Map<string, Map<string, KpiLineInput[]>>> {
  const result = new Map<string, Map<string, KpiLineInput[]>>(entityIds.map((entityId) => [entityId, new Map()]));
  if (entityIds.length === 0) return result;
  for (const { entityId, personId, line } of await dueLines({ entityIds }, month, executor)) {
    const lines = result.get(entityId)!;
    lines.set(personId, [...(lines.get(personId) ?? []), line]);
  }
  return result;
}

async function dueLines(filter: { entityIds?: readonly string[]; personIds?: readonly string[] }, month: string, executor: Executor): Promise<{ entityId: string; personId: string; line: KpiLineInput }[]> {
  const assignments = await executor
    .select({ assignment: schema.kpiAssignment, kpi: schema.kpiDefinition })
    .from(schema.kpiAssignment)
    .innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.kpiAssignment.kpiId))
    .where(
      and(
        filter.entityIds ? inArray(schema.kpiAssignment.entityId, [...filter.entityIds]) : undefined,
        filter.personIds ? inArray(schema.kpiAssignment.personId, [...filter.personIds]) : undefined,
        lte(schema.kpiAssignment.fromPeriod, month),
        or(isNull(schema.kpiAssignment.toPeriod), gte(schema.kpiAssignment.toPeriod, month)),
      ),
    );
  const due = assignments.flatMap(({ assignment, kpi }) => {
    const periodKey = periodDueIn(kpi.frequency as KpiFrequency, month);
    return periodKey ? [{ assignment, kpi, periodKey }] : [];
  });
  if (due.length === 0) return [];
  const actuals = await executor.select().from(schema.kpiActual).where(inArray(schema.kpiActual.assignmentId, due.map((item) => item.assignment.id)));
  const actualOf = new Map(actuals.map((actual) => [`${actual.assignmentId}:${actual.periodKey}`, actual]));
  return due.map(({ assignment, kpi, periodKey }) => {
    // A figure the work job proposed (FR-PJM-62) is not an actual until the scorer confirms it:
    // it reads as missing here, so no scorecard, dashboard or close can ever score it.
    const entered = actualOf.get(`${assignment.id}:${periodKey}`);
    const actual = entered && entered.status !== "confirmed" ? undefined : entered;
    const line: KpiLineInput = { assignmentId: assignment.id, kpiCode: kpi.code, kpiName: kpi.name, unit: kpi.unit as KpiUnit, direction: kpi.direction as KpiDirection, frequency: kpi.frequency as KpiFrequency, periodKey, weight: assignment.weight, targetValue: assignment.targetValue, capBp: kpi.capBp, floorBp: kpi.floorBp, actualValue: actual?.actualValue ?? null, notApplicable: actual?.notApplicable ?? false, note: actual?.note ?? null };
    return { entityId: assignment.entityId, personId: assignment.personId, line };
  });
}

export const isMissing = (line: Pick<KpiLineInput, "actualValue" | "notApplicable">): boolean => line.actualValue === null && !line.notApplicable;

// ── Periods ─────────────────────────────────────────────────────────────────────────────────

export async function isKpiMonthClosed(entityId: string, month: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor.select({ status: schema.kpiPeriod.status }).from(schema.kpiPeriod).where(and(eq(schema.kpiPeriod.entityId, entityId), eq(schema.kpiPeriod.month, month))).limit(1);
  return row?.status === "closed";
}

export async function listPeriods(filter: { year?: number; month?: string; entityIds?: readonly string[] }, executor: Executor = db()): Promise<KpiPeriodRow[]> {
  if (filter.entityIds?.length === 0) return [];
  return executor
    .select()
    .from(schema.kpiPeriod)
    .where(and(filter.year ? like(schema.kpiPeriod.month, `${filter.year}-%`) : undefined, filter.month ? eq(schema.kpiPeriod.month, filter.month) : undefined, filter.entityIds ? inArray(schema.kpiPeriod.entityId, [...filter.entityIds]) : undefined))
    .orderBy(asc(schema.kpiPeriod.month));
}

// ── Actuals ─────────────────────────────────────────────────────────────────────────────────

export type ActualEntry = { assignmentId: string; periodKey: string; /** As typed: "95", "4,5"; blank = nothing entered. */ actual: string | null; notApplicable: boolean; note: string | null };
type ActualFacts = { assignmentId: string; personId: string; kpiCode: string; periodKey: string; actualValue: number | null; notApplicable: boolean; note: string | null };
export type SavedActuals = { saved: number; cleared: number; unchanged: number; personIds: string[]; entityIds: string[]; before: ActualFacts[]; after: ActualFacts[] };

/** Who the entries are about — for the action to authorize before anything is written. Unknown ids: null. */
export async function peopleOfEntries(assignmentIds: readonly string[], executor: Executor = db()): Promise<string[] | null> {
  const ids = [...new Set(assignmentIds)];
  if (ids.length === 0) return [];
  const rows = await executor.select({ id: schema.kpiAssignment.id, personId: schema.kpiAssignment.personId }).from(schema.kpiAssignment).where(inArray(schema.kpiAssignment.id, ids));
  return rows.length === ids.length ? [...new Set(rows.map((row) => row.personId))] : null;
}

/**
 * Enter, change or clear actuals. All or nothing. Refused for a month that is closed: the score
 * there is stored, and only a reopen (audited, new revision) can lead to a different one.
 */
export async function saveActuals(actorPersonId: string, entries: readonly ActualEntry[], source: "manual" | "import", outer?: Tx): Promise<SavedActuals> {
  const run = async (tx: Executor): Promise<SavedActuals> => {
    const result: SavedActuals = { saved: 0, cleared: 0, unchanged: 0, personIds: [], entityIds: [], before: [], after: [] };
    const seen = new Set<string>();
    const closed = new Map<string, boolean>();
    for (const entry of entries) {
      const [found] = await tx.select({ assignment: schema.kpiAssignment, kpi: schema.kpiDefinition }).from(schema.kpiAssignment).innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.kpiAssignment.kpiId)).where(eq(schema.kpiAssignment.id, entry.assignmentId)).limit(1);
      if (!found) throw new ActionError("kpi_not_found");
      const { assignment, kpi } = found;
      const key = `${assignment.id}:${entry.periodKey}`;
      if (seen.has(key)) throw new ActionError("kpi_duplicate_entry");
      seen.add(key);
      if (!periodFits(kpi.frequency as KpiFrequency, entry.periodKey)) throw new ActionError("kpi_wrong_period_kind");
      const month = scoringMonthOf(entry.periodKey);
      if (!coversMonth(assignment, month)) throw new ActionError("kpi_not_assigned_then");
      const periodKey = `${assignment.entityId}:${month}`;
      if (!closed.has(periodKey)) {
        // The close takes the same lock: an actual cannot slip in while the scores are being stored.
        await tx.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, assignment.entityId)).for("update");
        closed.set(periodKey, await isKpiMonthClosed(assignment.entityId, month, tx));
      }
      if (closed.get(periodKey)) throw new ActionError("kpi_month_closed", { month });

      const note = entry.note?.trim() ? entry.note.trim() : null;
      const typed = entry.actual?.trim() ? entry.actual.trim() : null;
      const actualValue = entry.notApplicable || typed === null ? null : parseMetricValue(kpi.unit as KpiUnit, typed);
      if (!entry.notApplicable && typed !== null && actualValue === null) throw new ActionError("kpi_bad_value", { kpiCode: kpi.code });
      if (actualValue !== null && actualValue < 0) throw new ActionError("kpi_bad_value", { kpiCode: kpi.code });
      if (entry.notApplicable && !note) throw new ActionError("kpi_not_applicable_needs_note", { kpiCode: kpi.code });

      const [before] = await tx.select().from(schema.kpiActual).where(and(eq(schema.kpiActual.assignmentId, assignment.id), eq(schema.kpiActual.periodKey, entry.periodKey))).limit(1);
      const facts = (row: { actualValue: number | null; notApplicable: boolean; note: string | null }): ActualFacts => ({ assignmentId: assignment.id, personId: assignment.personId, kpiCode: kpi.code, periodKey: entry.periodKey, actualValue: row.actualValue, notApplicable: row.notApplicable, note: row.note });
      const nothing = actualValue === null && !entry.notApplicable;
      // An empty line over a dismissed proposal is the same empty line: keep the dismissal.
      if (nothing && (!before || before.status === "dismissed")) {
        result.unchanged++;
        continue;
      }
      // A proposed figure saved as it stands is a confirmation, not "unchanged" (FR-PJM-62).
      const proposed = before?.status === "proposed";
      if (before && !proposed && !nothing && before.actualValue === actualValue && before.notApplicable === entry.notApplicable && before.note === note) {
        result.unchanged++;
        continue;
      }
      if (!result.personIds.includes(assignment.personId)) result.personIds.push(assignment.personId);
      if (!result.entityIds.includes(assignment.entityId)) result.entityIds.push(assignment.entityId);
      if (before) result.before.push(facts(before));
      if (nothing) {
        if (proposed) {
          // Turning a proposal down: the row stays, dismissed, so the work job does not propose the
          // same figure again tomorrow. It still reads as missing, like any empty line.
          await tx.update(schema.kpiActual).set({ status: "dismissed", actualValue: null, enteredByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.kpiActual.id, before!.id));
          result.cleared++;
          continue;
        }
        // Taking a figure back while the month is open; the audit entry keeps what it was.
        await tx.delete(schema.kpiActual).where(eq(schema.kpiActual.id, before!.id));
        result.cleared++;
        continue;
      }
      // Confirming a proposal as proposed keeps its source (`work`); any other figure is the scorer's own.
      const confirmsProposal = proposed && !entry.notApplicable && actualValue === before!.proposedValue;
      const values = { actualValue, notApplicable: entry.notApplicable, note, source: confirmsProposal ? "work" : source, status: "confirmed", enteredByPersonId: actorPersonId, updatedAt: new Date() };
      if (before) await tx.update(schema.kpiActual).set(values).where(eq(schema.kpiActual.id, before.id));
      else await tx.insert(schema.kpiActual).values({ assignmentId: assignment.id, personId: assignment.personId, kpiId: assignment.kpiId, periodKey: entry.periodKey, ...values });
      result.after.push(facts(values));
      result.saved++;
    }
    return result;
  };
  // Inside an import the caller already holds the transaction.
  return outer ? run(outer) : db().transaction((tx) => run(tx as Tx));
}

// ── Scorecard ───────────────────────────────────────────────────────────────────────────────

export type Scorecard = {
  month: string;
  entityId: string | null;
  /** "closed": the stored score; "open": provisional, recomputed from what is entered now. */
  state: "closed" | "open";
  trace: KpiTrace;
  missing: number;
  stored: { scoreId: string; revision: number; computedAt: Date; inputsHash: string } | null;
  /** Earlier revisions the month had before a reopen — kept, never shown as the score. */
  superseded: { revision: number; scoreBp: number | null; computedAt: Date; supersededAt: Date }[];
};

export async function getScorecard(personId: string, month: string, executor: Executor = db()): Promise<Scorecard> {
  const scores = await executor.select().from(schema.kpiScore).where(and(eq(schema.kpiScore.personId, personId), eq(schema.kpiScore.month, month))).orderBy(desc(schema.kpiScore.revision));
  const current = scores.find((score) => score.supersededAt === null) ?? null;
  const superseded = scores.filter((score) => score.supersededAt !== null).map((score) => ({ revision: score.revision, scoreBp: score.scoreBp, computedAt: score.computedAt, supersededAt: score.supersededAt! }));
  if (current) return { month, entityId: current.entityId, state: "closed", trace: current.trace, missing: current.trace.lines.filter((line) => line.flags.includes("missing")).length, stored: { scoreId: current.id, revision: current.revision, computedAt: current.computedAt, inputsHash: current.inputsHash }, superseded };
  const lines = (await loadMonthLines({ personIds: [personId] }, month, executor)).get(personId) ?? [];
  const [person] = await executor.select({ entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return { month, entityId: person?.entityId ?? null, state: "open", trace: kpiMonthScore(month, lines, { missingAs: "excluded" }), missing: lines.filter(isMissing).length, stored: null, superseded };
}

// ── Close and reopen ────────────────────────────────────────────────────────────────────────

export type CloseBlocker = { personId: string; personName: string; kpiCode: string; kpiName: string; periodKey: string };
export type CloseResult = { period: KpiPeriodRow; people: number; scored: number; averageBp: number | null; exceptions: CloseBlocker[] };

export async function closeBlockers(entityId: string, month: string, executor: Executor = db()): Promise<CloseBlocker[]> {
  return (await closeBlockersOf([entityId], month, executor)).get(entityId) ?? [];
}

/** `closeBlockers` for several entities in one read. */
export async function closeBlockersOf(entityIds: readonly string[], month: string, executor: Executor = db()): Promise<Map<string, CloseBlocker[]>> {
  const byEntity = await loadMonthLinesByEntity(entityIds, month, executor);
  const missing = [...byEntity.entries()].flatMap(([entityId, lines]) => [...lines.entries()].flatMap(([personId, items]) => items.filter(isMissing).map((line) => ({ entityId, personId, line }))));
  const result = new Map<string, CloseBlocker[]>(entityIds.map((entityId) => [entityId, []]));
  if (missing.length === 0) return result;
  const names = await executor.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, [...new Set(missing.map((item) => item.personId))]));
  const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
  for (const { entityId, personId, line } of missing) result.get(entityId)!.push({ personId, personName: nameOf.get(personId) ?? "", kpiCode: line.kpiCode, kpiName: line.kpiName, periodKey: line.periodKey });
  for (const blockers of result.values()) blockers.sort((a, b) => a.personName.localeCompare(b.personName) || a.kpiCode.localeCompare(b.kpiCode));
  return result;
}

/**
 * Close one entity's month: compute and store every person's score. Refused with the list of
 * missing actuals unless HR overrides with a reason — the missing lines then score zero and are
 * flagged in the trace and on the period.
 */
export async function closeMonth(actorPersonId: string, input: { entityId: string; month: string; overrideReason: string | null }, today: string, executor: ReturnType<typeof db> = db()): Promise<CloseResult> {
  if (!isKpiMonth(input.month)) throw new ActionError("kpi_bad_period");
  // A month is closed once it is over: until then actuals are still being made.
  if (input.month >= today.slice(0, 7)) throw new ActionError("kpi_month_not_over");
  return executor.transaction(async (tx) => {
    const [entity] = await tx.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1).for("update");
    if (!entity) throw new ActionError("kpi_not_found");
    const [existing] = await tx.select().from(schema.kpiPeriod).where(and(eq(schema.kpiPeriod.entityId, input.entityId), eq(schema.kpiPeriod.month, input.month))).limit(1);
    if (existing?.status === "closed") throw new ActionError("kpi_month_already_closed");

    const lines = await loadMonthLines({ entityId: input.entityId }, input.month, tx);
    if (lines.size === 0) throw new ActionError("kpi_nothing_to_close");
    const blockers = await closeBlockers(input.entityId, input.month, tx);
    const reason = input.overrideReason?.trim() ? input.overrideReason.trim() : null;
    if (blockers.length > 0 && !reason) throw new ActionError("kpi_month_blocked", { blockers });

    const revisions = await tx.select({ personId: schema.kpiScore.personId, revision: schema.kpiScore.revision, supersededAt: schema.kpiScore.supersededAt }).from(schema.kpiScore).where(and(eq(schema.kpiScore.month, input.month), inArray(schema.kpiScore.personId, [...lines.keys()])));
    if (revisions.some((row) => row.supersededAt === null)) throw new ActionError("kpi_month_already_closed");
    const scores: (number | null)[] = [];
    for (const [personId, items] of lines) {
      const trace = kpiMonthScore(input.month, items, { missingAs: "zero" });
      const revision = Math.max(0, ...revisions.filter((row) => row.personId === personId).map((row) => row.revision)) + 1;
      await tx.insert(schema.kpiScore).values({ personId, entityId: input.entityId, month: input.month, revision, scoreBp: trace.scoreBp, trace, inputsHash: hashInputs(input.month, items, "zero") });
      scores.push(trace.scoreBp);
    }
    const values = { status: "closed", closedByPersonId: actorPersonId, closedAt: new Date(), overrideReason: blockers.length > 0 ? reason : null, exceptions: blockers.length > 0 ? blockers.map(({ personId, kpiCode, periodKey }) => ({ personId, kpiCode, periodKey })) : null, updatedAt: new Date() };
    const [period] = existing ? await tx.update(schema.kpiPeriod).set(values).where(eq(schema.kpiPeriod.id, existing.id)).returning() : await tx.insert(schema.kpiPeriod).values({ entityId: input.entityId, month: input.month, ...values }).returning();
    const counted = scores.filter((score): score is number => score !== null);
    return { period, people: lines.size, scored: counted.length, averageBp: counted.length === 0 ? null : Math.round(counted.reduce((sum, score) => sum + score, 0) / counted.length), exceptions: blockers };
  });
}

/**
 * Take a closed month back. The stored scores stay, marked superseded; the next close writes the
 * next revision.
 *
 * **Refused once a year-end bonus run has been approved off the month** (Phase 8, FR-PAY-21):
 * money has been decided on those figures, so they are evidence. A correction belongs in the next
 * year's scores, not in a rewrite of the year that was paid. The lock is taken before the check so
 * a run cannot be approved in the gap between asking and superseding.
 */
export async function reopenMonth(actorPersonId: string, input: { entityId: string; month: string; reason: string }, executor: ReturnType<typeof db> = db()): Promise<{ before: KpiPeriodRow; after: KpiPeriodRow; superseded: number }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kpiPeriod).where(and(eq(schema.kpiPeriod.entityId, input.entityId), eq(schema.kpiPeriod.month, input.month))).limit(1).for("update");
    if (!before || before.status !== "closed") throw new ActionError("kpi_month_not_closed");
    const consumers = await monthConsumers(input.entityId, input.month, tx);
    if (consumers.length > 0) throw new ActionError("kpi_month_consumed", { consumerType: consumers[0].consumerType, consumerIds: [...new Set(consumers.map((row) => row.consumerId))] });
    const superseded = await tx.update(schema.kpiScore).set({ supersededAt: new Date() }).where(and(eq(schema.kpiScore.entityId, input.entityId), eq(schema.kpiScore.month, input.month), isNull(schema.kpiScore.supersededAt))).returning({ id: schema.kpiScore.id });
    const [after] = await tx.update(schema.kpiPeriod).set({ status: "open", reopenedByPersonId: actorPersonId, reopenedAt: new Date(), reopenReason: input.reason, updatedAt: new Date() }).where(eq(schema.kpiPeriod.id, before.id)).returning();
    return { before, after, superseded: superseded.length };
  });
}

// ── For Phase 8 ─────────────────────────────────────────────────────────────────────────────

export type KpiMonthResult = { month: string; scoreBp: number | null; revision: number; scoreId: string; closedAt: Date };
export type KpiResults = {
  /** Σ weight × months × attainment / Σ weight × months over the closed months' stored lines. */
  scoreBp: number | null;
  closedMonths: string[];
  /** Months of the year in which the person has KPIs due and no stored score yet. */
  openMonths: string[];
  months: KpiMonthResult[];
  /** Every month with something due is closed: the figure cannot move any more (short of an audited reopen). */
  final: boolean;
  byKpi: AnnualKpiScore["byKpi"];
};

/**
 * "Final KPI score for person X in year Y" — from the current (not superseded) stored scores
 * only; open months never enter the figure. No authorization here: the caller decides who sees it.
 */
export async function getKpiResults(input: { personId: string; year: number }, executor: Executor = db()): Promise<KpiResults> {
  const scores = await executor.select().from(schema.kpiScore).where(and(eq(schema.kpiScore.personId, input.personId), like(schema.kpiScore.month, `${input.year}-%`), isNull(schema.kpiScore.supersededAt))).orderBy(asc(schema.kpiScore.month));
  const closedMonths = scores.map((score) => score.month);
  const assignments = await executor.select({ assignment: schema.kpiAssignment, frequency: schema.kpiDefinition.frequency }).from(schema.kpiAssignment).innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.kpiAssignment.kpiId)).where(eq(schema.kpiAssignment.personId, input.personId));
  const openMonths = monthsOfYear(input.year).filter((month) => !closedMonths.includes(month) && assignments.some(({ assignment, frequency }) => coversMonth(assignment, month) && periodDueIn(frequency as KpiFrequency, month) !== null));
  const year = annualKpiScore(scores.map((score) => score.trace));
  return { scoreBp: year.scoreBp, closedMonths, openMonths, months: scores.map((score) => ({ month: score.month, scoreBp: score.scoreBp, revision: score.revision, scoreId: score.id, closedAt: score.computedAt })), final: closedMonths.length > 0 && openMonths.length === 0, byKpi: year.byKpi };
}

/** The current stored scores of many people for one month — dashboards. */
export async function listStoredScores(filter: { month?: string; year?: number; personIds?: readonly string[]; entityIds?: readonly string[] }, executor: Executor = db()): Promise<Pick<KpiScoreRow, "id" | "personId" | "entityId" | "month" | "scoreBp" | "revision">[]> {
  if (filter.personIds?.length === 0 || filter.entityIds?.length === 0) return [];
  return executor
    .select({ id: schema.kpiScore.id, personId: schema.kpiScore.personId, entityId: schema.kpiScore.entityId, month: schema.kpiScore.month, scoreBp: schema.kpiScore.scoreBp, revision: schema.kpiScore.revision })
    .from(schema.kpiScore)
    .where(and(isNull(schema.kpiScore.supersededAt), filter.month ? eq(schema.kpiScore.month, filter.month) : undefined, filter.year ? like(schema.kpiScore.month, `${filter.year}-%`) : undefined, filter.personIds ? inArray(schema.kpiScore.personId, [...filter.personIds]) : undefined, filter.entityIds ? inArray(schema.kpiScore.entityId, [...filter.entityIds]) : undefined));
}
