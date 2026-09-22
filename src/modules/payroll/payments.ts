// Paying an approved run (FR-PAY-33, FR-PAY-39): the bank batches, the cash sheet, and the rule
// that decides when a run may be called "paid".
//
// Two channels, kept apart from end to end (SRS D18):
//   * **bank** — everyone on the Statutory profile, split by the bank their pay account is with,
//     one file per bank in that bank's own template;
//   * **cash** — everyone on the Simple profile, on a sheet the chief accountant signs off, with a
//     disbursement recorded per person and a receipt the person confirms themselves.
//
// The generated file is **not stored**: it holds every account number and every net figure in one
// place, and it can be rebuilt from the approved run whenever it is wanted. What is stored is the
// receipt — `payroll_payment_file` — saying who generated what, how many rows and what it came to.
//
// No authorization inside; the actions check `payroll:pay` over the run's entity first.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollFacts, listPayrollNames } from "@/modules/core-hr/service";
import { notify } from "@/modules/platform/notifications/service";
import { bankFormat, checkAccount, type SkippedRow, type TransferFile, type TransferRow } from "./exports/banks";
import type { CashSheetRow } from "./exports/cash-sheet";
import { cashAmountContext, paymentFileTotalContext } from "./field-contexts";
import { hasReached } from "./lifecycle";
import { openResult, type PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

export type PaymentFileRow = typeof schema.payrollPaymentFile.$inferSelect;
export type CashPaymentRow = typeof schema.payrollCashPayment.$inferSelect;

/** The narrative on an employee's bank statement: "LUONG T08/2026 — SZM". */
const narrativeFor = (month: string, entityCode: string) => {
  const [year, monthNumber] = month.split("-");
  return `LUONG T${monthNumber}/${year} ${entityCode}`;
};

// ── Who is paid how ─────────────────────────────────────────────────────────────────────────

export type PayablePerson = { personId: string; fullName: string; employeeCode: string | null; profile: "statutory" | "simple"; net: number; bankName: string | null; account: TransferRow["account"] };

/**
 * Everybody in the run with what they are owed and where it goes. The profile decides the channel:
 * Statutory is paid by transfer, Simple in cash (SRS D18) — not the presence of a bank account, so
 * a Simple-profile person who happens to have one still appears on the cash sheet.
 */
export async function listPayables(run: PayrollRunRow, executor: Executor = db()): Promise<PayablePerson[]> {
  const people = await executor.select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, run.id));
  if (people.length === 0) return [];
  const facts = await listPayrollFacts({ personIds: people.map((row) => row.personId) }, run.month, executor);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  return people
    .map((row): PayablePerson => {
      const fact = factOf.get(row.personId);
      return {
        personId: row.personId,
        fullName: fact?.fullName ?? "—",
        employeeCode: fact?.employeeCode ?? null,
        profile: row.profile,
        net: openResult(row).totals.net,
        bankName: fact?.bankAccount?.bankName ?? null,
        account: fact?.bankAccount ?? null,
      };
    })
    .sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName));
}

/**
 * Which bank each Statutory-profile person is paid through (FR-PAY-33: "employees are split by the
 * paying bank configured for them"). The name on the account is matched against the format keys;
 * anything unrecognised is reported rather than guessed at.
 */
export function bankOf(person: PayablePerson): string | null {
  const name = (person.bankName ?? "").toLowerCase();
  if (!name) return null;
  if (name.includes("vcb") || name.includes("vietcombank")) return "vcb";
  if (name.includes("acb") || name.includes("á châu") || name.includes("a chau")) return "acb";
  return null;
}

export type PaymentPlan = {
  /** Per bank format key: who it would pay and what it would come to. */
  banks: { key: string; name: string; people: PayablePerson[]; total: number }[];
  /** Statutory-profile people whose bank is not one this system can write a file for. */
  unroutable: PayablePerson[];
  cash: PayablePerson[];
  cashTotal: number;
  bankTotal: number;
};

