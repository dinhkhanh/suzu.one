// Payroll runs: creating one, calculating it, and reading it back (FR-PAY-19, 30; SRS D17).
//
// **Week 3 builds the store and the calculation.** A run is created, calculated and read here;
// the lifecycle from `proposed` on — who proposes, who signs, what each step freezes, the variance
// check and the period lock — is week 4's, on top of these tables. Nothing in this file moves a
// run past `calculated`.
//
// No authorization inside (like `calculation.ts`): the callers — actions and jobs — check
// `canManageCompensation` over the run's entity first. Every figure is encrypted before it is
// stored; the clear columns are ids, dates, status and warning names.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { markAdjustmentsTaken } from "@/modules/attendance/service";
import { type CalculationContext, calculateEntityMonth, calculateOffCycle, type PersonCalculation } from "./calculation";
import type { PayInput, PersonPayResult, PriorInMonth, RetroItem } from "./engine/types";
import { assertPeriodOpen } from "./lifecycle";
import { runEntryContext, runResultContext, runInputContext, runTotalsContext } from "./field-contexts";
import { listOpenRetroItems, markRetroItemsTaken, type RetroItemView } from "./retro";
import { EMPTY_TOTALS, openInput, openResult, openTotals, type PayrollRunPersonRow, type PayrollRunRow, type RunTotals, sumTotals } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export async function getRun(runId: string, executor: Executor = db()): Promise<PayrollRunRow | null> {
  const [row] = await executor.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1);
  return row ?? null;
}

export async function listRuns(filter: { entityIds?: readonly string[]; month?: string } = {}, executor: Executor = db()): Promise<PayrollRunRow[]> {
  if (filter.entityIds?.length === 0) return [];
  return executor
    .select()
    .from(schema.payrollRun)
    .where(and(filter.entityIds ? inArray(schema.payrollRun.entityId, [...filter.entityIds]) : undefined, filter.month ? eq(schema.payrollRun.month, filter.month) : undefined))
    .orderBy(desc(schema.payrollRun.month), desc(schema.payrollRun.createdAt));
}

export { EMPTY_TOTALS, openInput, openResult, openTotals, type PayrollRunPersonRow, type PayrollRunRow, type RunTotals, sumTotals };

export type RunPersonResult = { row: PayrollRunPersonRow; result: PersonPayResult };

/** One person's calculated payslip, decrypted. The caller decides who may see it. */
export async function getRunPerson(runId: string, personId: string, executor: Executor = db()): Promise<RunPersonResult | null> {
  const [row] = await executor.select().from(schema.payrollRunPerson).where(and(eq(schema.payrollRunPerson.runId, runId), eq(schema.payrollRunPerson.personId, personId))).limit(1);
  return row ? { row, result: openResult(row) } : null;
}

export async function listRunPeople(runId: string, executor: Executor = db()): Promise<RunPersonResult[]> {
  const rows = await executor.select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
  return rows.map((row) => ({ row, result: openResult(row) }));
}

// ── Typed-in figures ────────────────────────────────────────────────────────────────────────

