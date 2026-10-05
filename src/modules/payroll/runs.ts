// Payroll runs: creating one, calculating it, and reading it back (FR-PAY-19, 30; SRS D17).
//
// **Week 3 builds the store and the calculation.** A run is created, calculated and read here;
// the lifecycle from `proposed` on — who proposes, who signs, what each step freezes, the variance
// check and the period lock — is week 4's, on top of these tables. Nothing in this file moves a
// run past `calculated`.
//
// What a run is calculated from is written under the run row's lock (`FOR UPDATE`): a typed-in
// figure, a calculation being stored and a proposal queue on it, so none of them can pass another.
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
import { type CalculationContext, calculateEntityMonth, calculateOffCycle, offCycleLeavePayouts, type PersonCalculation } from "./calculation";
import { resolveCatalogue } from "./components";
import { isPitReliefCode } from "./engine/components";
import { LEAVE_PAYOUT_CODE } from "./engine/leave-payout";
import { payPeriodOf } from "./engine/period";
import type { PayInput, PersonPayResult, PriorInMonth, RetroItem } from "./engine/types";
import { assertPeriodOpen, reopenCalculatedRun } from "./lifecycle";
import { runEntryContext, runResultContext, runInputContext, runTotalsContext } from "./field-contexts";
import { deriveRetroItems, listRetroItemsForRun, markRetroItemsTaken, releaseRetroItems, type RetroItemView } from "./retro";
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

/** The figures typed into a run, by person — of everyone in it, or of the one person asked about. */
export async function listRunInputs(runId: string, executor: Executor = db(), personId?: string): Promise<Map<string, PayInput[]>> {
  return openRunInputs(await executor.select().from(schema.payrollRunInput).where(and(eq(schema.payrollRunInput.runId, runId), personId ? eq(schema.payrollRunInput.personId, personId) : undefined)).orderBy(schema.payrollRunInput.code));
}

