// Paying an approved run (FR-PAY-33, FR-PAY-39): the bank batches, the cash sheet, and the rule
// that decides when a run may be called "paid".
//
// Two channels, kept apart from end to end (SRS D18):
//   * **bank** — everyone on the Statutory profile. Somebody who banks with one of the banks we
//     have a file format for goes into that bank's file; somebody who banks elsewhere goes into
//     the file whose layout carries a beneficiary bank (an interbank row); and anyone no file can
//     carry is paid by hand and recorded as **paid another way** (`routeOf` is the whole rule);
//   * **cash** — everyone on the Simple profile, on a sheet the chief accountant signs off, with a
//     disbursement recorded per person and a receipt the person confirms themselves.
//
// Somebody the run owes nothing — a net of zero, or a negative one — is in neither channel and
// never holds the month open: there is nothing to pay them.
//
// The generated file is **not stored**: it holds every account number and every net figure in one
// place, and it can be rebuilt from the approved run whenever it is wanted. What is stored is the
// receipt — `payroll_payment_file` — saying who generated what, how many rows, what it came to and
// whom it carried. Only the **latest** file of a bank counts; one generated again supersedes it.
//
// No authorization inside; the actions check `payroll:pay` over the run's entity first.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollFacts, listPayrollNames } from "@/modules/core-hr/service";
import { listFilesOf, type StoredFileRow } from "@/modules/platform/files/service";
import { notify } from "@/modules/platform/notifications/service";
import { type EntityBankAccountRow, listEntityBankAccounts } from "@/modules/platform/org/service";
import { BANK_KEYS, bankFormat, checkAccount, formatOfBankName, interbankFormat, type PayingAccount, type SkippedRow, type TransferFile, type TransferRow } from "./exports/banks";
import type { CashSheetRow } from "./exports/cash-sheet";
import { cashAmountContext, cashDisbursedContext, paymentFileTotalContext } from "./field-contexts";
import { hasReached } from "./lifecycle";
import { openResult, type PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

export type PaymentFileRow = typeof schema.payrollPaymentFile.$inferSelect;
export type CashPaymentRow = typeof schema.payrollCashPayment.$inferSelect;
export type OtherPaymentRow = typeof schema.payrollOtherPayment.$inferSelect;

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
    .sort(byCodeThenName);
}

const byCodeThenName = (left: { employeeCode: string | null; fullName: string }, right: { employeeCode: string | null; fullName: string }) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName);

/**
 * The bank a person's own pay account is with, when it is one we have a file format for. The name
 * on the account is matched against each format's own aliases; anything else answers null.
 */
export function bankOf(person: PayablePerson): string | null {
  return formatOfBankName(person.bankName)?.key ?? null;
}

/** Why no file can carry somebody as their pay account stands. */
export type RouteProblem = "no_account" | "no_bank_name" | "no_format_for_bank";

export type Route =
  | { channel: "cash" }
  /** `own_bank`: an in-house transfer inside that bank's file. `interbank`: a row that names another bank. */
  | { channel: "bank"; bank: string; via: "own_bank" | "interbank" }
  | { channel: "none"; reason: RouteProblem };

/**
 * **The routing rule, whole** (FR-PAY-33) — the payment screen shows its answer for every person:
 *
 *  1. Simple profile → the cash sheet (SRS D18), whatever account is on file.
 *  2. Statutory, and the pay account is with a bank we have a format for → that bank's file.
 *     People are split by **their own bank**, read off the account's bank name; there is no
 *     separate "paying bank" setting per person.
 *  3. Statutory, banking anywhere else → the file of the format that carries a beneficiary bank on
 *     each row (ACB's, as assumed in `exports/banks/acb.ts`), as an interbank row.
 *  4. No account on file, an account with no bank name, or no interbank format at all → no file:
 *     the account is put right, or the person is paid by hand and marked "paid another way".
 */
export function routeOf(person: PayablePerson): Route {
  if (person.profile === "simple") return { channel: "cash" };
  if (!person.account?.accountNumber?.trim()) return { channel: "none", reason: "no_account" };
  const own = bankOf(person);
  if (own) return { channel: "bank", bank: own, via: "own_bank" };
  if (!(person.bankName ?? "").trim()) return { channel: "none", reason: "no_bank_name" };
  const carrier = interbankFormat();
  return carrier ? { channel: "bank", bank: carrier.key, via: "interbank" } : { channel: "none", reason: "no_format_for_bank" };
}