export async function listRunInputs(runId: string, executor: Executor = db()): Promise<Map<string, PayInput[]>> {
  const rows = await executor.select().from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, runId)).orderBy(schema.payrollRunInput.code);
  const byPerson = new Map<string, PayInput[]>();
  for (const row of rows) {
    const amount = Number(fieldCipher().decrypt(row.amountEnc, runEntryContext(row.id)));
    const list = byPerson.get(row.personId) ?? [];
    list.push({ code: row.code, amount, note: row.note });
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

/** Adds or replaces a figure for one person in a run — a bonus, a commission, an advance. */
export async function setRunInput(input: { runId: string; personId: string; code: string; amount: number; note?: string | null }, actorPersonId: string, executor: Executor = db()): Promise<void> {
  if (!Number.isSafeInteger(input.amount)) throw new ActionError("amount_invalid");
  const run = await getRun(input.runId, executor);
  if (!run) throw new ActionError("run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");

  const id = randomUUID();
  const amountEnc = fieldCipher().encrypt(String(input.amount), runEntryContext(id));
  await executor
    .insert(schema.payrollRunInput)
    .values({ id, runId: input.runId, personId: input.personId, code: input.code, amountEnc, note: input.note ?? null, createdByPersonId: actorPersonId })
    // A second entry for the same code replaces the first; the id (and so the binding) stays.
    .onConflictDoUpdate({
      target: [schema.payrollRunInput.runId, schema.payrollRunInput.personId, schema.payrollRunInput.code],
      set: { amountEnc: sql`excluded.amount_enc`, note: input.note ?? null, updatedAt: new Date() },
    });

  // The stored amount is bound to the row that holds it; after a conflict that row is the
  // original, so the value must be re-sealed against the id that survived.
  const [stored] = await executor.select().from(schema.payrollRunInput).where(and(eq(schema.payrollRunInput.runId, input.runId), eq(schema.payrollRunInput.personId, input.personId), eq(schema.payrollRunInput.code, input.code))).limit(1);
  if (stored && stored.id !== id) {
    await executor.update(schema.payrollRunInput).set({ amountEnc: fieldCipher().encrypt(String(input.amount), runEntryContext(stored.id)) }).where(eq(schema.payrollRunInput.id, stored.id));
  }
}

export async function removeRunInput(runId: string, personId: string, code: string, executor: Executor = db()): Promise<void> {
  const run = await getRun(runId, executor);
  if (!run || !isOpenForEditing(run)) throw new ActionError("run_not_editable");
  await executor.delete(schema.payrollRunInput).where(and(eq(schema.payrollRunInput.runId, runId), eq(schema.payrollRunInput.personId, personId), eq(schema.payrollRunInput.code, code)));
}

/** Until a run is proposed it may still be changed and recalculated; after that it is evidence. */
export const isOpenForEditing = (run: PayrollRunRow): boolean => run.status === "draft" || run.status === "calculated";

// ── Creating and calculating ────────────────────────────────────────────────────────────────

/**
 * The month's regular run for an entity. Refuses a second one: a month is paid once, and a run
 * that went wrong is cancelled rather than duplicated.
 */
export async function createRegularRun(input: { entityId: string; month: string; note?: string | null }, actorPersonId: string, executor: Executor = db()): Promise<PayrollRunRow> {
  await assertPeriodOpen(input.entityId, input.month, executor);
  const [existing] = await executor.select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, input.entityId), eq(schema.payrollRun.month, input.month), eq(schema.payrollRun.kind, "regular"), ne(schema.payrollRun.status, "cancelled"))).limit(1);
  if (existing) throw new ActionError("run_exists", { runId: existing.id });
  const [created] = await executor.insert(schema.payrollRun).values({ entityId: input.entityId, month: input.month, kind: "regular", note: input.note ?? null, createdByPersonId: actorPersonId }).returning();
  return created;
}

/**
 * An off-cycle run: something extra paid inside a month, taxed with that month (FR-PAY-19).
 * **This is the entry point Phase 8's year-end bonus pays through** (FR-PAY-21) — the bonus
 * scheme works out an amount per person and hands it over as `lines`; everything after that
 * (aggregating the month's tax, the payslip, the bank file) is payroll's, not the scheme's.
 */
export async function createOffCycleRun(input: { entityId: string; month: string; name: string; note?: string | null; lines: readonly { personId: string; code: string; amount: number; note?: string | null }[] }, actorPersonId: string, executor: Executor = db()): Promise<PayrollRunRow> {
  if (input.lines.length === 0) throw new ActionError("run_has_no_lines");
  // A closed month takes nothing more, not even a bonus: it would change a filed month's tax.
  await assertPeriodOpen(input.entityId, input.month, executor);
  const [created] = await executor.insert(schema.payrollRun).values({ entityId: input.entityId, month: input.month, kind: "off_cycle", name: input.name, note: input.note ?? null, createdByPersonId: actorPersonId }).returning();
  for (const line of input.lines) await setRunInput({ runId: created.id, ...line }, actorPersonId, executor);
  return created;
}

export type CalculatedRun = { run: PayrollRunRow; totals: RunTotals; people: PersonCalculation[]; context: CalculationContext; retroTaken: number };

/**
 * Calculates a run and stores every person's result and the input it came from, then moves it to
 * `calculated`. Safe to run again while the run is open: the previous results are replaced.
 *
 * A regular run also takes in what is waiting for it — the retro items of earlier months and the
 * corrections attendance has recorded against locked timesheets (FR-PAY-17). Those are marked as
 * taken inside the same transaction, so a difference is carried exactly once.
 */