function openRunInputs(rows: readonly (typeof schema.payrollRunInput.$inferSelect)[]): Map<string, PayInput[]> {
  const byPerson = new Map<string, PayInput[]>();
  for (const row of rows) {
    const amount = Number(fieldCipher().decrypt(row.amountEnc, runEntryContext(row.id)));
    const list = byPerson.get(row.personId) ?? [];
    list.push({ code: row.code, amount, note: row.note });
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

export type RunInputLine = { personId: string; code: string; amount: number; note?: string | null };

/**
 * Adds or replaces a figure for one person in a run — a bonus, a commission, an advance.
 *
 * **A figure is never changed or dropped in silence** (it is somebody's money):
 *   - the code must be an `input` component of the entity's catalogue — anything else is refused
 *     here rather than skipped by the calculation;
 *   - the amount is entered as a positive figure and the component's kind says which way it goes.
 *     A negative earning is refused (a clawback is a retro item or a deduction component), and so
 *     is a negative deduction (it is subtracted by being a deduction).
 * This is the one door for other modules too (`service.ts`): an expense claim or a commission
 * that payroll cannot take is an error the caller sees, not a line that quietly pays nothing.
 *
 * A change to a run that was already calculated sends it back to `draft` (`reopenCalculatedRun`):
 * its figures no longer say what it would pay, and it cannot be proposed until calculated again.
 */
export async function setRunInput(input: { runId: string } & RunInputLine, actorPersonId: string, executor: Executor = db()): Promise<{ reopened: boolean }> {
  return { reopened: await inTransaction(executor, (tx) => writeRunInputs(tx, input.runId, [input], actorPersonId)) };
}

/**
 * `setRunInput` for several people of one run at once — one lock, one reading of the catalogue,
 * one insert — under the same rules. `actorPersonId` null = the system (a nightly sweep).
 */
export async function setRunInputs(runId: string, lines: readonly RunInputLine[], actorPersonId: string | null, executor: Executor = db()): Promise<{ reopened: boolean }> {
  if (lines.length === 0) return { reopened: false };
  return { reopened: await inTransaction(executor, (tx) => writeRunInputs(tx, runId, lines, actorPersonId)) };
}

/** The lines of one run, checked against one reading of the catalogue and written under the run's lock. */
async function writeRunInputs(tx: Executor, runId: string, lines: readonly RunInputLine[], actorPersonId: string | null): Promise<boolean> {
  if (lines.some((line) => !Number.isSafeInteger(line.amount))) throw new ActionError("amount_invalid");
  // The lock is what a proposal queues on: a figure cannot slip in beside one (`stepRun`).
  const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
  if (!run) throw new ActionError("run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");

  const catalogue = new Map((await resolveCatalogue(run.entityId, payPeriodOf(run.month, 0).end, tx)).map((component) => [component.code, component]));
  for (const line of lines) {
    // A deduction from the assessable income (FR-PAY-13) belongs to the month's regular run, which
    // works out the month's tax; it is entered as a positive figure like every deduction.
    if (isPitReliefCode(line.code)) {
      if (run.kind !== "regular") throw new ActionError("run_input_relief_regular_only", { code: line.code });
      if (line.amount < 0) throw new ActionError("run_input_negative_deduction", { code: line.code });
      continue;
    }
    const component = catalogue.get(line.code);
    // The code is a catalogue entry, not pay: naming it is safe.
    if (!component || component.source !== "input") throw new ActionError("run_input_code_unknown", { code: line.code });
    if (line.amount < 0) throw new ActionError(component.kind === "earning" ? "run_input_negative_earning" : "run_input_negative_deduction", { code: line.code });
  }

  const keyOf = (line: { personId: string; code: string }) => `${line.personId}:${line.code}`;
  const stored = new Map((await tx.select().from(schema.payrollRunInput).where(and(eq(schema.payrollRunInput.runId, runId), inArray(schema.payrollRunInput.personId, [...new Set(lines.map((line) => line.personId))])))).map((row) => [keyOf(row), row]));
  const cipher = fieldCipher();
  // The same clock as `calculatedAt`, so "typed after the calculation" can be told from the rows.
  const now = new Date();
  const created = new Map<string, typeof schema.payrollRunInput.$inferInsert & { id: string }>();
  let changed = false;
  for (const line of lines) {
    const note = line.note ?? null;
    // Every amount is bound to the row that holds it, so each is sealed against that row's id.
    const fresh = created.get(keyOf(line));
    if (fresh) {
      // A second line for the same person and code in one call replaces the first.
      fresh.amountEnc = cipher.encrypt(String(line.amount), runEntryContext(fresh.id));
      fresh.note = note;
      continue;
    }
    const existing = stored.get(keyOf(line));
    if (!existing) {
      const id = randomUUID();
      created.set(keyOf(line), { id, runId, personId: line.personId, code: line.code, amountEnc: cipher.encrypt(String(line.amount), runEntryContext(id)), note, createdByPersonId: actorPersonId, createdAt: now, updatedAt: now });
      continue;
    }
    // The same figure again (a sweep re-posting what is already there) changes nothing, and must
    // not send a calculated run back to draft.
    if (Number(cipher.decrypt(existing.amountEnc, runEntryContext(existing.id))) === line.amount && existing.note === note) continue;
    // A second entry for the same code replaces the first; the id (and so the binding) stays.
    // One statement per replaced figure: a figure is replaced one at a time, by hand.
    await tx.update(schema.payrollRunInput).set({ amountEnc: cipher.encrypt(String(line.amount), runEntryContext(existing.id)), note, updatedAt: now }).where(eq(schema.payrollRunInput.id, existing.id));
    changed = true;
  }
  if (created.size > 0) {
    await tx.insert(schema.payrollRunInput).values([...created.values()]);
    changed = true;
  }
  // Says whether a calculated run went back to draft, so the action can record that it did.
  return changed ? reopenCalculatedRun(tx, runId, actorPersonId) : false;
}

/** Takes a typed-in figure out again. Like `setRunInput`, it sends a calculated run back to draft. */
export async function removeRunInput(runId: string, personId: string, code: string, executor: Executor = db(), actorPersonId: string | null = null): Promise<{ reopened: boolean }> {
  return inTransaction(executor, async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!run || !isOpenForEditing(run)) throw new ActionError("run_not_editable");
    const removed = await tx.delete(schema.payrollRunInput).where(and(eq(schema.payrollRunInput.runId, runId), eq(schema.payrollRunInput.personId, personId), eq(schema.payrollRunInput.code, code))).returning({ id: schema.payrollRunInput.id });
    return { reopened: removed.length > 0 ? await reopenCalculatedRun(tx, runId, actorPersonId) : false };
  });
}

