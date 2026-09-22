// The year-end bonus run (FR-PAY-21, SRS D13).
//
//   draft → simulated → proposed → approved → paid
//            HR builds   HR puts   the CEO    one off-cycle payroll run per entity
//            and costs   it up     signs      (FR-PAY-19), which does the tax
//            the whole   ↑ the owner adjusts individual amounts, each with a reason
//            group
//
// Three things this file is careful about:
//
//  1. **Traceability is the point.** Every line stores the whole `BonusTrace` — the base salary,
//     the service band, the performance band and where it came from, the unit's OKR band, the
//     cap, the rounding and any owner override — together with the `performance_result` id and
//     the stored KPI month score ids behind it. A person's amount can be explained back to their
//     KPI and OKR results without anything else being kept anywhere.
//  2. **Nothing is committed until the CEO signs.** Simulating rebuilds the lines from scratch as
//     often as HR likes; approval is where `markScoresConsumed` freezes the KPI months the
//     figures came from, so performance's `reopenMonth` refuses them afterwards.
//  3. **Payroll does the pay.** The run works out an amount and hands it to `createOffCycleRun`
//     as a line under the scheme's pay component. Tax, insurance, payslips and the bank file are
//     the payroll run's, exactly as for any other money.
//
// No authorization inside: `bonus-actions.ts` checks `canManageCompensation`, `canDecidePayRules`
// and `canApprovePayroll` over the entities first, and every action asks for a step-up.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { listEntities } from "@/modules/platform/org/service";
import { getKpiResults, getOkrResults, listFinalResults, markScoresConsumed, type PerformanceResultRow, releaseConsumedScores, type ScoreUse } from "@/modules/performance/service";
import { getBonusScheme, getBonusSchemeVersion, type ResolvedBonusScheme, schemeDateOf } from "./bonus-schemes";
import { type BonusOkrLevel, type BonusRunStatus, type BonusSchemeValue, bonusSchemeSchema } from "./enums";
import { bonusForPerson, type BonusOverride, type BonusPersonInput, type BonusResultInput, type BonusTotals, type BonusTrace, EMPTY_BONUS_TOTALS, sumBonus } from "./engine/bonus";
import { bonusLineContext, bonusRunTotalsContext } from "./field-contexts";
import { monthsOfService } from "./calculation";
import { createOffCycleRun } from "./runs";
import { listBaseSalariesOn } from "./salaries";

type Executor = Tx | ReturnType<typeof db>;
export type BonusRunRow = typeof schema.bonusRun.$inferSelect;
export type BonusRunLineRow = typeof schema.bonusRunLine.$inferSelect;
export type BonusRunEventRow = typeof schema.bonusRunEvent.$inferSelect;

const openTrace = (row: Pick<BonusRunLineRow, "id" | "traceEnc">): BonusTrace => JSON.parse(fieldCipher().decrypt(row.traceEnc, bonusLineContext(row.id))) as BonusTrace;
const openTotals = (run: BonusRunRow): BonusTotals => (run.totalsEnc ? (JSON.parse(fieldCipher().decrypt(run.totalsEnc, bonusRunTotalsContext(run.id))) as BonusTotals) : EMPTY_BONUS_TOTALS);

export { openTotals };

// ── The lifecycle ───────────────────────────────────────────────────────────────────────────

export type BonusStep = "simulate" | "propose" | "approve" | "return" | "pay" | "cancel";

type StepRule = { from: readonly BonusRunStatus[]; to: BonusRunStatus; commentRequired?: boolean };

/**
 * Who may take which step is `policy.ts`'s business; this table is only what may follow what.
 * `return` is the way back: the CEO sends the run to HR with a reason, and it can be rebuilt.
 */
export const BONUS_STEPS: Record<BonusStep, StepRule> = {
  simulate: { from: ["draft", "simulated"], to: "simulated" },
  propose: { from: ["simulated"], to: "proposed" },
  approve: { from: ["proposed"], to: "approved" },
  return: { from: ["proposed", "approved"], to: "simulated", commentRequired: true },
  pay: { from: ["approved"], to: "paid" },
  cancel: { from: ["draft", "simulated", "proposed", "approved"], to: "cancelled" },
};

