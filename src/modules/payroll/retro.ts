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
// No authorization inside: the actions check `canManageCompensation` over the entity.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { listAdjustmentsForPayroll } from "@/modules/attendance/service";
import { getTimesheetDays } from "@/modules/attendance/service";
import { buildSegments } from "./calculation";
import { calculatePerson } from "./engine/calculate";
import { payPeriodOf } from "./engine/period";
import { applyAdjustmentDeltas, differenceBetween, withSegments } from "./engine/retro";
import { listStructuresBetween } from "./salaries";
import type { RetroItem } from "./engine/types";
import { retroAmountContext } from "./field-contexts";
import { openInput, openResult, type PayrollRunPersonRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;
export type RetroItemRow = typeof schema.payrollRetroItem.$inferSelect;
export type RetroItemView = RetroItem & { id: string; personId: string; entityId: string; status: RetroItemRow["status"]; sourceRef: string | null; payrollMonth: string | null; runId: string | null; createdAt: Date };

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
  createdAt: row.createdAt,
});

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

/** Everything waiting for the run of `month`, by person. Items of later months are left alone. */
export async function listOpenRetroItems(entityId: string, month: string, executor: Executor = db()): Promise<Map<string, RetroItemView[]>> {
  const table = schema.payrollRetroItem;
  const rows = await executor.select().from(table).where(and(eq(table.entityId, entityId), eq(table.status, "open"), lt(table.sourceMonth, month))).orderBy(asc(table.sourceMonth), asc(table.createdAt));
  const byPerson = new Map<string, RetroItemView[]>();
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push(toView(row));
    byPerson.set(row.personId, list);
  }
  return byPerson;
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
    // The unique index over (person, kind, source) means deriving the same correction twice
    // changes nothing — the second pass is a no-op, not a second payment.
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ActionError("retro_item_exists");
  return created;
}

/** A run has carried these; they never come up again unless the run is cancelled. */
export async function markRetroItemsTaken(tx: Executor, ids: readonly string[], payrollMonth: string, runId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .update(schema.payrollRetroItem)
    .set({ status: "taken", payrollMonth, runId, updatedAt: new Date() })
    .where(and(inArray(schema.payrollRetroItem.id, [...ids]), eq(schema.payrollRetroItem.status, "open")))
    .returning({ id: schema.payrollRetroItem.id });
  return rows.length;
}

/** An item entered in error is cancelled with a reason, never deleted. */
export async function cancelRetroItem(id: string, reason: string, executor: Executor = db()): Promise<RetroItemRow> {
  const [row] = await executor.select().from(schema.payrollRetroItem).where(eq(schema.payrollRetroItem.id, id)).limit(1);
  if (!row) throw new ActionError("retro_item_not_found");
  if (row.status !== "open") throw new ActionError("retro_item_not_open");
  const [cancelled] = await executor
    .update(schema.payrollRetroItem)
    .set({ status: "cancelled", reason: `${row.reason} — huỷ: ${reason.trim().slice(0, 150)}`, updatedAt: new Date() })
    .where(eq(schema.payrollRetroItem.id, id))
    .returning();
  return cancelled;
}

// ── Deriving differences ────────────────────────────────────────────────────────────────────

export type DerivedRetro = { created: RetroItemView[]; skipped: { personId: string; sourceMonth: string; reason: string }[] };

/**
 * Looks at every month of the entity that has been calculated and paid, and works out what has
 * changed since. Idempotent: a difference already recorded (same person, kind and source) is not
 * recorded twice, so this can run before every payroll without care.
 *
 * `beforeMonth` is the run about to be prepared — only months before it are examined.
 */