export type PaymentPlan = {
  /** Per bank format key: who it would pay and what it would come to. `interbank` = how many of them bank elsewhere. */
  banks: { key: string; name: string; people: PayablePerson[]; total: number; interbank: number }[];
  /** Statutory-profile people owed money whom no file can carry (rule 4). */
  unroutable: PayablePerson[];
  cash: PayablePerson[];
  /** A net of exactly zero — a full month of maternity leave: nothing is owed and nothing is paid. */
  nothingOwed: PayablePerson[];
  /** A negative net: nothing to pay; the figure is C&B's to recover next month, not a payment. */
  negative: PayablePerson[];
  cashTotal: number;
  /** What the bank channel owes — the people with something to receive, wherever they bank. */
  bankTotal: number;
};

/** What paying this run would look like, before anything is generated. Only people owed money are in a channel. */
export function planPayment(payables: readonly PayablePerson[]): PaymentPlan {
  const banks = new Map<string, PayablePerson[]>();
  const unroutable: PayablePerson[] = [];
  const cash: PayablePerson[] = [];
  const nothingOwed: PayablePerson[] = [];
  const negative: PayablePerson[] = [];

  for (const person of payables) {
    if (person.net === 0) nothingOwed.push(person);
    else if (person.net < 0) negative.push(person);
    else {
      const route = routeOf(person);
      if (route.channel === "cash") cash.push(person);
      else if (route.channel === "bank") banks.set(route.bank, [...(banks.get(route.bank) ?? []), person]);
      else unroutable.push(person);
    }
  }

  const total = (people: readonly PayablePerson[]) => people.reduce((sum, person) => sum + person.net, 0);
  const groups = [...banks.entries()].sort(([left], [right]) => BANK_KEYS.indexOf(left) - BANK_KEYS.indexOf(right));
  return {
    banks: groups.map(([key, people]) => ({ key, name: bankFormat(key)?.name ?? key, people, total: total(people), interbank: people.filter((person) => bankOf(person) !== key).length })),
    unroutable,
    cash,
    nothingOwed,
    negative,
    cashTotal: total(cash),
    bankTotal: total(groups.flatMap(([, people]) => people)) + total(unroutable),
  };
}

const transferRowOf = (person: PayablePerson, narrative: string): TransferRow => ({ personId: person.personId, employeeCode: person.employeeCode, fullName: person.fullName, amount: person.net, account: person.account, narrative });

// ── Generating a bank file (FR-PAY-33) ──────────────────────────────────────────────────────

export type GeneratedFile = { file: TransferFile; record: PaymentFileRow };

/**
 * The company account a batch debits. Where the entity has paying accounts at the bank (FR-PLT-11)
 * it is one of them — picked, never typed, so a mistyped digit cannot reach a file; left unpicked,
 * the bank's default is taken. Only an entity with none configured at that bank still types one.
 */
function payingAccountFor(configured: readonly EntityBankAccountRow[], input: { payingAccountId?: string | null; payingAccount?: PayingAccount | null }): { account: PayingAccount; id: string | null } {
  if (configured.length > 0) {
    const chosen = input.payingAccountId ? configured.find((row) => row.id === input.payingAccountId) : (configured.find((row) => row.isDefault) ?? configured[0]);
    if (!chosen) throw new ActionError("paying_account_not_found");
    return { account: { accountNumber: chosen.accountNumber, accountName: chosen.accountName, branch: chosen.branch }, id: chosen.id };
  }
  if (!input.payingAccount?.accountNumber?.trim() || !input.payingAccount.accountName?.trim()) throw new ActionError("paying_account_required");
  return { account: input.payingAccount, id: null };
}

/**
 * Builds one bank's batch for a run and records that it was built. The run must have been signed
 * off by the CEO: nothing is ever handed to a bank that the CEO has not approved (SRS D17).
 *
 * The batch holds everyone routed to the bank who is owed money and has not been paid another
 * way. Generating it again is how a corrected account gets in: the new file supersedes the old.
 */
