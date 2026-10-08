// Retroactive items (FR-PAY-17): finding the differences a paid month has left behind, and
// keeping them until a run carries them.
//
// Two things produce one. **A correction to a locked timesheet** (`timesheet_adjustment`, the
// attendance module's answer to "the month is locked but the day was wrong") — its worth in money
// is found by recalculating the month from the very input it was paid on, with the correction
// applied. **A salary structure approved after its month was paid** — the same month recalculated
// with the structure that should have applied. Both go through the pure engine with the statutory
// versions, policy and catalogue the original run recorded, so what comes out is the change that
// was made and nothing else.
//
// HR can also enter one by hand, with a reason.
//
// **Payroll pulls; nobody pushes.** Attendance records its corrections and salary decisions are
// approved without knowing that payroll exists; `deriveRetroItems` reads both when a regular run
// is calculated (`runs.ts`), and when C&B ask for it on the retro screen. It is idempotent, so it
// can run before every calculation without care.
//
// No authorization inside: the actions check `canManageCompensation` over the entity.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { storedMessage } from "@/lib/stored-text";
import { getTimesheetDays, listAdjustmentsForPayroll, listVoidedAdjustmentIds, releaseAdjustments, type TimesheetAdjustmentRow } from "@/modules/attendance/service";
import { buildSegments, type CalculationContext } from "./calculation";
import { calculatePerson, PAYROLL_ENGINE_VERSION } from "./engine/calculate";
import { payPeriodOf } from "./engine/period";
import { applyAdjustmentDeltas, differenceBetween, withSegments } from "./engine/retro";
import { listStructuresBetween, type SalaryStructureView } from "./salaries";
import type { RetroItem } from "./engine/types";
import { retroAmountContext } from "./field-contexts";
import { reopenCalculatedRun, reopenCalculatedRunsAfter } from "./lifecycle";
import { openInput, openResult, type PayrollRunPersonRow, type PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;
export type RetroItemRow = typeof schema.payrollRetroItem.$inferSelect;
export type RetroItemView = RetroItem & {
  id: string;
  personId: string;
  entityId: string;
  status: RetroItemRow["status"];
  sourceRef: string | null;
  payrollMonth: string | null;
  runId: string | null;
  createdByPersonId: string | null;
  createdAt: Date;
};

const openAmount = (row: RetroItemRow): number => Number(fieldCipher().decrypt(row.amountEnc, retroAmountContext(row.id)));

const toView = (row: RetroItemRow): RetroItemView => ({
  id: row.id,
  personId: row.personId,
  entityId: row.entityId,
  sourceMonth: row.sourceMonth,
  amount: openAmount(row),
  kind: row.kind,
  reason: row.reason,
  insuranceBaseChanged: row.insuranceBaseChanged,
  status: row.status,
  sourceRef: row.sourceRef,
  payrollMonth: row.payrollMonth,
  runId: row.runId,
  createdByPersonId: row.createdByPersonId,
  createdAt: row.createdAt,
});

const byPerson = (rows: readonly RetroItemRow[]): Map<string, RetroItemView[]> => {
  const grouped = new Map<string, RetroItemView[]>();
  for (const row of rows) {
    const list = grouped.get(row.personId) ?? [];
    list.push(toView(row));
    grouped.set(row.personId, list);
  }
  return grouped;
};

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

/** Everything waiting for the run of `month`, by person. Items of later months are left alone. */
export async function listOpenRetroItems(entityId: string, month: string, executor: Executor = db()): Promise<Map<string, RetroItemView[]>> {
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select()
    .from(table)
    .where(and(eq(table.entityId, entityId), eq(table.status, "open"), lt(table.sourceMonth, month)))
    .orderBy(asc(table.sourceMonth), asc(table.createdAt));
  return byPerson(rows);
}

/**
 * What a calculation of this run reads: the items still waiting for its month **and the ones the
 * run itself already took**. Without the second half a recalculation would find nothing — the
 * first calculation marked them taken — and the lines would vanish while the items stayed spent.
 */
export async function listRetroItemsForRun(run: Pick<PayrollRunRow, "id" | "entityId" | "month">, executor: Executor = db()): Promise<Map<string, RetroItemView[]>> {
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select()
    .from(table)
    .where(and(eq(table.entityId, run.entityId), lt(table.sourceMonth, run.month), or(eq(table.status, "open"), and(eq(table.status, "taken"), eq(table.runId, run.id)))))
    .orderBy(asc(table.sourceMonth), asc(table.createdAt));
  return byPerson(rows);
}

/**
 * What a run's screen shows: while the run is open, everything waiting for its month and what it
 * has already taken; once it has been put forward, only what it carried.
 */
export async function listRetroItemsOnRun(run: Pick<PayrollRunRow, "id" | "entityId" | "month" | "status">, executor: Executor = db()): Promise<RetroItemView[]> {
  if (run.status === "draft" || run.status === "calculated")
    return [...(await listRetroItemsForRun(run, executor)).values()].flat().sort((a, b) => a.sourceMonth.localeCompare(b.sourceMonth) || a.createdAt.getTime() - b.createdAt.getTime());
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select()
    .from(table)
    .where(and(eq(table.runId, run.id), eq(table.status, "taken")))
    .orderBy(asc(table.sourceMonth), asc(table.createdAt));
  return rows.map(toView);
}

export async function listRetroItems(filter: { entityIds?: readonly string[]; personId?: string; status?: RetroItemRow["status"] }, executor: Executor = db()): Promise<RetroItemView[]> {
  if (filter.entityIds?.length === 0) return [];
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select()
    .from(table)
    .where(and(filter.entityIds ? inArray(table.entityId, [...filter.entityIds]) : undefined, filter.personId ? eq(table.personId, filter.personId) : undefined, filter.status ? eq(table.status, filter.status) : undefined))
    .orderBy(asc(table.sourceMonth), asc(table.createdAt));
  return rows.map(toView);
}

export async function getRetroItem(id: string, executor: Executor = db()): Promise<RetroItemRow | null> {
  const [row] = await executor.select().from(schema.payrollRetroItem).where(eq(schema.payrollRetroItem.id, id)).limit(1);
  return row ?? null;
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

export async function addRetroItem(
  input: { entityId: string; personId: string; sourceMonth: string; amount: number; kind: RetroItemRow["kind"]; reason: string; insuranceBaseChanged?: boolean; sourceRef?: string | null },
  actorPersonId: string | null,
  executor: Executor = db(),
): Promise<RetroItemRow> {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new ActionError("retro_amount_invalid");
  if (!input.reason.trim()) throw new ActionError("retro_reason_required");
  const id = randomUUID();
  const [created] = await executor
    .insert(schema.payrollRetroItem)
    .values({
      id,
      entityId: input.entityId,
      personId: input.personId,
      sourceMonth: input.sourceMonth,
      kind: input.kind,
      amountEnc: fieldCipher().encrypt(String(input.amount), retroAmountContext(id)),
      reason: input.reason.trim().slice(0, 300),
      insuranceBaseChanged: input.insuranceBaseChanged ?? false,
      sourceRef: input.sourceRef ?? null,
      createdByPersonId: actorPersonId,
    })
    // The unique index over (person, kind, source, month) means deriving the same correction
    // twice changes nothing — the second pass is a no-op, not a second payment.
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ActionError("retro_item_exists");
  return created;
}

/** A run has carried these; they never come up again unless the run lets them go. */
export async function markRetroItemsTaken(tx: Executor, ids: readonly string[], payrollMonth: string, runId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .update(schema.payrollRetroItem)
    .set({ status: "taken", payrollMonth, runId, updatedAt: new Date() })
    .where(and(inArray(schema.payrollRetroItem.id, [...ids]), eq(schema.payrollRetroItem.status, "open")))
    .returning({ id: schema.payrollRetroItem.id });
  return rows.length;
}

/**
 * Gives back what a run took, so the next calculation — of this run or of the next one — finds it
 * waiting again. `keepIds` are the items the run still carries (a recalculation keeps most of
 * them); with none, everything goes back (the run was cancelled). The attendance corrections
 * behind them are handed back as well, so one that turns out wrong can be voided again.
 */
export async function releaseRetroItems(tx: Executor, run: Pick<PayrollRunRow, "id" | "month">, keepIds: readonly string[] = []): Promise<number> {
  const table = schema.payrollRetroItem;
  const released = await tx
    .update(table)
    .set({ status: "open", payrollMonth: null, runId: null, updatedAt: new Date() })
    .where(and(eq(table.runId, run.id), eq(table.status, "taken"), keepIds.length > 0 ? notInArray(table.id, [...keepIds]) : undefined))
    .returning({ kind: table.kind, sourceRef: table.sourceRef });
  const adjustmentIds = [...new Set(released.filter((row) => row.kind === "timesheet_adjustment" && row.sourceRef).map((row) => row.sourceRef!))];
  await releaseAdjustments(tx as Tx, adjustmentIds, run.month);
  return released.length;
}

/**
 * An item entered in error is cancelled with a reason, never deleted. One that a run has already
 * taken can still be cancelled **while that run is open for editing** — it is let go of first;
 * `reopenedRunId` names the run, which the caller sends back to draft so it is calculated again.
 * Once the run has been proposed its figures are evidence and the item stays.
 */
export async function cancelRetroItem(id: string, reason: string, executor: Executor = db()): Promise<RetroItemRow & { reopenedRunId: string | null }> {
  if (!reason.trim()) throw new ActionError("retro_reason_required");
  const [row] = await executor.select().from(schema.payrollRetroItem).where(eq(schema.payrollRetroItem.id, id)).limit(1);
  if (!row) throw new ActionError("retro_item_not_found");
  let reopenedRunId: string | null = null;
  if (row.status === "taken" && row.runId) {
    const [run] = await executor.select({ id: schema.payrollRun.id, status: schema.payrollRun.status, month: schema.payrollRun.month }).from(schema.payrollRun).where(eq(schema.payrollRun.id, row.runId)).limit(1);
    if (!run || (run.status !== "draft" && run.status !== "calculated")) throw new ActionError("retro_item_not_open");
    reopenedRunId = run.id;
    if (row.kind === "timesheet_adjustment" && row.sourceRef) await releaseAdjustments(executor as Tx, [row.sourceRef], run.month);
  } else if (row.status !== "open") throw new ActionError("retro_item_not_open");
  const [cancelled] = await executor
    .update(schema.payrollRetroItem)
    .set({ status: "cancelled", payrollMonth: null, runId: null, reason: storedMessage("retroCancelled", { reason: row.reason, why: reason.trim().slice(0, 150) }), updatedAt: new Date() })
    .where(and(eq(schema.payrollRetroItem.id, id), eq(schema.payrollRetroItem.status, row.status)))
    .returning();
  if (!cancelled) throw new ActionError("retro_item_not_open");
  return { ...cancelled, reopenedRunId };
}

// ── What C&B do by hand (the actions call these) ────────────────────────────────────────────

/** Later than any month: "every month so far", where no particular run is being prepared. */
export const ALL_MONTHS = "9999-12";

/**
 * HR's own entry: a difference of a past month, with its reason. With `adjustmentId` it stands in
 * for an attendance correction the system could not price (`listUnpricedAdjustments`) — the item
 * then carries the correction's id, so the correction is marked as taken when a run carries it.
 *
 * A calculated run that would carry the item goes back to draft: it has to be calculated again.
 */
export async function enterRetroItem(
  input: { entityId: string; personId: string; sourceMonth: string; amount: number; reason: string; adjustmentId?: string | null },
  actorPersonId: string,
): Promise<{ item: RetroItemRow; reopenedRunIds: string[] }> {
  // A month that has not happened yet has nothing to correct, and its item would never come due.
  if (input.sourceMonth > todayInVietnam().slice(0, 7)) throw new ActionError("retro_month_in_future");
  return db().transaction(async (tx) => {
    let source: { kind: RetroItemRow["kind"]; sourceRef: string | null } = { kind: "manual", sourceRef: null };
    if (input.adjustmentId) {
      const waiting = (await listUnpricedAdjustments(input.entityId, ALL_MONTHS, tx)).find((row) => row.adjustmentId === input.adjustmentId);
      // Not waiting any more (priced, voided, entered by somebody else), or not this person's month.
      if (!waiting || waiting.personId !== input.personId || waiting.sourceMonth !== input.sourceMonth) throw new ActionError("retro_adjustment_not_waiting");
      source = { kind: "timesheet_adjustment", sourceRef: waiting.adjustmentId };
    }
    const item = await addRetroItem({ entityId: input.entityId, personId: input.personId, sourceMonth: input.sourceMonth, amount: input.amount, reason: input.reason, ...source }, actorPersonId, tx);
    return { item, reopenedRunIds: await reopenCalculatedRunsAfter(tx, input.entityId, input.sourceMonth, actorPersonId) };
  });
}

/** Cancels an item with its reason; a calculated run that had taken it goes back to draft. */
export async function withdrawRetroItem(id: string, reason: string, actorPersonId: string): Promise<{ item: RetroItemRow; reopenedRunId: string | null }> {
  return db().transaction(async (tx) => {
    const { reopenedRunId, ...item } = await cancelRetroItem(id, reason, tx);
    if (reopenedRunId) await reopenCalculatedRun(tx, reopenedRunId, actorPersonId);
    return { item, reopenedRunId };
  });
}

/**
 * Looks for differences now, without waiting for the next calculation — what the "check for
 * differences" button does. Calculated runs that would carry what was found go back to draft.
 */
export async function refreshRetroItems(entityId: string, actorPersonId: string): Promise<DerivedRetro & { reopenedRunIds: string[] }> {
  const derived = await deriveRetroItems(entityId, ALL_MONTHS, actorPersonId);
  const earliest = derived.created.map((item) => item.sourceMonth).sort()[0];
  return { ...derived, reopenedRunIds: earliest ? await reopenCalculatedRunsAfter(db(), entityId, earliest, actorPersonId) : [] };
}

// ── Deriving differences ────────────────────────────────────────────────────────────────────

/** Why a correction could not be turned into money by the system, and waits for a hand. */
export type RetroSkip = "month_not_run" | "engine_changed" | "recalculation_failed";

export type DerivedRetro = { created: RetroItemView[]; skipped: { personId: string; sourceMonth: string; reason: RetroSkip }[]; /** Items whose attendance correction was voided after it was priced. */ cancelled: number };

/** A run past the point where it can be sent back and recalculated: its figures are what was paid. */
const SETTLED = ["payment_prepared", "paid", "locked"] as const;

const engineOf = (context: unknown): string | null => (context as Pick<CalculationContext, "engineVersion"> | null)?.engineVersion ?? null;

type PaidLine = { line: PayrollRunPersonRow; engineVersion: string | null };

/**
 * What each person was paid on for each month asked about: the line of the month's regular run.
 * Only the people and months named are read — a difference is derived for a handful of people,
 * not for the entity's whole history.
 */
async function paidLines(entityId: string, pairs: readonly { personId: string; month: string }[], executor: Executor, settledOnly = false): Promise<Map<string, PaidLine>> {
  const paid = new Map<string, PaidLine>();
  if (pairs.length === 0) return paid;
  const rows = await executor
    .select({ line: schema.payrollRunPerson, month: schema.payrollRun.month, context: schema.payrollRun.context })
    .from(schema.payrollRunPerson)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
    .where(
      and(
        eq(schema.payrollRun.entityId, entityId),
        eq(schema.payrollRun.kind, "regular"),
        settledOnly ? inArray(schema.payrollRun.status, [...SETTLED]) : ne(schema.payrollRun.status, "cancelled"),
        inArray(schema.payrollRun.month, [...new Set(pairs.map((pair) => pair.month))]),
        inArray(schema.payrollRunPerson.personId, [...new Set(pairs.map((pair) => pair.personId))]),
      ),
    );
  // At most one live regular run per entity and month (`payroll_run_regular_key`).
  for (const row of rows) paid.set(`${row.line.personId}:${row.month}`, { line: row.line, engineVersion: engineOf(row.context) });
  return paid;
}

/** `pending`: the month's own payroll has not been run yet — there is nothing to say until it has. */
type WeighedAdjustment = { adjustment: TimesheetAdjustmentRow; paid: PaidLine | null; skip: RetroSkip | "pending" | null };

/**
 * The corrections attendance has recorded against locked months before `beforeMonth`, each with
 * the line it would be priced against — or the reason it cannot be: the month was never run here
 * (before go-live, or another entity paid it), or it was paid by an engine whose rules have since
 * changed, so a recalculation would mix the correction with the change of rules.
 *
 * "Never run" is said only of a month payroll has already gone past: a correction to the month
 * that is next to be run simply waits for that run to exist.
 */
async function weighAdjustments(entityId: string, beforeMonth: string, executor: Executor): Promise<WeighedAdjustment[]> {
  const adjustments = await listAdjustmentsForPayroll(entityId, beforeMonth, executor);
  if (adjustments.length === 0) return [];
  const [paid, [latest]] = await Promise.all([
    paidLines(
      entityId,
      adjustments.map((adjustment) => ({ personId: adjustment.personId, month: adjustment.month })),
      executor,
    ),
    executor
      .select({ month: sql<string | null>`max(${schema.payrollRun.month})` })
      .from(schema.payrollRun)
      .where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.kind, "regular"), ne(schema.payrollRun.status, "cancelled"))),
  ]);
  // The run being prepared counts as well: every month before it has been gone past.
  const reached =
    [latest?.month, beforeMonth === ALL_MONTHS ? null : beforeMonth]
      .filter((month): month is string => !!month)
      .sort()
      .at(-1) ?? null;
  return adjustments.map((adjustment) => {
    const line = paid.get(`${adjustment.personId}:${adjustment.month}`) ?? null;
    if (!line) return { adjustment, paid: null, skip: reached && adjustment.month < reached ? "month_not_run" : "pending" };
    return { adjustment, paid: line, skip: line.engineVersion !== PAYROLL_ENGINE_VERSION ? "engine_changed" : null };
  });
}