/** Until it is proposed, a run may still be rebuilt and its amounts changed. */
export const isOpenForEditing = (run: Pick<BonusRunRow, "status">): boolean => run.status === "draft" || run.status === "simulated";
/** After the CEO signs, only the owner's adjustments are gone: the figures are the ones that pay. */
export const isSettled = (run: Pick<BonusRunRow, "status">): boolean => run.status === "approved" || run.status === "paid";

export const availableBonusSteps = (run: Pick<BonusRunRow, "status" | "headcount">): BonusStep[] =>
  (Object.keys(BONUS_STEPS) as BonusStep[]).filter((step) => BONUS_STEPS[step].from.includes(run.status) && !(step === "propose" && run.headcount === 0));

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export async function getBonusRun(runId: string, executor: Executor = db()): Promise<BonusRunRow | null> {
  const [row] = await executor.select().from(schema.bonusRun).where(eq(schema.bonusRun.id, runId)).limit(1);
  return row ?? null;
}

export async function listBonusRuns(executor: Executor = db()): Promise<BonusRunRow[]> {
  return executor.select().from(schema.bonusRun).orderBy(desc(schema.bonusRun.year), desc(schema.bonusRun.createdAt));
}

export async function listBonusRunEvents(runId: string, executor: Executor = db()): Promise<BonusRunEventRow[]> {
  return executor.select().from(schema.bonusRunEvent).where(eq(schema.bonusRunEvent.runId, runId)).orderBy(asc(schema.bonusRunEvent.createdAt));
}

/** One line with its trace opened — the per-person explanation page's whole input. */
export type BonusLineView = { row: BonusRunLineRow; trace: BonusTrace; personName: string };

export async function listBonusLines(runId: string, filter: { entityId?: string } = {}, executor: Executor = db()): Promise<BonusLineView[]> {
  const rows = await executor
    .select({ line: schema.bonusRunLine, personName: schema.person.fullName })
    .from(schema.bonusRunLine)
    .innerJoin(schema.person, eq(schema.person.id, schema.bonusRunLine.personId))
    .where(and(eq(schema.bonusRunLine.runId, runId), filter.entityId ? eq(schema.bonusRunLine.entityId, filter.entityId) : undefined))
    .orderBy(asc(schema.person.searchName));
  return rows.map((row) => ({ row: row.line, trace: openTrace(row.line), personName: row.personName }));
}

export async function getBonusLine(runId: string, personId: string, executor: Executor = db()): Promise<BonusLineView | null> {
  const [row] = await executor
    .select({ line: schema.bonusRunLine, personName: schema.person.fullName })
    .from(schema.bonusRunLine)
    .innerJoin(schema.person, eq(schema.person.id, schema.bonusRunLine.personId))
    .where(and(eq(schema.bonusRunLine.runId, runId), eq(schema.bonusRunLine.personId, personId)))
    .limit(1);
  return row ? { row: row.line, trace: openTrace(row.line), personName: row.personName } : null;
}

/** The person's own line, for "what was my 13th month and why". */
export async function listMyBonusLines(personId: string, executor: Executor = db()): Promise<{ run: BonusRunRow; line: BonusRunLineRow; trace: BonusTrace }[]> {
  const rows = await executor
    .select({ run: schema.bonusRun, line: schema.bonusRunLine })
    .from(schema.bonusRunLine)
    .innerJoin(schema.bonusRun, eq(schema.bonusRun.id, schema.bonusRunLine.runId))
    .where(and(eq(schema.bonusRunLine.personId, personId), inArray(schema.bonusRun.status, ["approved", "paid"])))
    .orderBy(desc(schema.bonusRun.year));
  return rows.map((row) => ({ run: row.run, line: row.line, trace: openTrace(row.line) }));
}

/** The cost, per entity and for the group. Money, so the caller has checked who may see it. */
export type BonusCost = { totals: BonusTotals; byEntity: { entityId: string; entityName: string; totals: BonusTotals }[] };

export async function getBonusCost(runId: string, executor: Executor = db()): Promise<BonusCost> {
  return bonusCostOf(await listBonusLines(runId, {}, executor));
}

/** The same from lines already read — the run screen lists them anyway. Entity names come from the shared cache. */
export async function bonusCostOf(lines: readonly BonusLineView[]): Promise<BonusCost> {
  const nameOf = new Map((await listEntities()).map((row) => [row.id, row.shortName]));
  return { totals: sumBonus(lines.map((line) => line.trace)), byEntity: costByEntity(lines.map((line) => ({ entityId: line.row.entityId, trace: line.trace })), nameOf) };
}