export async function calculateRun(runId: string, options: { executor?: Executor; onProgress?: (done: number, total: number) => void | Promise<void> } = {}): Promise<CalculatedRun> {
  const executor = options.executor ?? db();
  const run = await getRun(runId, executor);
  if (!run) throw new ActionError("run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");

  const inputs = await listRunInputs(runId, executor);
  const retro = run.kind === "regular" ? await listOpenRetroItems(run.entityId, run.month, executor) : new Map<string, RetroItemView[]>();
  const prior = await priorInMonth(run, executor);

  const calculation =
    run.kind === "off_cycle"
      ? await calculateOffCycle(run.entityId, run.month, { inputs, prior, onProgress: options.onProgress, executor })
      : await calculateEntityMonth(run.entityId, run.month, { inputs, retro: new Map([...retro].map(([personId, items]) => [personId, items.map(toRetroItem)])), prior, onProgress: options.onProgress, executor });

  const totals = sumTotals(calculation.people);
  const cipher = fieldCipher();

  const stored = await inTransaction(executor, async (tx) => {
    await tx.delete(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
    for (const person of calculation.people) {
      const id = randomUUID();
      await tx.insert(schema.payrollRunPerson).values({
        id,
        runId,
        personId: person.result.personId,
        entityId: run.entityId,
        profile: person.result.profile,
        resultEnc: cipher.encrypt(JSON.stringify(person.result), runResultContext(id)),
        inputEnc: cipher.encrypt(JSON.stringify(person.input), runInputContext(id)),
        warnings: person.result.warnings,
      });
    }

    // What this run has taken in must never be taken again by the next one.
    const retroIds = [...retro.values()].flat().map((item) => item.id);
    await markRetroItemsTaken(tx, retroIds, run.month, runId);
    const adjustmentIds = [...new Set([...retro.values()].flat().filter((item) => item.kind === "timesheet_adjustment" && item.sourceRef).map((item) => item.sourceRef!))];
    if (run.kind === "regular" && adjustmentIds.length > 0) await markAdjustmentsTaken(tx as Tx, adjustmentIds, run.month);

    const [updated] = await tx
      .update(schema.payrollRun)
      .set({ status: "calculated", context: calculation.context, totalsEnc: cipher.encrypt(JSON.stringify(totals), runTotalsContext(runId)), headcount: totals.headcount, calculatedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.payrollRun.id, runId))
      .returning();
    return updated;
  });

  return { run: stored, totals, people: calculation.people, context: calculation.context, retroTaken: [...retro.values()].flat().length };
}

/**
 * What the month's other runs have already taxed and withheld for each person — how an off-cycle
 * run knows the brackets and deductions the regular run has used (FR-PAY-19). Cancelled runs
 * count for nothing; every other run of the month does, because all of them will be paid.
 */
export async function priorInMonth(run: PayrollRunRow, executor: Executor = db()): Promise<Map<string, PriorInMonth>> {
  const others = await executor
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, run.entityId), eq(schema.payrollRun.month, run.month), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.id, run.id)));
  const prior = new Map<string, PriorInMonth>();
  if (others.length === 0) return prior;

  const rows = await executor.select().from(schema.payrollRunPerson).where(inArray(schema.payrollRunPerson.runId, others.map((row) => row.id)));
  for (const row of rows) {
    const result = openResult(row);
    const before = prior.get(row.personId);
    prior.set(row.personId, {
      runId: before?.runId ?? row.runId,
      taxableIncome: (before?.taxableIncome ?? 0) + result.totals.taxableIncome,
      employeeInsurance: (before?.employeeInsurance ?? 0) + result.totals.employeeInsurance,
      otherDeductions: before?.otherDeductions ?? 0,
      tax: (before?.tax ?? 0) + result.totals.pit,
    });
  }
  return prior;
}

/** A run that went wrong is cancelled, never deleted: its number and its history stay. */
export async function cancelRun(runId: string, executor: Executor = db()): Promise<PayrollRunRow> {
  const run = await getRun(runId, executor);
  if (!run) throw new ActionError("run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");
  return inTransaction(executor, async (tx) => {
    // Whatever it had taken in goes back to waiting for the next run.
    await tx.update(schema.payrollRetroItem).set({ status: "open", payrollMonth: null, runId: null, updatedAt: new Date() }).where(and(eq(schema.payrollRetroItem.runId, runId), eq(schema.payrollRetroItem.status, "taken")));
    await tx.delete(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
    const [cancelled] = await tx.update(schema.payrollRun).set({ status: "cancelled", totalsEnc: null, headcount: 0, updatedAt: new Date() }).where(eq(schema.payrollRun.id, runId)).returning();
    return cancelled;
  });
}

/** A stored item as the engine wants it: the difference and why, without the row's own identity. */
const toRetroItem = (item: RetroItemView): RetroItem => ({ sourceMonth: item.sourceMonth, amount: item.amount, kind: item.kind, reason: item.reason, insuranceBaseChanged: item.insuranceBaseChanged });

const inTransaction = async <T>(executor: Executor, work: (tx: Executor) => Promise<T>): Promise<T> => ("transaction" in executor ? executor.transaction((tx) => work(tx)) : work(executor));
