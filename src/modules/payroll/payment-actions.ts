"use server";
// Paying a run (FR-PAY-33, FR-PAY-39). `payroll:pay` over the run's entity — the chief accountant —
// except for the receipt, which only the person who took the cash may give.
//
// A generated bank file comes back **through the action's result**, as text, and is saved by the
// browser; it is never written to storage (see `payments.ts`). The audit row says which bank, how
// many rows and which run — never a figure, and never an account number.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { confirmCashReceipt, generateBankFile, getCashPayment, openCashSheet, recordCashDisbursement } from "./payments";
import { canManageCompensation, canPayPayroll } from "./policy";
import { getRun } from "./runs";

const refresh = (runId: string) => {
  revalidatePath(`/payroll/runs/${runId}/payments`);
  revalidatePath(`/payroll/runs/${runId}`);
};

const generatePipeline = createAction({
  name: "payroll_payment.generate_bank_file",
  stepUp: true,
  input: z.object({
    runId: z.uuid(),
    bank: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),
    valueDate: z.iso.date(),
    accountNumber: z.string().trim().regex(/^[\d\s-]{6,32}$/),
    accountName: z.string().trim().min(1).max(160),
    branch: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(160).nullable().default(null)),
  }),
  authorize: async (user, input) => {
    const run = await getRun(input.runId);
    return !!run && canPayPayroll(user.principal, run);
  },
  run: async ({ user, input }) => {
    const { file, record } = await generateBankFile(
      { runId: input.runId, bank: input.bank, valueDate: input.valueDate, payingAccount: { accountNumber: input.accountNumber, accountName: input.accountName, branch: input.branch } },
      user.person.id,
    );
    refresh(input.runId);
    return {
      // The file's text goes to the browser that asked for it and nowhere else.
      data: { fileName: file.fileName, content: file.content, contentType: file.contentType, rowCount: file.rowCount, skipped: file.skipped },
      audit: {
        resource: { type: "payroll_payment_file", id: record.id, entityId: record.entityId },
        summary: `${input.bank} batch for run ${input.runId}`,
        after: { bank: input.bank, formatVersion: record.formatVersion, rowCount: record.rowCount, skipped: record.skippedCount, valueDate: input.valueDate },
      },
    };
  },
});
export async function generateBankFileAction(input: unknown) {
  return generatePipeline(input);
}

const openSheetPipeline = createAction({
  name: "payroll_payment.open_cash_sheet",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => {
    const run = await getRun(input.runId);
    // C&B open the sheet as part of preparing a month; the accountant then signs it off.
    return !!run && (canPayPayroll(user.principal, run) || canManageCompensation(user.principal, run));
  },
  run: async ({ user, input }) => {
    const outcome = await openCashSheet(input.runId, user.person.id);
    const run = await getRun(input.runId);
    refresh(input.runId);
    return { data: { created: outcome.created, rows: outcome.rows.length }, audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `cash sheet opened for ${run?.month ?? ""}`, after: { rows: outcome.rows.length } } };
  },
});
export async function openCashSheetAction(input: unknown) {
  return openSheetPipeline(input);
}

const disbursePipeline = createAction({
  name: "payroll_payment.record_disbursement",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid(), disbursedOn: z.iso.date(), note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(300).nullable().default(null)) }),
  authorize: async (user, input) => {
    const run = await getRun(input.runId);
    return !!run && canPayPayroll(user.principal, run);
  },
  run: async ({ user, input }) => {
    const row = await recordCashDisbursement(input, user.person.id);
    refresh(input.runId);
    return { data: { id: row.id }, audit: { resource: { type: "payroll_cash_payment", id: row.id, entityId: row.entityId }, summary: `cash handed over on ${input.disbursedOn}`, after: { personId: input.personId, disbursedOn: input.disbursedOn } } };
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