/** Until a run is proposed it may still be changed and recalculated; after that it is evidence. */
export const isOpenForEditing = (run: PayrollRunRow): boolean => run.status === "draft" || run.status === "calculated";

/**
 * What another module may know about a run: which month it is and how far it has got. Ids, a month
 * and a status — never a figure, and never who is in it.
 */
export type RunHandle = { id: string; entityId: string; month: string; status: PayrollRunRow["status"]; openForEditing: boolean };

const handleOf = (run: PayrollRunRow): RunHandle => ({ id: run.id, entityId: run.entityId, month: run.month, status: run.status, openForEditing: isOpenForEditing(run) });

/**
 * The run a figure typed in today would land in: the entity's **earliest** regular run that is
 * still open for editing — earliest, so something waiting to be paid goes into the month that pays
 * soonest rather than sitting out a cycle. `null` = nothing is open, and the caller waits.
 *
 * This is how a module outside payroll (an approved expense claim, FR-REQ-03) finds somewhere to
 * put a payment without knowing anything about runs.
 */
export async function findOpenRegularRun(entityId: string, executor: Executor = db()): Promise<RunHandle | null> {
  const rows = await executor
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.kind, "regular"), inArray(schema.payrollRun.status, ["draft", "calculated"])))
    .orderBy(schema.payrollRun.month);
  return rows.length > 0 ? handleOf(rows[0]) : null;
}

/** `findOpenRegularRun` for several entities in one query; an entity with nothing open is absent. */
export async function findOpenRegularRuns(entityIds: readonly string[], executor: Executor = db()): Promise<Map<string, RunHandle>> {
  if (entityIds.length === 0) return new Map();
  const rows = await executor
    .selectDistinctOn([schema.payrollRun.entityId])
    .from(schema.payrollRun)
    .where(and(inArray(schema.payrollRun.entityId, [...new Set(entityIds)]), eq(schema.payrollRun.kind, "regular"), inArray(schema.payrollRun.status, ["draft", "calculated"])))
    .orderBy(schema.payrollRun.entityId, schema.payrollRun.month);
  return new Map(rows.map((run) => [run.entityId, handleOf(run)]));
}

/** One run's handle, for a caller holding an id it stored earlier. */
export async function getRunHandle(runId: string, executor: Executor = db()): Promise<RunHandle | null> {
  const run = await getRun(runId, executor);
  return run ? handleOf(run) : null;
}

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
  // One transaction: a line payroll refuses (an unknown code, a negative amount) leaves no run behind.
  return inTransaction(executor, async (tx) => {
    // A closed month takes nothing more, not even a bonus: it would change a filed month's tax.
    await assertPeriodOpen(input.entityId, input.month, tx);
    const [created] = await tx.insert(schema.payrollRun).values({ entityId: input.entityId, month: input.month, kind: "off_cycle", name: input.name, note: input.note ?? null, createdByPersonId: actorPersonId }).returning();
    if (input.lines.length > 0) await writeRunInputs(tx, created.id, input.lines, actorPersonId);
    // A run with no typed line is one that pays leavers' unused leave the signed regular run did
    // not (`calculateOffCycle`) — and is refused when there is none of that to pay either.
    else if ((await offCycleLeavePayouts(input.entityId, input.month, () => priorInMonth(created, tx), tx)).length === 0) throw new ActionError("run_has_no_lines");
    return created;
  });
}

/**
 * Leavers of an entity's month whose unused leave the signed regular run did not pay and no other
 * run of the month pays yet — what an off-cycle run of that month would pay them (FR-PAY-18).
 * Days only, never an amount; for the screen that starts such a run.
 */