export async function generateBankFile(input: { runId: string; bank: string; valueDate: string; payingAccountId?: string | null; payingAccount?: PayingAccount | null }, actorPersonId: string | null): Promise<GeneratedFile> {
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

  const [payables, others, accounts] = await Promise.all([listPayables(run), listOtherPayments(run.id), listEntityBankAccounts(run.entityId, { activeOnly: true })]);
  const paidAnotherWay = new Set(others.map((row) => row.personId));
  const bankPeople = (planPayment(payables).banks.find((group) => group.key === input.bank)?.people ?? []).filter((person) => !paidAnotherWay.has(person.personId));
  if (bankPeople.length === 0) throw new ActionError("bank_has_nobody");
  const paying = payingAccountFor(accounts.filter((row) => row.bank === format.key), input);

  const narrative = narrativeFor(run.month, entityCode);
  const file = format.build({ rows: bankPeople.map((person) => transferRowOf(person, narrative)), payingAccount: paying.account, month: run.month, valueDate: input.valueDate, entityCode });
  const skipped = new Set(file.skipped.map((row) => row.personId));

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
      coveredPersonIds: bankPeople.filter((person) => !skipped.has(person.personId)).map((person) => person.personId),
      payingAccountId: paying.id,
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

/**
 * The batch that counts for each bank: the last one generated. Every earlier file of that bank is
 * **superseded** — kept as a receipt of what was once built, and counted for nothing.
 */
export function latestBankFiles(files: readonly PaymentFileRow[]): Map<string, PaymentFileRow> {
  const latest = new Map<string, PaymentFileRow>();
  for (const file of files) {
    if (file.channel !== "bank" || !file.bank) continue;
    const current = latest.get(file.bank);
    if (!current || file.generatedAt.getTime() >= current.generatedAt.getTime()) latest.set(file.bank, file);
  }
  return latest;
}

// ── Paid another way (PAY-05) ───────────────────────────────────────────────────────────────

export async function listOtherPayments(runId: string, executor: Executor = db()): Promise<OtherPaymentRow[]> {
  return executor.select().from(schema.payrollOtherPayment).where(eq(schema.payrollOtherPayment.runId, runId));
}

/** Between the CEO's signature and "paid": the only stretch in which how a run is paid may still be written down. */
const isBeingPaid = (run: Pick<PayrollRunRow, "status">): boolean => hasReached(run, "approved") && !hasReached(run, "paid");

/**
 * The chief accountant records that one person on the bank channel was paid outside every batch —
 * the day, the bank's reference and why. It settles that person and keeps them out of any file
 * generated afterwards, so a regenerated batch cannot pay them twice. Recording it again corrects it.
 */
export async function recordOtherPayment(input: { runId: string; personId: string; paidOn: string; reference: string; reason: string }, actorPersonId: string): Promise<OtherPaymentRow> {
  const reference = input.reference.trim();
  const reason = input.reason.trim();
  if (!reference) throw new ActionError("reference_required");
  if (!reason) throw new ActionError("reason_required");

  return db().transaction(async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, input.runId)).limit(1).for("update");
    if (!run) throw new ActionError("run_not_found");
    if (!hasReached(run, "approved")) throw new ActionError("run_not_approved", { status: run.status });
    if (!isBeingPaid(run)) throw new ActionError("run_already_paid");

    const [line] = await tx.select().from(schema.payrollRunPerson).where(and(eq(schema.payrollRunPerson.runId, run.id), eq(schema.payrollRunPerson.personId, input.personId))).limit(1);
    // Only somebody the bank channel owes money: cash has its own sheet, and a net of zero or below is not a payment.
    if (!line || line.profile !== "statutory" || openResult(line).totals.net <= 0) throw new ActionError("other_payment_not_applicable");

    const values = { paidOn: input.paidOn, reference, reason, recordedByPersonId: actorPersonId };
    const [row] = await tx
      .insert(schema.payrollOtherPayment)
      .values({ runId: run.id, personId: input.personId, entityId: run.entityId, ...values })
      .onConflictDoUpdate({ target: [schema.payrollOtherPayment.runId, schema.payrollOtherPayment.personId], set: { ...values, updatedAt: new Date() } })
      .returning();
    return row;
  });
}