/** Per entity, in id order, each with its lines added up — one pass over the lines. */
function costByEntity(lines: readonly { entityId: string; trace: BonusTrace }[], nameOf: ReadonlyMap<string, string>): BonusCost["byEntity"] {
  const traces = new Map<string, BonusTrace[]>();
  for (const line of lines) traces.set(line.entityId, [...(traces.get(line.entityId) ?? []), line.trace]);
  return [...traces.keys()].sort().map((entityId) => ({ entityId, entityName: nameOf.get(entityId) ?? "—", totals: sumBonus(traces.get(entityId)!) }));
}

// ── Building and simulating ─────────────────────────────────────────────────────────────────

export async function createBonusRun(input: { year: number; name: string; entityIds: readonly string[]; payrollMonth: string; note?: string | null }, actorPersonId: string, executor: Executor = db()): Promise<BonusRunRow> {
  if (input.entityIds.length === 0) throw new ActionError("bonus_run_no_entities");
  // Refuse before anything exists if the configuration the run would read is not there.
  for (const entityId of input.entityIds) await getBonusScheme(entityId, schemeDateOf(input.year), executor);
  const [created] = await executor
    .insert(schema.bonusRun)
    .values({ year: input.year, name: input.name, entityIds: [...input.entityIds], payrollMonth: input.payrollMonth, note: input.note ?? null, createdByPersonId: actorPersonId })
    .returning()
    .catch((error: unknown) => {
      // The partial unique index: one live run per year.
      if (String(error).includes("bonus_run_year_key")) throw new ActionError("bonus_run_exists");
      throw error;
    });
  return created;
}

/** Which OKR figure the scheme's collective level asks for, out of what performance published. */
function unitProgressOf(okr: Awaited<ReturnType<typeof getOkrResults>>, level: BonusOkrLevel): number | null {
  switch (level) {
    case "team":
      return okr.units.team.goals.length > 0 ? okr.units.team.progressBp : null;
    case "department":
      return okr.units.department.goals.length > 0 ? okr.units.department.progressBp : null;
    case "entity":
      return okr.units.entity.goals.length > 0 ? okr.units.entity.progressBp : null;
    case "group":
      return okr.units.group.goals.length > 0 ? okr.units.group.progressBp : null;
    default:
      return null;
  }
}

const resultInput = (row: PerformanceResultRow): BonusResultInput => ({
  resultId: row.id,
  finalScoreBp: row.finalScoreBp,
  bandKey: row.finalBand,
  bandMultiplierBp: row.multiplierBp,
  bandLabel: row.trace.finalBand?.label ?? row.finalBand,
  reviewScoreBp: row.reviewScoreBp,
  kpiScoreBp: row.kpiScoreBp,
  okrScoreBp: row.okrScoreBp,
  overridden: row.overrideScoreBp !== null,
  overrideReason: row.overrideReason,
});

/**
 * Whole months from the seniority (or start) date to the scheme's reference day — the same rule
 * the payroll engine already uses for seniority, not a second one.
 */
const serviceMonthsOn = (start: IsoDate | null, referenceDate: IsoDate): number => monthsOfService(start, referenceDate);

export type SimulationOptions = {
  /**
   * Compute against another approved scheme version, or a scheme that has only been proposed —
   * FR-PAY-21's "total cost under different multiplier tables". The run keeps its own version;
   * nothing is stored, the figures are handed straight back.
   */
  schemeOverride?: { entityId: string | null; value: unknown } | null;
};

export type BonusSimulation = { cost: BonusCost; lines: { personId: string; personName: string; entityId: string; trace: BonusTrace }[] };

/**
 * Work the whole run out from scratch: everyone in the entities, their settled result, their
 * salary on the reference day, and the scheme in force. Pure reads — nothing is written, so this
 * is both what `simulateBonusRun` stores and what a what-if hands back.
 */
const PERFORMANCE_READS_AT_ONCE = 4;