export async function leavePayoutsAwaitingRun(entityId: string, month: string, executor: Executor = db()): Promise<{ personId: string; daysCenti: number }[]> {
  const none = { id: "00000000-0000-0000-0000-000000000000", entityId, month } as PayrollRunRow;
  return (await offCycleLeavePayouts(entityId, month, () => priorInMonth(none, executor), executor)).map(({ personId, daysCenti }) => ({ personId, daysCenti }));
}

export type CalculatedRun = { run: PayrollRunRow; totals: RunTotals; people: PersonCalculation[]; context: CalculationContext; retroTaken: number };

/** People stored per statement: a month's results go in a few round trips, not one per person. */
const STORE_CHUNK = 200;

/** What the typed-in figures of a run looked like at one moment — ids and the time each was last written, never an amount. */
const inputsFingerprint = (rows: readonly { id: string; updatedAt: Date }[]): string =>
  rows
    .map((row) => `${row.id}:${row.updatedAt.getTime()}`)
    .sort()
    .join("|");

/**
 * Calculates a run and stores every person's result and the input it came from, then moves it to
 * `calculated`. Safe to run again while the run is open: the previous results are replaced.
 *
 * A regular run also takes in what is waiting for it — the retro items of earlier months and the
 * corrections attendance has recorded against locked timesheets (FR-PAY-17), which are looked for
 * first (`deriveRetroItems`). What it carries is marked as taken inside the same transaction, so
 * a difference is carried exactly once — **and a recalculation reads what this run itself took**,
 * so the lines of the first calculation are still there in the second. An item whose person is
 * not in the run is left waiting (and shown on the run screen), never marked as paid.
 *
 * The figures are those of the moment the inputs were read, and `calculatedAt` is that moment. If
 * somebody typed a figure in while the month was being worked out, the results are stored but the
 * run stays `draft`: it was out of date before it was finished.
 */