/** The sources that already have an item, cancelled ones included: C&B's "no" to one is kept. */
async function knownSources(entityId: string, executor: Executor): Promise<{ any: Set<string>; live: Set<string> }> {
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select({ kind: table.kind, sourceRef: table.sourceRef, sourceMonth: table.sourceMonth, status: table.status })
    .from(table)
    .where(and(eq(table.entityId, entityId), isNotNull(table.sourceRef)));
  const key = (row: { kind: string; sourceRef: string | null; sourceMonth: string }) => `${row.kind}:${row.sourceRef}:${row.sourceMonth}`;
  return { any: new Set(rows.map(key)), live: new Set(rows.filter((row) => row.status !== "cancelled").map(key)) };
}

export type UnpricedAdjustment = { adjustmentId: string; personId: string; sourceMonth: string; reason: string; skip: RetroSkip; createdAt: Date };

/**
 * Corrections the system could not price and nobody has entered by hand yet — shown beside the
 * retro items so C&B can work the amount out and type it in (the item then carries the
 * correction's id, and the correction leaves this list).
 */
export async function listUnpricedAdjustments(entityId: string, beforeMonth: string, executor: Executor = db()): Promise<UnpricedAdjustment[]> {
  const weighed = (await weighAdjustments(entityId, beforeMonth, executor)).flatMap(({ adjustment, skip }) => (skip && skip !== "pending" ? [{ adjustment, skip }] : []));
  if (weighed.length === 0) return [];
  const { live } = await knownSources(entityId, executor);
  return weighed
    .filter(({ adjustment }) => !live.has(`timesheet_adjustment:${adjustment.id}:${adjustment.month}`))
    .map(({ adjustment, skip }) => ({ adjustmentId: adjustment.id, personId: adjustment.personId, sourceMonth: adjustment.month, reason: adjustment.reason, skip, createdAt: adjustment.createdAt }));
}