async function buildLines(run: BonusRunRow, options: SimulationOptions = {}, executor: Executor = db()): Promise<{ lines: { input: BonusPersonInput; trace: BonusTrace; personId: string; personName: string; entityId: string; schemeVersionId: string; result: PerformanceResultRow | null; kpiScoreIds: string[] }[] }> {
  const entityIds = run.entityIds;
  const referenceDates = new Map<string, IsoDate>();
  const schemes = new Map<string, ResolvedBonusScheme>();
  const resolved = await Promise.all(
    entityIds.map((entityId) => (options.schemeOverride ? { id: "", entityId: options.schemeOverride.entityId, validFrom: schemeDateOf(run.year), value: bonusSchemeSchema.parse(options.schemeOverride.value) } : getBonusScheme(entityId, schemeDateOf(run.year), executor))),
  );
  entityIds.forEach((entityId, index) => {
    schemes.set(entityId, resolved[index]);
    referenceDates.set(entityId, `${run.year}-${resolved[index].value.referenceDay}`);
  });

  // The people, their results and one salary read per entity (on that entity's own reference day), together.
  const [people, results, ...perEntity] = await Promise.all([
    listEmploymentFacts({ entityIds }, executor),
    listFinalResults({ year: run.year, entityIds }, executor),
    ...entityIds.map((entityId) => listBaseSalariesOn([entityId], referenceDates.get(entityId)!, schemes.get(entityId)!.value.baseComponentCode, executor)),
  ]);
  const salaries = new Map<string, number>();
  for (const forEntity of perEntity) for (const [personId, amount] of forEntity) salaries.set(personId, amount);

  const inRun = people.filter((person) => person.entityId && entityIds.includes(person.entityId));
  // Each person's OKR and KPI results, a few people at a time. Simulations run as server actions,
  // where React's per-request cache does not apply, so every call reads the year's goals again:
  // all at once would be dozens of full reads competing for the pool.
  const performance: [Awaited<ReturnType<typeof getOkrResults>>, Awaited<ReturnType<typeof getKpiResults>>][] = [];
  for (let start = 0; start < inRun.length; start += PERFORMANCE_READS_AT_ONCE) {
    const batch = inRun.slice(start, start + PERFORMANCE_READS_AT_ONCE);
    performance.push(...(await Promise.all(batch.map((person) => Promise.all([getOkrResults({ personId: person.personId, year: run.year }, executor), getKpiResults({ personId: person.personId, year: run.year }, executor)])))));
  }

  const lines = [];
  for (const [index, person] of inRun.entries()) {
    if (!person.entityId) continue;
    const scheme = schemes.get(person.entityId)!;
    const referenceDate = referenceDates.get(person.entityId)!;
    const result = results.get(person.personId) ?? null;
    // The stored month scores behind the result — what approval freezes.
    const [okr, kpi] = performance[index];
    const input: BonusPersonInput = {
      baseSalaryVnd: salaries.get(person.personId) ?? null,
      serviceMonths: serviceMonthsOn(person.seniorityDate ?? person.startDate, referenceDate),
      workforceType: person.workforceType,
      // Still employed on the reference day: not offboarded, and not gone before it.
      activeOnReferenceDay: person.status !== "offboarded" && (person.endDate === null || person.endDate >= referenceDate) && person.startDate !== null && person.startDate <= referenceDate,
      result: result ? resultInput(result) : null,
      unitOkrProgressBp: unitProgressOf(okr, scheme.value.unitOkr.level),
      schemeVersionId: scheme.id || null,
    };
    lines.push({ input, trace: bonusForPerson(input, scheme.value), personId: person.personId, personName: person.fullName, entityId: person.entityId, schemeVersionId: scheme.id, result, kpiScoreIds: kpi.months.map((month) => month.scoreId) });
  }
  return { lines };
}

/** The what-if: the whole group's cost under a scheme that has not been approved. Stores nothing. */
export async function simulateWhatIf(runId: string, schemeValue: unknown, executor: Executor = db()): Promise<BonusSimulation> {
  const run = await getBonusRun(runId, executor);
  if (!run) throw new ActionError("bonus_run_not_found");
  const { lines } = await buildLines(run, { schemeOverride: { entityId: null, value: schemeValue } }, executor);
  const nameOf = new Map((await listEntities()).map((row) => [row.id, row.shortName]));
  const byEntity = costByEntity(lines, nameOf);
  return { cost: { totals: sumBonus(lines.map((line) => line.trace)), byEntity }, lines: lines.map((line) => ({ personId: line.personId, personName: line.personName, entityId: line.entityId, trace: line.trace })) };
}

/**
 * Rebuild and store the run's lines, and move it to `simulated`. Safe to run again while the run
 * is open: the previous lines are replaced. **Owner adjustments already made are kept** — they are
 * decisions about a person, not figures, and rebuilding the inputs must not quietly drop them.
 */