export async function deriveRetroItems(entityId: string, beforeMonth: string, actorPersonId: string | null, executor: Executor = db()): Promise<DerivedRetro> {
  const created: RetroItemView[] = [];
  const skipped: DerivedRetro["skipped"] = [];

  // The runs whose months are behind the one being prepared and which actually paid something.
  const runs = await executor
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, entityId), lt(schema.payrollRun.month, beforeMonth), eq(schema.payrollRun.kind, "regular"), ne(schema.payrollRun.status, "cancelled")))
    .orderBy(asc(schema.payrollRun.month));
  if (runs.length === 0) return { created, skipped };

  const paidRows = await executor.select().from(schema.payrollRunPerson).where(inArray(schema.payrollRunPerson.runId, runs.map((run) => run.id)));
  const runOf = new Map(runs.map((run) => [run.id, run]));
  // The latest run line per person and month is what was actually paid for it.
  const paid = new Map<string, PayrollRunPersonRow>();
  for (const row of paidRows) {
    const run = runOf.get(row.runId);
    if (!run) continue;
    paid.set(`${row.personId}:${run.month}`, row);
  }

  // 1. Corrections attendance has recorded against locked timesheets.
  const adjustments = await listAdjustmentsForPayroll(entityId, beforeMonth, executor);
  for (const adjustment of adjustments) {
    const line = paid.get(`${adjustment.personId}:${adjustment.month}`);
    if (!line) {
      // The month was never run here (before go-live, or another entity paid it): the correction
      // is left for HR to enter by hand rather than guessed at.
      skipped.push({ personId: adjustment.personId, sourceMonth: adjustment.month, reason: "month_not_run" });
      continue;
    }
    const before = openResult(line);
    const after = calculatePerson(applyAdjustmentDeltas(openInput(line), adjustment.deltas));
    const difference = differenceBetween(before, after);
    if (difference.amount === 0) continue;
    const item = await addRetroItem(
      { entityId, personId: adjustment.personId, sourceMonth: adjustment.month, amount: difference.amount, kind: "timesheet_adjustment", reason: adjustment.reason, insuranceBaseChanged: difference.insuranceBaseChanged, sourceRef: adjustment.id },
      actorPersonId,
      executor,
    ).catch(() => null);
    if (item) created.push(toView(item));
  }

  // 2. Salary structures approved after the month they apply to was paid.
  const structures = await executor.select().from(schema.salaryStructure).where(eq(schema.salaryStructure.entityId, entityId));
  for (const run of runs) {
    const monthStart = `${run.month}-01`;
    const decidedAfter = run.calculatedAt ?? run.createdAt;
    const late = structures.filter((structure) => structure.validFrom <= monthStart && structure.createdAt > decidedAfter && (!structure.validTo || structure.validTo >= monthStart));
    for (const structure of late) {
      const line = paid.get(`${structure.personId}:${run.month}`);
      if (!line) continue;
      const difference = await differenceFromStructures(line, run.month, entityId, executor).catch(() => null);
      if (!difference) {
        skipped.push({ personId: structure.personId, sourceMonth: run.month, reason: "recalculation_failed" });
        continue;
      }
      if (difference.amount === 0) continue;
      const item = await addRetroItem(
        { entityId, personId: structure.personId, sourceMonth: run.month, amount: difference.amount, kind: "salary_change", reason: `Quyết định lương hiệu lực từ ${structure.validFrom} được duyệt sau khi trả lương tháng ${run.month}`, insuranceBaseChanged: difference.insuranceBaseChanged, sourceRef: structure.id },
        actorPersonId,
        executor,
      ).catch(() => null);
      if (item) created.push(toView(item));
    }
  }

  return { created, skipped };
}

/**
 * What a month would have paid under the salary structures as they stand now.
 *
 * The month is **not** recalculated from scratch: the input it was paid on is replayed with new
 * segments, so attendance, leave, dependants and every figure typed into that run stay exactly as
 * they were, and the difference is the salary decision alone.
 */
async function differenceFromStructures(line: PayrollRunPersonRow, month: string, entityId: string, executor: Executor) {
  const before = openResult(line);
  const input = openInput(line);
  const period = payPeriodOf(month, input.period.standardDays);
  const [structures, days] = await Promise.all([listStructuresBetween(entityId, period.start, period.end, executor), getTimesheetDays([line.personId], period.start, period.end, executor)]);
  const mine = structures.filter((structure) => structure.personId === line.personId);
  if (mine.length === 0) throw new ActionError("no_structure");
  // `buildSegments` reads only these three figures of the locked month, and they are in the input.
  const totals = { standardDays: input.timesheet.standardDays, paidDaysCenti: input.timesheet.paidDaysCenti, unpaidDaysCenti: input.timesheet.unpaidDaysCenti };
  const segments = buildSegments(mine, totals as Parameters<typeof buildSegments>[1], period.start, period.end, days);
  return differenceBetween(before, calculatePerson(withSegments(input, segments)));
}