/**
 * Looks at every month of the entity that has been calculated and paid, and works out what has
 * changed since. Idempotent: a difference already recorded (same person, kind, source and month)
 * is not recorded twice — not even after C&B cancelled it — so this can run before every payroll
 * without care.
 *
 * `beforeMonth` is the run about to be prepared — only months before it are examined.
 */
export async function deriveRetroItems(entityId: string, beforeMonth: string, actorPersonId: string | null, executor: Executor = db()): Promise<DerivedRetro> {
  const created: RetroItemView[] = [];
  const skipped: DerivedRetro["skipped"] = [];
  const known = await knownSources(entityId, executor);
  const add = async (input: Parameters<typeof addRetroItem>[0]) => {
    // Raced by another derivation: the unique index said no, and that is the right answer.
    const item = await addRetroItem(input, actorPersonId, executor).catch(() => null);
    if (item) created.push(toView(item));
  };

  // 0. A correction that was priced and then voided by HR must not be paid.
  const cancelled = await cancelItemsOfVoidedAdjustments(entityId, executor);

  // 1. Corrections attendance has recorded against locked timesheets.
  for (const { adjustment, paid, skip } of await weighAdjustments(entityId, beforeMonth, executor)) {
    if (known.any.has(`timesheet_adjustment:${adjustment.id}:${adjustment.month}`) || skip === "pending") continue;
    if (skip || !paid) {
      // Left for HR to enter by hand rather than guessed at (`listUnpricedAdjustments`).
      skipped.push({ personId: adjustment.personId, sourceMonth: adjustment.month, reason: skip ?? "month_not_run" });
      continue;
    }
    const before = openResult(paid.line);
    const after = calculatePerson(applyAdjustmentDeltas(openInput(paid.line), adjustment.deltas));
    const difference = differenceBetween(before, after);
    if (difference.amount === 0) continue;
    await add({
      entityId,
      personId: adjustment.personId,
      sourceMonth: adjustment.month,
      amount: difference.amount,
      kind: "timesheet_adjustment",
      reason: adjustment.reason,
      insuranceBaseChanged: difference.insuranceBaseChanged,
      sourceRef: adjustment.id,
    });
  }

  // 2. Salary structures approved after the month they apply to was paid. Only a month that can
  //    no longer be sent back counts as paid: one still open is recalculated with the new terms
  //    (`run-readiness.ts` calls it stale), and carrying the difference as well would pay it twice.
  const structure = schema.salaryStructure;
  const run = schema.payrollRun;
  const late = await executor
    .select({ structureId: structure.id, personId: structure.personId, validFrom: structure.validFrom, month: run.month })
    .from(structure)
    .innerJoin(run, eq(run.entityId, structure.entityId))
    .where(
      and(
        eq(structure.entityId, entityId),
        isNull(structure.voidedAt),
        eq(run.kind, "regular"),
        inArray(run.status, [...SETTLED]),
        lt(run.month, beforeMonth),
        // Decided after the month's figures were worked out — that is what makes it late.
        gt(structure.createdAt, sql`coalesce(${run.calculatedAt}, ${run.createdAt})`),
        // In force at some point inside the month: a raise from the 16th counts as much as one from the 1st.
        sql`to_char(${structure.validFrom}, 'YYYY-MM') <= ${run.month}`,
        sql`(${structure.validTo} is null or to_char(${structure.validTo}, 'YYYY-MM') >= ${run.month})`,
      ),
    )
    .orderBy(asc(run.month), asc(structure.validFrom));
  // One item per person and month in a pass, named after the latest decision (the rows come in
  // that order): the month is recalculated once, under every structure as it now stands.
  const fresh = [...new Map(late.filter((row) => !known.any.has(`salary_change:${row.structureId}:${row.month}`)).map((row) => [`${row.personId}:${row.month}`, row])).values()];
  const pairs = fresh.map((row) => ({ personId: row.personId, month: row.month }));
  const [paid, carried] = await Promise.all([paidLines(entityId, pairs, executor, true), salaryDifferencesCarried(entityId, pairs, executor)]);

  // One read of the structures and of the frozen days per month concerned, not per person.
  for (const month of [...new Set(fresh.map((row) => row.month))]) {
    const rows = fresh.filter((row) => row.month === month && paid.has(`${row.personId}:${month}`));
    if (rows.length === 0) continue;
    const period = payPeriodOf(month, 0);
    const [structures, days] = await Promise.all([listStructuresBetween(entityId, period.start, period.end, executor), getTimesheetDays([...new Set(rows.map((row) => row.personId))], period.start, period.end, executor)]);
    for (const row of rows) {
      const line = paid.get(`${row.personId}:${month}`)!;
      if (line.engineVersion !== PAYROLL_ENGINE_VERSION) {
        skipped.push({ personId: row.personId, sourceMonth: month, reason: "engine_changed" });
        continue;
      }
      const difference = differenceFromStructures(
        line.line,
        month,
        structures.filter((entry) => entry.personId === row.personId),
        days.filter((day) => day.personId === row.personId),
      );
      if (!difference) {
        skipped.push({ personId: row.personId, sourceMonth: month, reason: "recalculation_failed" });
        continue;
      }
      // An earlier late decision for the same month already carried part of the way from what
      // was paid to what is due now: only the rest is new.
      const amount = difference.amount - (carried.get(`${row.personId}:${month}`) ?? 0);
      if (amount === 0) continue;
      await add({
        entityId,
        personId: row.personId,
        sourceMonth: month,
        amount,
        kind: "salary_change",
        reason: storedMessage("retroSalaryChange", { validFrom: row.validFrom, month }),
        insuranceBaseChanged: difference.insuranceBaseChanged,
        sourceRef: row.structureId,
      });
    }
  }

  return { created, skipped, cancelled };
}