/** What paying this run would look like, before anything is generated. */
export function planPayment(payables: readonly PayablePerson[]): PaymentPlan {
  const banks = new Map<string, PayablePerson[]>();
  const unroutable: PayablePerson[] = [];
  const cash: PayablePerson[] = [];

  for (const person of payables) {
    if (person.profile === "simple") {
      cash.push(person);
      continue;
    }
    const key = bankOf(person);
    if (key) banks.set(key, [...(banks.get(key) ?? []), person]);
    else unroutable.push(person);
  }

  const total = (people: readonly PayablePerson[]) => people.reduce((sum, person) => sum + person.net, 0);
  return {
    banks: [...banks.entries()].map(([key, people]) => ({ key, name: bankFormat(key)?.name ?? key, people, total: total(people) })),
    unroutable,
    cash,
    cashTotal: total(cash),
    bankTotal: total(payables.filter((person) => person.profile === "statutory")),
  };
}

// ── Generating a bank file (FR-PAY-33) ──────────────────────────────────────────────────────

export type GeneratedFile = { file: TransferFile; record: PaymentFileRow };

/**
 * Builds one bank's batch for a run and records that it was built. The run must have been signed
 * off by the CEO: nothing is ever handed to a bank that the CEO has not approved (SRS D17).
 */
export async function generateBankFile(input: { runId: string; bank: string; valueDate: string; payingAccount: { accountNumber: string; accountName: string; branch?: string | null } }, actorPersonId: string | null): Promise<GeneratedFile> {
  const format = bankFormat(input.bank);
  if (!format) throw new ActionError("bank_unknown");

  const [found] = await db()
    .select({ run: schema.payrollRun, entityCode: schema.entity.code })
    .from(schema.payrollRun)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payrollRun.entityId))
    .where(eq(schema.payrollRun.id, input.runId))
    .limit(1);
  if (!found) throw new ActionError("run_not_found");
  const { run, entityCode } = found;
  if (!hasReached(run, "approved")) throw new ActionError("run_not_approved", { status: run.status });

  const plan = planPayment(await listPayables(run));
  const bankPeople = plan.banks.find((group) => group.key === input.bank)?.people ?? [];
  if (bankPeople.length === 0) throw new ActionError("bank_has_nobody");

  const file = format.build({
    rows: bankPeople.map(
      (person): TransferRow => ({ personId: person.personId, employeeCode: person.employeeCode, fullName: person.fullName, amount: person.net, account: person.account, narrative: narrativeFor(run.month, entityCode) }),
    ),
    payingAccount: input.payingAccount,
    month: run.month,
    valueDate: input.valueDate,
    entityCode,
  });

  const id = crypto.randomUUID();
  const [record] = await db()
    .insert(schema.payrollPaymentFile)
    .values({
      id,
      runId: run.id,
      entityId: run.entityId,
      channel: "bank",
      bank: format.key,
      formatVersion: format.version,
      fileName: file.fileName,
      rowCount: file.rowCount,
      skippedCount: file.skipped.length,
      totalEnc: fieldCipher().encrypt(String(file.total), paymentFileTotalContext(id)),
      generatedByPersonId: actorPersonId,
    })
    .returning();

  return { file, record };
}

/** The total a generated file came to, decrypted — for the reconciliation on screen. */
export const openFileTotal = (row: PaymentFileRow): number => Number(fieldCipher().decrypt(row.totalEnc, paymentFileTotalContext(row.id)));

export async function listPaymentFiles(runId: string, executor: Executor = db()): Promise<PaymentFileRow[]> {
  return executor.select().from(schema.payrollPaymentFile).where(eq(schema.payrollPaymentFile.runId, runId)).orderBy(asc(schema.payrollPaymentFile.generatedAt));
}

// ── The cash sheet (FR-PAY-39) ──────────────────────────────────────────────────────────────

/**
 * Opens (or re-opens) the cash sheet of a run: one row per Simple-profile person, with the net
 * frozen from the run. Idempotent — a row that is already there keeps its disbursement.
 */