/** Taking the mark back — a mistake, or the account was fixed and the person goes into a batch after all. */
export async function removeOtherPayment(runId: string, personId: string): Promise<OtherPaymentRow> {
  return db().transaction(async (tx) => {
    const [run] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!run) throw new ActionError("run_not_found");
    if (!isBeingPaid(run)) throw new ActionError("run_already_paid");
    const [row] = await tx.delete(schema.payrollOtherPayment).where(and(eq(schema.payrollOtherPayment.runId, runId), eq(schema.payrollOtherPayment.personId, personId))).returning();
    if (!row) throw new ActionError("other_payment_not_found");
    return row;
  });
}

// ── The cash sheet (FR-PAY-39) ──────────────────────────────────────────────────────────────

/**
 * Opens (or re-opens) the cash sheet of a run: one row per Simple-profile person who is owed
 * money, with the net frozen from the run. Idempotent — a row that is already there keeps its
 * disbursement.
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

/**
 * What was actually handed over on a row, or null while nothing has been. A row disbursed before
 * the amount was recorded separately reads as paid in full — that is what "disbursed" meant then.
 */
export const openCashDisbursed = (row: CashPaymentRow): number | null => {
  if (!row.disbursedOn) return null;
  return row.disbursedAmountEnc ? Number(fieldCipher().decrypt(row.disbursedAmountEnc, cashDisbursedContext(row.id))) : openCashAmount(row);
};

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
      disbursedAmount: openCashDisbursed(row),
      note: row.disbursementNote,
      receiptConfirmed: !!row.receiptConfirmedAt,
    }))
    .sort(byCodeThenName);
}

/**
 * The chief accountant records handing the money over: the day, and **how much** — the person's
 * net unless said otherwise. A figure that differs from the net must carry a note saying why
 * (an advance already taken, the rest to follow), because the sheet has to reconcile.
 * Recording it again, while the run is not locked, corrects it.
 */
export async function recordCashDisbursement(input: { runId: string; personId: string; disbursedOn: string; amount?: number | null; note?: string | null }, payerPersonId: string): Promise<CashPaymentRow> {
  const note = input.note?.trim() || null;
  return db().transaction(async (tx) => {
    const where = and(eq(schema.payrollCashPayment.runId, input.runId), eq(schema.payrollCashPayment.personId, input.personId));
    const [existing] = await tx.select().from(schema.payrollCashPayment).where(where).limit(1).for("update");
    if (!existing) throw new ActionError("cash_payment_not_found");

    const net = openCashAmount(existing);
    const amount = input.amount ?? net;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new ActionError("amount_invalid");
    if (amount !== net && !note) throw new ActionError("cash_difference_needs_note");

    const [row] = await tx
      .update(schema.payrollCashPayment)
      .set({ disbursedOn: input.disbursedOn, disbursedByPersonId: payerPersonId, disbursementNote: note, disbursedAmountEnc: fieldCipher().encrypt(String(amount), cashDisbursedContext(existing.id)), updatedAt: new Date() })
      .where(where)
      .returning();
    return row;
  });
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

/**
 * Every cash row waiting for *this person* to confirm, across runs — shown beside their payslips.
 * `amount` is what they are asked to confirm having taken: what was actually handed over once it
 * has been recorded, their net until then.
 */
export async function listCashAwaitingReceipt(personId: string): Promise<{ runId: string; month: string; amount: number; disbursedOn: string | null }[]> {
  const rows = await db()
    .select({ payment: schema.payrollCashPayment, month: schema.payrollRun.month })
    .from(schema.payrollCashPayment)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollCashPayment.runId))
    .where(and(eq(schema.payrollCashPayment.personId, personId), isNull(schema.payrollCashPayment.receiptConfirmedAt)));
  return rows.map((row) => ({ runId: row.payment.runId, month: row.month, amount: openCashDisbursed(row.payment) ?? openCashAmount(row.payment), disbursedOn: row.payment.disbursedOn }));
}

// ── The signed sheet, scanned (FR-PAY-39) ───────────────────────────────────────────────────

/**
 * The printed sheet, signed and scanned, belongs to the run (and so to its entity). It names
 * people and what each took home, so it is stored at the **compensation** tier: the files module
 * then writes every opening of it to the audit log. The files themselves say who attached them.
 */