export async function calculateRun(runId: string, options: { executor?: Executor; onProgress?: (done: number, total: number) => void | Promise<void> } = {}): Promise<CalculatedRun> {
  const executor = options.executor ?? db();
  const run = await getRun(runId, executor);
  if (!run) throw new ActionError("run_not_found");
  if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");
  const regular = run.kind === "regular";

  const readAt = new Date();
  const typed = await executor.select().from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, runId)).orderBy(schema.payrollRunInput.code);
  const inputs = openRunInputs(typed);
  if (regular) await deriveRetroItems(run.entityId, run.month, null, executor);
  const retro = regular ? await listRetroItemsForRun(run, executor) : new Map<string, RetroItemView[]>();
  const prior = await priorInMonth(run, executor);

  const calculation =
    run.kind === "off_cycle"
      ? await calculateOffCycle(run.entityId, run.month, { inputs, prior, onProgress: options.onProgress, executor })
      : await calculateEntityMonth(run.entityId, run.month, { inputs, retro: new Map([...retro].map(([personId, items]) => [personId, items.map(toRetroItem)])), prior, onProgress: options.onProgress, executor });

  const totals = sumTotals(calculation.people);
  const cipher = fieldCipher();
  // Only what a person in the run was actually calculated with is carried by it.
  const inRun = new Set(calculation.people.map((person) => person.result.personId));
  const carried = [...retro].filter(([personId]) => inRun.has(personId)).flatMap(([, items]) => items);

  const stored = await inTransaction(executor, async (tx) => {
    // Under the run's lock: a proposal, a cancellation or a typed-in figure waits, or came first.
    const [current] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!current || !isOpenForEditing(current)) throw new ActionError("run_not_editable");
    const typedNow = await tx.select({ id: schema.payrollRunInput.id, updatedAt: schema.payrollRunInput.updatedAt }).from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, runId));
    let upToDate = inputsFingerprint(typedNow) === inputsFingerprint(typed);

    await tx.delete(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
    const rows = calculation.people.map((person) => {
      const id = randomUUID();
      return {
        id,
        runId,
        personId: person.result.personId,
        entityId: run.entityId,
        profile: person.result.profile,
        resultEnc: cipher.encrypt(JSON.stringify(person.result), runResultContext(id)),
        inputEnc: cipher.encrypt(JSON.stringify(person.input), runInputContext(id)),
        warnings: person.result.warnings,
      };
    });
    for (let index = 0; index < rows.length; index += STORE_CHUNK) await tx.insert(schema.payrollRunPerson).values(rows.slice(index, index + STORE_CHUNK));

    if (regular) {
      // What an earlier calculation of this run took and this one no longer carries goes back to
      // waiting; what this one carries must never be taken again by the next run.
      await releaseRetroItems(tx, run, carried.map((item) => item.id));
      await markRetroItemsTaken(tx, carried.filter((item) => item.status === "open").map((item) => item.id), run.month, runId);
      const adjustmentIds = [...new Set(carried.filter((item) => item.kind === "timesheet_adjustment" && item.sourceRef).map((item) => item.sourceRef!))];
      if (adjustmentIds.length > 0) await markAdjustmentsTaken(tx as Tx, adjustmentIds, run.month);
      // An item cancelled while the month was being worked out is in the figures but no longer
      // this run's to carry: like a figure typed in meanwhile, it leaves the run to be calculated again.
      if (carried.length > 0) {
        const table = schema.payrollRetroItem;
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(table).where(and(inArray(table.id, carried.map((item) => item.id)), eq(table.status, "taken"), eq(table.runId, runId)));
        upToDate &&= held.count === carried.length;
      }
    }

    const [updated] = await tx
      .update(schema.payrollRun)
      .set({ status: upToDate ? "calculated" : "draft", context: calculation.context, totalsEnc: cipher.encrypt(JSON.stringify(totals), runTotalsContext(runId)), headcount: totals.headcount, calculatedAt: readAt, updatedAt: new Date() })
      .where(eq(schema.payrollRun.id, runId))
      .returning();
    return updated;
  });

  return { run: stored, totals, people: calculation.people, context: calculation.context, retroTaken: carried.length };
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
      // The deductions from the assessable income each run took itself (FR-PAY-13) — read from
      // its input, not its result, whose figure already includes the runs before it.
      otherDeductions: (before?.otherDeductions ?? 0) + (openInput(row).otherPitDeductions ?? 0),
      tax: (before?.tax ?? 0) + result.totals.pit,
      // The leave days the run actually paid — its LEAVE_PAYOUT line — not the days it was handed.
      leavePayoutDaysCenti: (before?.leavePayoutDaysCenti ?? 0) + result.lines.filter((line) => line.code === LEAVE_PAYOUT_CODE).reduce((sum, line) => sum + (line.inputs.daysCenti ?? 0), 0),
    });
  }
  return prior;
}

/**
 * A run that went wrong is cancelled, never deleted: its number and its history stay. This is the
 * one way a run's results are thrown away, so it is the one place that gives back what the run
 * took — a return to HR and a change that reopens the run both keep the results and the items.
 */
export async function cancelRun(runId: string, executor: Executor = db()): Promise<PayrollRunRow> {
  return inTransaction(executor, async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!run) throw new ActionError("run_not_found");
    if (!isOpenForEditing(run)) throw new ActionError("run_not_editable");
    // Whatever it had taken in — retro items and the attendance corrections behind them — goes
    // back to waiting for the next run.
    await releaseRetroItems(tx, run);
    await tx.delete(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId));
    const [cancelled] = await tx.update(schema.payrollRun).set({ status: "cancelled", totalsEnc: null, headcount: 0, updatedAt: new Date() }).where(eq(schema.payrollRun.id, runId)).returning();
    return cancelled;
  });
}

/** A stored item as the engine wants it: the difference and why, without the row's own identity. */
const toRetroItem = (item: RetroItemView): RetroItem => ({ sourceMonth: item.sourceMonth, amount: item.amount, kind: item.kind, reason: item.reason, insuranceBaseChanged: item.insuranceBaseChanged });

const inTransaction = async <T>(executor: Executor, work: (tx: Executor) => Promise<T>): Promise<T> => ("transaction" in executor ? executor.transaction((tx) => work(tx)) : work(executor));
