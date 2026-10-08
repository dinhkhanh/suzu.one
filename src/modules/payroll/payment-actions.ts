"use server";
// Paying a run (FR-PAY-33, FR-PAY-39). `payroll:pay` over the run's entity — the chief accountant —
// except for the receipt, which only the person who took the cash may give.
//
// A generated bank file comes back **through the action's result**, as text, and is saved by the
// browser; it is never written to storage (see `payments.ts`). The audit row says which bank, how
// many rows and which run — never a figure, and never an account number.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { beginUpload, completeUpload, createDownloadLink, findFile, softDeleteFile } from "@/modules/platform/files/service";
import { hasReached, isLocked } from "./lifecycle";
import { CASH_SHEET_SCAN, cashSheetScanOwner, confirmCashReceipt, generateBankFile, getCashPayment, openCashAmount, openCashDisbursed, openCashSheet, recordCashDisbursement, recordOtherPayment, removeOtherPayment } from "./payments";
import { canManageCompensation, canPayPayroll } from "./policy";
import { getRun } from "./runs";

const refresh = (runId: string) => {
  revalidatePath(`/payroll/runs/${runId}/payments`);
  revalidatePath(`/payroll/runs/${runId}`);
};

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
/** Whole đồng, as `MoneyInput` posts it ("1500000") or as a number; blank = not given. */
const optionalVnd = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? null : Number(value.replace(/[.,\s_]/g, ""))) : value), z.number().int().min(0).max(100_000_000_000).nullable().default(null));

/** The accountant pays; C&B prepare the cash sheet beside them. Both answer for the run's entity. */
const paysRun = async (user: CurrentUser, runId: string) => {
  const run = await getRun(runId);
  return !!run && canPayPayroll(user.principal, run);
};
const paysOrPrepares = async (user: CurrentUser, runId: string) => {
  const run = await getRun(runId);
  return !!run && (canPayPayroll(user.principal, run) || canManageCompensation(user.principal, run));
};

const generatePipeline = createAction({
  name: "payroll_payment.generate_bank_file",
  stepUp: true,
  input: z.object({
    runId: z.uuid(),
    bank: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),
    valueDate: z.iso.date(),
    // One of the entity's own paying accounts (FR-PLT-11)…
    payingAccountId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
    // …or, only for an entity with none configured at this bank, an account typed by hand.
    accountNumber: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .regex(/^[\d\s-]{6,32}$/)
        .nullable()
        .default(null),
    ),
    accountName: optionalText(160),
    branch: optionalText(160),
  }),
  authorize: (user, input) => paysRun(user, input.runId),
  run: async ({ user, input }) => {
    const { file, record } = await generateBankFile(
      {
        runId: input.runId,
        bank: input.bank,
        valueDate: input.valueDate,
        payingAccountId: input.payingAccountId,
        payingAccount: input.accountNumber && input.accountName ? { accountNumber: input.accountNumber, accountName: input.accountName, branch: input.branch } : null,
      },
      user.person.id,
    );
    refresh(input.runId);
    return {
      // The file's text goes to the browser that asked for it and nowhere else.
      data: { fileName: file.fileName, content: file.content, contentType: file.contentType, rowCount: file.rowCount, skipped: file.skipped },
      audit: {
        resource: { type: "payroll_payment_file", id: record.id, entityId: record.entityId },
        summary: `${input.bank} batch for run ${input.runId}`,
        after: { bank: input.bank, formatVersion: record.formatVersion, rowCount: record.rowCount, skipped: record.skippedCount, valueDate: input.valueDate, payingAccountId: record.payingAccountId },
      },
    };
  },
});
export async function generateBankFileAction(input: unknown) {
  return generatePipeline(input);
}

// ── Paid another way (PAY-05) ───────────────────────────────────────────────────────────────

const otherPaymentPipeline = createAction({
  name: "payroll_payment.record_other_payment",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid(), paidOn: z.iso.date(), reference: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(300) }),
  authorize: (user, input) => paysRun(user, input.runId),
  run: async ({ user, input }) => {
    const row = await recordOtherPayment(input, user.person.id);
    refresh(input.runId);
    // The day, the reference and the reason are the record; what the person was paid is not written here.
    return {
      data: { id: row.id },
      audit: {
        resource: { type: "payroll_other_payment", id: row.id, entityId: row.entityId },
        summary: `paid another way on ${row.paidOn}`,
        after: { personId: row.personId, paidOn: row.paidOn, reference: row.reference, reason: row.reason },
      },
    };
  },
});
export async function recordOtherPaymentAction(input: unknown) {
  return otherPaymentPipeline(input);
}

const removeOtherPaymentPipeline = createAction({
  name: "payroll_payment.remove_other_payment",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid() }),
  authorize: (user, input) => paysRun(user, input.runId),
  run: async ({ input }) => {
    const row = await removeOtherPayment(input.runId, input.personId);
    refresh(input.runId);
    return {
      data: { id: row.id },
      audit: {
        resource: { type: "payroll_other_payment", id: row.id, entityId: row.entityId },
        summary: "paid-another-way mark taken back",
        before: { personId: row.personId, paidOn: row.paidOn, reference: row.reference, reason: row.reason },
      },
    };
  },
});
export async function removeOtherPaymentAction(input: unknown) {
  return removeOtherPaymentPipeline(input);
}

// ── The cash sheet (FR-PAY-39) ──────────────────────────────────────────────────────────────