export const CASH_SHEET_SCAN = "payroll_cash_sheet";
export const cashSheetScanOwner = (run: Pick<PayrollRunRow, "id" | "entityId">) => ({ ownerType: CASH_SHEET_SCAN, ownerId: run.id, entityId: run.entityId, tier: "compensation" as const });

export async function listCashSheetScans(runId: string): Promise<StoredFileRow[]> {
  return listFilesOf(CASH_SHEET_SCAN, runId);
}

// ── When may a run be called "paid"? (FR-PAY-39) ────────────────────────────────────────────

/** Where one person's pay stands. */
export type PaymentState = "in_file" | "awaiting_file" | "cannot_transfer" | "paid_other" | "cash_disbursed" | "cash_pending" | "nothing_owed" | "negative_net";

/** One person of the run on the payment screen: where their pay goes, why, and how far it has got. */
export type PersonPayment = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  profile: "statutory" | "simple";
  net: number;
  bankName: string | null;
  route: Route;
  state: PaymentState;
  /** Why no file can carry them as things stand — the route's own reason, or the account the format refuses. */
  problem: RouteProblem | SkippedRow["reason"] | null;
  other: OtherPaymentRow | null;
};

export type Settlement = {
  /** Statutory-profile people the run owes money to. */
  bankPeople: number;
  /** How many of them are inside the latest batch of their bank, or were paid another way. */
  bankCovered: number;
  bankFiles: number;
  /** The files that count: the latest of each bank. Any other bank file is superseded. */
  latestFileIds: string[];
  paidAnotherWay: number;
  cashPeople: number;
  cashDisbursed: number;
  cashConfirmed: number;
  /** The cash sheet reconciled: what the rows owe, and what was actually handed over so far. */
  cashNet: number;
  cashDisbursedTotal: number;
  /** Statutory-profile people no file can carry and nobody has paid another way yet. */
  unpaidBank: { personId: string; fullName: string; reason: SkippedRow["reason"] | RouteProblem }[];
  /** Everybody in the run, in the order of the register. */
  people: PersonPayment[];
  /** Everything that has to be true before "paid" may be recorded. */
  blockers: ("bank_file_missing" | "bank_people_uncovered" | "cash_not_disbursed" | "cash_difference_unexplained")[];
  settled: boolean;
};

/**
 * "The run is 'Paid' only when the bank batch and the cash sheet are both settled" (FR-PAY-39).
 *
 * Settled means, person by person:
 *   * bank — they are inside the **latest** batch generated for the bank they are routed to, or
 *     the accountant recorded paying them another way;
 *   * cash — a disbursement is recorded, and it is in full, or carries a note for the difference,
 *     or the person has confirmed what they took;
 *   * owed nothing (a zero or negative net) — settled as they stand.
 *
 * The employee's **receipt confirmation is not required** — the money has left the company either
 * way, and a person on leave should not hold a month open; what is unconfirmed is reported
 * instead, and chased.
 */
export async function settlementOf(run: PayrollRunRow, executor: Executor = db()): Promise<Settlement> {
  // The executor is threaded through on purpose: the lifecycle asks this **inside** the
  // transaction that moves the run to "paid", so the answer must come from that same snapshot —
  // and on one connection a second one would simply wait for the first for ever.
  const [payables, files, cash, others] = await Promise.all([listPayables(run, executor), listPaymentFiles(run.id, executor), listCashPayments(run.id, executor), listOtherPayments(run.id, executor)]);
  return settle(planPayment(payables), files, cash, others);
}

/** Is this cash row done with? Handed over — and in full, explained, or confirmed by the person. */
const cashRowSettled = (row: CashPaymentRow): boolean => !!row.disbursedOn && (openCashDisbursed(row) === openCashAmount(row) || !!row.disbursementNote || !!row.receiptConfirmedAt);