export async function simulateBonusRun(runId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ run: BonusRunRow; cost: BonusCost }> {
  const run = await getBonusRun(runId, executor);
  if (!run) throw new ActionError("bonus_run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("bonus_run_not_editable");

  const existing = await listBonusLines(runId, {}, executor);
  const overrides = new Map(existing.filter((line) => line.trace.override).map((line) => [line.row.personId, { override: line.trace.override!, row: line.row }]));
  const { lines } = await buildLines(run, {}, executor);

  const stored = await executor.transaction(async (tx) => {
    await tx.delete(schema.bonusRunLine).where(eq(schema.bonusRunLine.runId, runId));
    const traces: BonusTrace[] = [];
    for (const line of lines) {
      const kept = overrides.get(line.personId);
      const trace = kept ? bonusForPerson({ ...line.input, override: kept.override }, (await schemeValueFor(line.schemeVersionId, run.year, line.entityId, tx))) : line.trace;
      const id = randomUUID();
      await tx.insert(schema.bonusRunLine).values({
        id,
        runId,
        personId: line.personId,
        entityId: line.entityId,
        schemeVersionId: line.schemeVersionId || null,
        resultId: line.result?.id ?? null,
        kpiScoreIds: line.kpiScoreIds,
        eligible: trace.eligible,
        exclusionReason: trace.exclusion,
        bandKey: trace.performance.bandKey,
        multiplierBp: trace.cap.multiplierBp,
        serviceMonths: trace.service.months,
        finalScoreBp: trace.performance.finalScoreBp,
        traceEnc: fieldCipher().encrypt(JSON.stringify(trace), bonusLineContext(id)),
        overrideReason: kept?.row.overrideReason ?? null,
        overrideByPersonId: kept?.row.overrideByPersonId ?? null,
        overrideAt: kept?.row.overrideAt ?? null,
      });
      traces.push(trace);
    }
    const totals = sumBonus(traces);
    const [updated] = await tx
      .update(schema.bonusRun)
      .set({
        status: "simulated",
        simulatedAt: new Date(),
        headcount: totals.headcount,
        eligibleCount: totals.eligible,
        overriddenCount: totals.overridden,
        totalsEnc: fieldCipher().encrypt(JSON.stringify(totals), bonusRunTotalsContext(runId)),
        updatedAt: new Date(),
      })
      .where(eq(schema.bonusRun.id, runId))
      .returning();
    if (run.status !== "simulated") await tx.insert(schema.bonusRunEvent).values({ runId, fromStatus: run.status, toStatus: "simulated", actorPersonId });
    return updated;
  });

  return { run: stored, cost: await getBonusCost(runId, executor) };
}

const schemeValueFor = async (schemeVersionId: string, year: number, entityId: string, executor: Executor): Promise<BonusSchemeValue> =>
  schemeVersionId ? (await getBonusSchemeVersion(schemeVersionId, executor)).value : (await getBonusScheme(entityId, schemeDateOf(year), executor)).value;

// ── The owner's adjustment ──────────────────────────────────────────────────────────────────

/**
 * The owner sets a different amount for one person, with a reason on the record (FR-PAY-21).
 * Only while the run has not been proposed — after the CEO has it, the figures are the ones being
 * signed. Passing `null` takes the adjustment back. The computed amount is never rewritten: it
 * stays in the trace beside the override, and the explanation page shows both.
 */
export async function overrideBonusLine(input: { runId: string; personId: string; amountVnd: number | null; reason: string }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: BonusTrace; after: BonusTrace }> {
  return executor.transaction(async (tx) => {
    const run = await getBonusRun(input.runId, tx);
    if (!run) throw new ActionError("bonus_run_not_found");
    if (!isOpenForEditing(run)) throw new ActionError("bonus_run_not_editable");
    const [row] = await tx.select().from(schema.bonusRunLine).where(and(eq(schema.bonusRunLine.runId, input.runId), eq(schema.bonusRunLine.personId, input.personId))).limit(1).for("update");
    if (!row) throw new ActionError("bonus_line_not_found");
    if (input.amountVnd !== null && (!Number.isSafeInteger(input.amountVnd) || input.amountVnd < 0)) throw new ActionError("amount_invalid");
    if (input.amountVnd !== null && input.reason.trim() === "") throw new ActionError("reason_required");

    const before = openTrace(row);
    const now = new Date();
    const override: BonusOverride | null = input.amountVnd === null ? null : { amountVnd: input.amountVnd, reason: input.reason.trim(), byPersonId: actorPersonId, at: now.toISOString() };
    // Rebuild the trace from what it was computed from, so the steps stay consistent.
    const scheme = await schemeValueFor(row.schemeVersionId ?? "", run.year, row.entityId, tx);
    const after = bonusForPerson(traceToInput(before, override), scheme);
    await tx
      .update(schema.bonusRunLine)
      .set({ traceEnc: fieldCipher().encrypt(JSON.stringify(after), bonusLineContext(row.id)), overrideReason: override?.reason ?? null, overrideByPersonId: override ? actorPersonId : null, overrideAt: override ? now : null, updatedAt: now })
      .where(eq(schema.bonusRunLine.id, row.id));
    await refreshTotals(input.runId, tx);
    return { before, after };
  });
}

/** A stored trace back to the engine input that produced it — so an override recomputes exactly. */
const traceToInput = (trace: BonusTrace, override: BonusOverride | null): BonusPersonInput => ({
  baseSalaryVnd: trace.exclusion === "no_salary" ? null : trace.base.amountVnd,
  serviceMonths: trace.service.months,
  // The exclusion was decided when the line was built; feed values back that reproduce it.
  workforceType: trace.exclusion === "workforce_type" ? "collaborator" : "employee",
  activeOnReferenceDay: trace.exclusion !== "not_active",
  result: trace.performance.resultId
    ? {
        resultId: trace.performance.resultId,
        finalScoreBp: trace.performance.finalScoreBp,
        bandKey: trace.performance.bandKey,
        bandMultiplierBp: trace.performance.multiplierBp,
        bandLabel: trace.performance.bandLabel,
        reviewScoreBp: trace.performance.reviewScoreBp,
        kpiScoreBp: trace.performance.kpiScoreBp,
        okrScoreBp: trace.performance.okrScoreBp,
        overridden: trace.performance.resultOverridden,
        overrideReason: trace.performance.resultOverrideReason,
      }
    : null,
  unitOkrProgressBp: trace.unitOkr.progressBp,
  override,
  schemeVersionId: trace.schemeVersionId,
});

async function refreshTotals(runId: string, executor: Executor): Promise<BonusTotals> {
  const lines = await listBonusLines(runId, {}, executor);
  const totals = sumBonus(lines.map((line) => line.trace));
  await executor
    .update(schema.bonusRun)
    .set({ headcount: totals.headcount, eligibleCount: totals.eligible, overriddenCount: totals.overridden, totalsEnc: fieldCipher().encrypt(JSON.stringify(totals), bonusRunTotalsContext(runId)), updatedAt: new Date() })
    .where(eq(schema.bonusRun.id, runId));
  return totals;
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────────

/**
 * Carry the run forward one step, with the signature kept in `bonus_run_event`.
 *
 * **Approving is the commitment**: the stored KPI month scores every line was computed from are
 * recorded in performance's `kpi_score_use`, and `reopenMonth` refuses those months from then on
 * (Phase 3.5's status note asked Phase 8 to enforce exactly this). A return or a cancellation
 * before payment releases them again — nothing has been paid, so nothing is frozen.
 */
export async function stepBonusRun(runId: string, step: BonusStep, actorPersonId: string, input: { comment?: string | null } = {}, executor: ReturnType<typeof db> = db()): Promise<{ before: BonusRunRow; after: BonusRunRow }> {
  const rule = BONUS_STEPS[step];
  if (rule.commentRequired && !input.comment?.trim()) throw new ActionError("comment_required");
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.bonusRun).where(eq(schema.bonusRun.id, runId)).limit(1).for("update");
    if (!before) throw new ActionError("bonus_run_not_found");
    if (!rule.from.includes(before.status)) throw new ActionError("bonus_step_not_allowed");
    if (step === "propose" && before.headcount === 0) throw new ActionError("bonus_run_empty");

    const now = new Date();
    const signature: Partial<typeof schema.bonusRun.$inferInsert> =
      step === "propose"
        ? { proposedAt: now, proposedByPersonId: actorPersonId }
        : step === "approve"
          ? { approvedAt: now, approvedByPersonId: actorPersonId }
          : step === "return"
            ? { proposedAt: null, proposedByPersonId: null, approvedAt: null, approvedByPersonId: null }
            : step === "cancel"
              ? { cancelledAt: now }
              : {};

    const [after] = await tx.update(schema.bonusRun).set({ status: rule.to, ...signature, updatedAt: now }).where(eq(schema.bonusRun.id, runId)).returning();
    await tx.insert(schema.bonusRunEvent).values({ runId, fromStatus: before.status, toStatus: rule.to, actorPersonId, comment: input.comment?.trim() || null });

    if (step === "approve") await freezeScores(after, tx);
    if (step === "return" || step === "cancel") await releaseConsumedScores(runId, tx);
    return { before, after };
  });
}