const openSheetPipeline = createAction({
  name: "payroll_payment.open_cash_sheet",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  // C&B open the sheet as part of preparing a month; the accountant then signs it off.
  authorize: (user, input) => paysOrPrepares(user, input.runId),
  run: async ({ user, input }) => {
    const outcome = await openCashSheet(input.runId, user.person.id);
    const run = await getRun(input.runId);
    refresh(input.runId);
    return {
      data: { created: outcome.created, rows: outcome.rows.length },
      audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `cash sheet opened for ${run?.month ?? ""}`, after: { rows: outcome.rows.length } },
    };
  },
});
export async function openCashSheetAction(input: unknown) {
  return openSheetPipeline(input);
}

const disbursePipeline = createAction({
  name: "payroll_payment.record_disbursement",
  stepUp: true,
  // `amount` blank = the person's net in full; anything else needs the note (checked in the service).
  input: z.object({ runId: z.uuid(), personId: z.uuid(), disbursedOn: z.iso.date(), amount: optionalVnd, note: optionalText(300) }),
  authorize: (user, input) => paysRun(user, input.runId),
  run: async ({ user, input }) => {
    const row = await recordCashDisbursement(input, user.person.id);
    refresh(input.runId);
    // Whether it was in full is worth keeping; how much it was is not written to the log.
    return {
      data: { id: row.id },
      audit: {
        resource: { type: "payroll_cash_payment", id: row.id, entityId: row.entityId },
        summary: `cash handed over on ${input.disbursedOn}`,
        after: { personId: input.personId, disbursedOn: input.disbursedOn, inFull: openCashDisbursed(row) === openCashAmount(row), note: row.disbursementNote },
      },
    };
  },
});
export async function recordCashDisbursementAction(input: unknown) {
  return disbursePipeline(input);
}

const confirmPipeline = createAction({
  name: "payroll_payment.confirm_receipt",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  // Nobody confirms on somebody else's behalf — not C&B, not the accountant, not the owner. The
  // person's own row is the only thing this action can touch.
  authorize: async (user, input) => {
    const row = await getCashPayment(input.runId, user.person.id);
    return !!row && !!row.disbursedOn;
  },
  run: async ({ user, input }) => {
    const row = await confirmCashReceipt(input.runId, user.person.id);
    revalidatePath("/payslips");
    refresh(input.runId);
    return { data: { id: row.id }, audit: { resource: { type: "payroll_cash_payment", id: row.id, entityId: row.entityId }, summary: "receipt confirmed by the employee" } };
  },
});
export async function confirmCashReceiptAction(input: unknown) {
  return confirmPipeline(input);
}

// ── The signed sheet, scanned and attached to the run (FR-PAY-39) ───────────────────────────
// Through the files module at the compensation tier, the way a signed acceptance is attached: the
// browser uploads straight to storage, and the file opens only through the action below — for the
// people who may print the sheet — never on its id alone.

const beginScanPipeline = createAction({
  name: "payroll_payment.cash_sheet_scan.begin",
  stepUp: true,
  input: z.object({ runId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => paysOrPrepares(user, input.runId),
  run: async ({ user, input }) => {
    const run = (await getRun(input.runId))!;
    // There is no sheet to sign before the CEO has signed the run.
    if (!hasReached(run, "approved")) throw new ActionError("run_not_approved");
    const upload = await beginUpload(cashSheetScanOwner(run), { fileName: input.fileName, sizeBytes: input.sizeBytes }, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: run.entityId }, summary: input.fileName } };
  },
});
export async function beginCashSheetScanAction(input: unknown) {
  return beginScanPipeline(input);
}

const completeScanPipeline = createAction({
  name: "payroll_payment.cash_sheet_scan.complete",
  stepUp: true,
  input: z.object({ fileId: z.uuid() }),
  // Only the pending upload this person started a moment ago, for a cash sheet.
  authorize: async (user, input) => {
    const [row] = await db()
      .select({ id: schema.storedFile.id })
      .from(schema.storedFile)
      .where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, CASH_SHEET_SCAN), eq(schema.storedFile.uploadedByPersonId, user.person.id), eq(schema.storedFile.status, "pending")))
      .limit(1);
    return !!row;
  },
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    refresh(file.ownerId);
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function completeCashSheetScanAction(input: unknown) {
  return completeScanPipeline(input);
}

/** The scan asked for, if it really is a scan of this run's sheet. */
const scanOfRun = async (runId: string, fileId: string) => {
  const file = await findFile(fileId);
  return file && file.ownerType === CASH_SHEET_SCAN && file.ownerId === runId ? file : null;
};

const openScanPipeline = createAction({
  name: "payroll_payment.cash_sheet_scan.open",
  stepUp: true,
  input: z.object({ runId: z.uuid(), fileId: z.uuid() }),
  authorize: (user, input) => paysOrPrepares(user, input.runId),
  run: async ({ user, input }) => {
    const file = await scanOfRun(input.runId, input.fileId);
    if (!file) throw new ActionError("file_not_found");
    // Compensation tier: the files module writes this opening to the audit log as well.
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function openCashSheetScanAction(input: unknown) {
  return openScanPipeline(input);
}

const removeScanPipeline = createAction({
  name: "payroll_payment.cash_sheet_scan.remove",
  stepUp: true,
  input: z.object({ runId: z.uuid(), fileId: z.uuid() }),
  authorize: (user, input) => paysRun(user, input.runId),
  run: async ({ input }) => {
    const run = await getRun(input.runId);
    // A locked month keeps its evidence.
    if (!run || isLocked(run)) throw new ActionError("run_locked");
    const file = await scanOfRun(input.runId, input.fileId);
    if (!file) throw new ActionError("file_not_found");
    await softDeleteFile(file.id);
    refresh(input.runId);
    return { data: { fileId: file.id }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: `removed ${file.fileName}` } };
  },
});
export async function removeCashSheetScanAction(input: unknown) {
  return removeScanPipeline(input);
}