/** What earlier salary-change items already carry for these people and months, summed per pair. */
async function salaryDifferencesCarried(entityId: string, pairs: readonly { personId: string; month: string }[], executor: Executor): Promise<Map<string, number>> {
  const carried = new Map<string, number>();
  if (pairs.length === 0) return carried;
  const table = schema.payrollRetroItem;
  const rows = await executor
    .select()
    .from(table)
    .where(
      and(
        eq(table.entityId, entityId),
        eq(table.kind, "salary_change"),
        ne(table.status, "cancelled"),
        inArray(table.personId, [...new Set(pairs.map((pair) => pair.personId))]),
        inArray(table.sourceMonth, [...new Set(pairs.map((pair) => pair.month))]),
      ),
    );
  // The amounts are sealed, so the sum is made here rather than in SQL.
  for (const row of rows) carried.set(`${row.personId}:${row.sourceMonth}`, (carried.get(`${row.personId}:${row.sourceMonth}`) ?? 0) + openAmount(row));
  return carried;
}

/**
 * HR may void a correction until a run has taken it. If payroll had already priced it, the item
 * goes with it — cancelled, with the reason, not deleted.
 */
async function cancelItemsOfVoidedAdjustments(entityId: string, executor: Executor): Promise<number> {
  const table = schema.payrollRetroItem;
  const open = await executor
    .select({ id: table.id, sourceRef: table.sourceRef, reason: table.reason })
    .from(table)
    .where(and(eq(table.entityId, entityId), eq(table.kind, "timesheet_adjustment"), eq(table.status, "open"), isNotNull(table.sourceRef)));
  if (open.length === 0) return 0;
  const voided = new Set(
    await listVoidedAdjustmentIds(
      open.map((row) => row.sourceRef!),
      executor,
    ),
  );
  const gone = open.filter((row) => voided.has(row.sourceRef!));
  if (gone.length === 0) return 0;
  const rows = await executor
    .update(table)
    .set({ status: "cancelled", reason: sql`${table.reason} || ' — huỷ: điều chỉnh bảng công đã bị huỷ'`, updatedAt: new Date() })
    .where(
      and(
        inArray(
          table.id,
          gone.map((row) => row.id),
        ),
        eq(table.status, "open"),
      ),
    )
    .returning({ id: table.id });
  return rows.length;
}