/** Record the stored KPI scores this run was approved off. Idempotent. */
async function freezeScores(run: BonusRunRow, executor: Executor): Promise<number> {
  const rows = await executor.select().from(schema.bonusRunLine).where(eq(schema.bonusRunLine.runId, run.id));
  const scoreIds = [...new Set(rows.flatMap((row) => row.kpiScoreIds))];
  if (scoreIds.length === 0) return 0;
  const scores = await executor.select({ id: schema.kpiScore.id, personId: schema.kpiScore.personId, entityId: schema.kpiScore.entityId, month: schema.kpiScore.month }).from(schema.kpiScore).where(inArray(schema.kpiScore.id, scoreIds));
  const uses: ScoreUse[] = scores.map((score) => ({ scoreId: score.id, personId: score.personId, entityId: score.entityId, month: score.month }));
  return markScoresConsumed({ consumerType: "bonus_run", consumerId: run.id, year: run.year, uses }, executor);
}

// ── Payment ─────────────────────────────────────────────────────────────────────────────────

export type BonusPaymentResult = { runId: string; payrollRuns: { entityId: string; payrollRunId: string; headcount: number }[] };

/**
 * Pay an approved run: one **off-cycle payroll run per entity** (FR-PAY-19), each carrying the
 * amounts as lines under the scheme's pay component. Payroll then does everything money needs —
 * the month's aggregated tax, the payslip, the bank file — and this module does none of it.
 *
 * Lines worth nothing are left out of the payroll run (there is nothing to pay) but keep their
 * bonus line and their trace, so "why did I get nothing" is still answered.
 */