export async function openCashSheet(runId: string, actorPersonId: string | null): Promise<{ rows: CashPaymentRow[]; created: number }> {
  const created = await db().transaction(async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1);
    if (!run) throw new ActionError("run_not_found");
    if (!hasReached(run, "approved")) throw new ActionError("run_not_approved", { status: run.status });

    const cash = planPayment(await listPayables(run, tx)).cash;
    if (cash.length === 0) return [];

    const existing = await tx.select({ personId: schema.payrollCashPayment.personId }).from(schema.payrollCashPayment).where(eq(schema.payrollCashPayment.runId, runId));
    const have = new Set(existing.map((row) => row.personId));
    const missing = cash.filter((person) => !have.has(person.personId));
    if (missing.length === 0) return [];

    const values = missing.map((person) => {
      const id = crypto.randomUUID();
      return { id, runId, personId: person.personId, entityId: run.entityId, amountEnc: fieldCipher().encrypt(String(person.net), cashAmountContext(id)) };
    });
    return tx.insert(schema.payrollCashPayment).values(values).onConflictDoNothing().returning();
  });

  // Whoever is waiting for cash is told there is something to collect and confirm — not how much.
  if (created.length > 0) {
    const [run] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1);
    await notify({ recipients: created.map((row) => row.personId), kind: "payroll.cash_receipt_due", params: { month: run?.month ?? "" }, link: "/payslips" });
  }
  void actorPersonId;
  return { rows: await listCashPayments(runId), created: created.length };
}

export async function listCashPayments(runId: string, executor: Executor = db()): Promise<CashPaymentRow[]> {
  return executor.select().from(schema.payrollCashPayment).where(eq(schema.payrollCashPayment.runId, runId));
}

export const openCashAmount = (row: CashPaymentRow): number => Number(fieldCipher().decrypt(row.amountEnc, cashAmountContext(row.id)));

/** The sheet as the printer and the screen want it: names, amounts, and what has happened so far. */
export async function cashSheetRows(run: PayrollRunRow): Promise<CashSheetRow[]> {
  const rows = await listCashPayments(run.id);
  if (rows.length === 0) return [];
  return cashSheetOf(rows, await listPayrollNames(rows.map((row) => row.personId)));
}

/** The same from rows already read — the payments screen has the names from its payables. */
export function cashSheetOf(rows: readonly CashPaymentRow[], names: readonly { personId: string; fullName: string; employeeCode: string | null }[]): CashSheetRow[] {
  const nameOf = new Map(names.map((name) => [name.personId, name]));
  return rows
    .map((row) => ({
      personId: row.personId,
      employeeCode: nameOf.get(row.personId)?.employeeCode ?? null,
      fullName: nameOf.get(row.personId)?.fullName ?? "—",
      amount: openCashAmount(row),
      disbursedOn: row.disbursedOn,
      receiptConfirmed: !!row.receiptConfirmedAt,
    }))
    .sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName));
}

/** The chief accountant records handing the money over. */
export async function recordCashDisbursement(input: { runId: string; personId: string; disbursedOn: string; note?: string | null }, payerPersonId: string): Promise<CashPaymentRow> {
  const [row] = await db()
    .update(schema.payrollCashPayment)
    .set({ disbursedOn: input.disbursedOn, disbursedByPersonId: payerPersonId, disbursementNote: input.note ?? null, updatedAt: new Date() })
    .where(and(eq(schema.payrollCashPayment.runId, input.runId), eq(schema.payrollCashPayment.personId, input.personId)))
    .returning();
  if (!row) throw new ActionError("cash_payment_not_found");
  return row;
}

/** The person confirms they got it. Only they can — the action checks that it is their own row. */
export async function confirmCashReceipt(runId: string, personId: string): Promise<CashPaymentRow> {
  const [row] = await db()
    .update(schema.payrollCashPayment)
    .set({ receiptConfirmedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.payrollCashPayment.runId, runId), eq(schema.payrollCashPayment.personId, personId)))
    .returning();
  if (!row) throw new ActionError("cash_payment_not_found");
  return row;
}

/** One person's cash row in a run, for an action deciding whether it is theirs to confirm. */
export async function getCashPayment(runId: string, personId: string): Promise<CashPaymentRow | null> {
  const [row] = await db().select().from(schema.payrollCashPayment).where(and(eq(schema.payrollCashPayment.runId, runId), eq(schema.payrollCashPayment.personId, personId))).limit(1);
  return row ?? null;
}

/** Every cash row waiting for *this person* to confirm, across runs — shown beside their payslips. */
export async function listCashAwaitingReceipt(personId: string): Promise<{ runId: string; month: string; amount: number; disbursedOn: string | null }[]> {
  const rows = await db()
    .select({ payment: schema.payrollCashPayment, month: schema.payrollRun.month })
    .from(schema.payrollCashPayment)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollCashPayment.runId))
    .where(and(eq(schema.payrollCashPayment.personId, personId), isNull(schema.payrollCashPayment.receiptConfirmedAt)));
  return rows.map((row) => ({ runId: row.payment.runId, month: row.month, amount: openCashAmount(row.payment), disbursedOn: row.payment.disbursedOn }));
}