/**
 * What a month would have paid under the salary structures as they stand now.
 *
 * The month is **not** recalculated from scratch: the input it was paid on is replayed with new
 * segments, so attendance, leave, dependants and every figure typed into that run stay exactly as
 * they were, and the difference is the salary decision alone. null = it could not be worked out.
 */
function differenceFromStructures(line: PayrollRunPersonRow, month: string, structures: readonly SalaryStructureView[], days: Parameters<typeof buildSegments>[4]) {
  if (structures.length === 0) return null;
  try {
    const before = openResult(line);
    const input = openInput(line);
    const period = payPeriodOf(month, input.period.standardDays);
    // `buildSegments` reads only these three figures of the locked month, and they are in the input.
    const totals = { standardDays: input.timesheet.standardDays, paidDaysCenti: input.timesheet.paidDaysCenti, unpaidDaysCenti: input.timesheet.unpaidDaysCenti };
    // The probation days are the ones the month was paid with: the replayed input still knows them.
    const probation = input.segments.filter((segment) => segment.probationPercent).map((segment) => ({ start: segment.from, end: segment.to }));
    const segments = buildSegments(structures, totals as Parameters<typeof buildSegments>[1], period.start, period.end, days, probation);
    return differenceBetween(before, calculatePerson(withSegments(input, segments)));
  } catch {
    return null;
  }
}