export async function payBonusRun(runId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<BonusPaymentResult> {
  const run = await getBonusRun(runId, executor);
  if (!run) throw new ActionError("bonus_run_not_found");
  if (run.status !== "approved") throw new ActionError("bonus_run_not_approved");

  const lines = await listBonusLines(runId, {}, executor);
  const payrollRuns: BonusPaymentResult["payrollRuns"] = [];
  for (const entityId of run.entityIds) {
    const payable = lines.filter((line) => line.row.entityId === entityId && line.trace.finalAmountVnd > 0);
    if (payable.length === 0) continue;
    const scheme = await schemeValueFor(payable[0].row.schemeVersionId ?? "", run.year, entityId, executor);
    const created = await createOffCycleRun(
      {
        entityId,
        month: run.payrollMonth,
        name: run.name,
        note: `bonus_run:${runId}`,
        lines: payable.map((line) => ({ personId: line.row.personId, code: scheme.payComponentCode, amount: line.trace.finalAmountVnd, note: `${run.year}` })),
      },
      actorPersonId,
      executor,
    );
    // Only the lines that were actually in the payroll run. A line worth nothing was never paid,
    // and must not claim on its explanation page that it was.
    await executor.update(schema.bonusRunLine).set({ payrollRunId: created.id, updatedAt: new Date() }).where(and(eq(schema.bonusRunLine.runId, runId), inArray(schema.bonusRunLine.personId, payable.map((line) => line.row.personId))));
    payrollRuns.push({ entityId, payrollRunId: created.id, headcount: payable.length });
  }
  if (payrollRuns.length === 0) throw new ActionError("bonus_run_nothing_to_pay");

  // Last, because the trigger freezes the run and its lines the moment it says `paid`.
  await executor.update(schema.bonusRun).set({ status: "paid", paidAt: new Date(), paidByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.bonusRun.id, runId));
  await executor.insert(schema.bonusRunEvent).values({ runId, fromStatus: "approved", toStatus: "paid", actorPersonId, comment: null });
  return { runId, payrollRuns };
}