/** The settlement worked out from what has already been read — no queries (the payments screen has it all). */
export function settle(plan: PaymentPlan, files: readonly PaymentFileRow[], cash: readonly CashPaymentRow[], others: readonly OtherPaymentRow[] = []): Settlement {
  const bankFiles = files.filter((file) => file.channel === "bank");
  const latest = latestBankFiles(bankFiles);
  const otherOf = new Map(others.map((row) => [row.personId, row]));
  const cashOf = new Map(cash.map((row) => [row.personId, row]));
  const base = (person: PayablePerson) => ({ personId: person.personId, fullName: person.fullName, employeeCode: person.employeeCode, profile: person.profile, net: person.net, bankName: person.bankName });

  const banked = plan.banks.flatMap((group) =>
    group.people.map((person): PersonPayment => {
      const other = otherOf.get(person.personId) ?? null;
      const inLatest = latest.get(group.key)?.coveredPersonIds.includes(person.personId) ?? false;
      // Why the format would leave them out — "no holder" and "not a number" have different fixes.
      const refused = checkAccount(transferRowOf(person, ""));
      const state: PaymentState = other ? "paid_other" : inLatest ? "in_file" : refused ? "cannot_transfer" : "awaiting_file";
      return { ...base(person), route: routeOf(person), state, problem: state === "cannot_transfer" ? refused : null, other };
    }),
  );
  const unroutable = plan.unroutable.map((person): PersonPayment => {
    const route = routeOf(person);
    const other = otherOf.get(person.personId) ?? null;
    return { ...base(person), route, state: other ? "paid_other" : "cannot_transfer", problem: other || route.channel !== "none" ? null : route.reason, other };
  });
  const cashPeople = plan.cash.map((person): PersonPayment => {
    const row = cashOf.get(person.personId);
    return { ...base(person), route: { channel: "cash" }, state: row && cashRowSettled(row) ? "cash_disbursed" : "cash_pending", problem: null, other: null };
  });
  const owedNothing = [...plan.nothingOwed.map((person) => ({ person, state: "nothing_owed" as const })), ...plan.negative.map((person) => ({ person, state: "negative_net" as const }))].map(({ person, state }): PersonPayment => ({ ...base(person), route: routeOf(person), state, problem: null, other: null }));

  const bank = [...banked, ...unroutable];
  const waiting = banked.filter((person) => person.state === "awaiting_file");
  const stuck = bank.filter((person) => person.state === "cannot_transfer");
  const bankOfRoute = (person: PersonPayment) => (person.route.channel === "bank" ? person.route.bank : "");

  const blockers = new Set<Settlement["blockers"][number]>();
  // A bank that owes somebody money and has no batch at all…
  if (waiting.some((person) => !latest.has(bankOfRoute(person)))) blockers.add("bank_file_missing");
  // …and anybody the latest batch of their bank left out, or whom no batch can carry.
  if (stuck.length > 0 || waiting.some((person) => latest.has(bankOfRoute(person)))) blockers.add("bank_people_uncovered");
  // Cash: a person with no row means the sheet was never opened for them.
  if (plan.cash.some((person) => !cashOf.get(person.personId)?.disbursedOn)) blockers.add("cash_not_disbursed");
  if (plan.cash.some((person) => !!cashOf.get(person.personId)?.disbursedOn && !cashRowSettled(cashOf.get(person.personId)!))) blockers.add("cash_difference_unexplained");

  const disbursedRows = cash.filter((row) => row.disbursedOn);
  return {
    bankPeople: bank.length,
    bankCovered: bank.filter((person) => person.state === "in_file" || person.state === "paid_other").length,
    bankFiles: bankFiles.length,
    latestFileIds: [...latest.values()].map((file) => file.id),
    paidAnotherWay: bank.filter((person) => person.state === "paid_other").length,
    cashPeople: cash.length,
    cashDisbursed: disbursedRows.length,
    cashConfirmed: cash.filter((row) => row.receiptConfirmedAt).length,
    cashNet: cash.reduce((sum, row) => sum + openCashAmount(row), 0),
    cashDisbursedTotal: disbursedRows.reduce((sum, row) => sum + (openCashDisbursed(row) ?? 0), 0),
    unpaidBank: stuck.map((person) => ({ personId: person.personId, fullName: person.fullName, reason: person.problem! })),
    people: [...bank, ...cashPeople, ...owedNothing].sort(byCodeThenName),
    blockers: [...blockers],
    settled: blockers.size === 0,
  };
}