// ── When may a run be called "paid"? (FR-PAY-39) ────────────────────────────────────────────

export type Settlement = {
  /** Statutory-profile people the run owes money to. */
  bankPeople: number;
  /** How many of them a generated batch covers. */
  bankCovered: number;
  bankFiles: number;
  cashPeople: number;
  cashDisbursed: number;
  cashConfirmed: number;
  /** Statutory-profile people whose bank has no format, or whose account a format refused. */
  unpaidBank: { personId: string; fullName: string; reason: SkippedRow["reason"] | "no_format_for_bank" }[];
  /** Everything that has to be true before "paid" may be recorded. */
  blockers: ("bank_file_missing" | "bank_people_uncovered" | "cash_not_disbursed")[];
  settled: boolean;
};

/**
 * "The run is 'Paid' only when the bank batch and the cash sheet are both settled" (FR-PAY-39).
 *
 * Settled means: a batch has been generated for every bank that owes somebody money and it covered
 * them all, and every cash row has a disbursement recorded. The employee's **receipt confirmation
 * is not required** — the money has left the company either way, and a person on leave should not
 * hold a month open; what is unconfirmed is reported instead, and chased.
 */
export async function settlementOf(run: PayrollRunRow, executor: Executor = db()): Promise<Settlement> {
  // The executor is threaded through on purpose: the lifecycle asks this **inside** the
  // transaction that moves the run to "paid", so the answer must come from that same snapshot —
  // and on one connection a second one would simply wait for the first for ever.
  const [payables, files, cash] = await Promise.all([listPayables(run, executor), listPaymentFiles(run.id, executor), listCashPayments(run.id, executor)]);
  return settle(planPayment(payables), files, cash);
}

/** The settlement worked out from what has already been read — no queries (the payments screen has it all). */
export function settle(plan: PaymentPlan, files: readonly PaymentFileRow[], cash: readonly CashPaymentRow[]): Settlement {
  const bankPeople = plan.banks.reduce((count, group) => count + group.people.length, 0) + plan.unroutable.length;
  const covered = plan.banks.filter((group) => files.some((file) => file.bank === group.key)).reduce((count, group) => count + group.people.length, 0);
  const bankFiles = files.filter((file) => file.channel === "bank");
  const skippedByFiles = bankFiles.reduce((count, file) => count + file.skippedCount, 0);

  // Why each of them cannot be transferred to, said precisely: "no account on file" and "we have
  // no file format for that bank" are different problems with different fixes.
  const unpaidBank = [
    ...plan.unroutable.map((person) => ({ personId: person.personId, fullName: person.fullName, reason: (person.account?.accountNumber ? "no_format_for_bank" : "no_account") as SkippedRow["reason"] | "no_format_for_bank" })),
    ...plan.banks.flatMap((group) => group.people.map((person) => ({ person, reason: checkAccount({ personId: person.personId, employeeCode: person.employeeCode, fullName: person.fullName, amount: person.net, account: person.account, narrative: "" }) })).filter((row) => row.reason).map((row) => ({ personId: row.person.personId, fullName: row.person.fullName, reason: row.reason! }))),
  ];

  const cashDisbursed = cash.filter((row) => row.disbursedOn).length;
  const blockers: Settlement["blockers"] = [];
  if (bankPeople > 0 && bankFiles.length === 0) blockers.push("bank_file_missing");
  // Everybody the bank channel owes must be inside a generated batch — including anyone a format
  // refused, who has to be paid another way before the month can be called done.
  if (bankPeople > 0 && (covered < bankPeople || skippedByFiles > 0)) blockers.push("bank_people_uncovered");
  if (cash.length > 0 && cashDisbursed < cash.length) blockers.push("cash_not_disbursed");
  // A Simple-profile person with no cash row at all means the sheet was never opened.
  if (plan.cash.length > 0 && cash.length === 0) blockers.push("cash_not_disbursed");

  return {
    bankPeople,
    bankCovered: covered,
    bankFiles: bankFiles.length,
    cashPeople: cash.length,
    cashDisbursed,
    cashConfirmed: cash.filter((row) => row.receiptConfirmedAt).length,
    unpaidBank,
    blockers,
    settled: blockers.length === 0,
  };
}
