"use server";
// Filing and re-filing an expense claim, and offering the approved ones to payroll by hand
// (FR-REQ-03). Deciding one goes through `decideRequestAction` like every other request — the
// effect is attached to the type, not to a second decide action.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { EXPENSE_CATEGORIES, MAX_DESCRIPTION, MAX_LINE_AMOUNT, MAX_LINES, MAX_PROJECT_TAG } from "./engine/expense";
import { MAX_TEXT } from "./engine/form";
import { fileExpenseClaim, refileExpenseClaim } from "./expense";
import { sweepApprovedClaims } from "./expense-posting";
import { canFileRequests, canSettleExpenseClaims } from "./policy";
import { getGenericRequest } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));

// The form's own answers, exactly as the generic filing action takes them.
const answers = z.record(z.string().max(40), z.union([z.string().max(MAX_TEXT), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).nullable()).default({});

const claimLine = z.object({
  lineDate: z.iso.date(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION),
  // Whole đồng. A figure with a fraction is a mistake, not something to round away quietly.
  amount: z.coerce.number().int().positive().max(MAX_LINE_AMOUNT),
  receiptFileId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
  projectTag: optionalText(MAX_PROJECT_TAG),
});

const lines = z.array(claimLine).min(1).max(MAX_LINES);

// Whole-đồng figures with no decimals — the summary is written in the company's language, not the
// approver's, so it must not be formatted for whoever happens to read it.
const formatDong = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;

const filePipeline = createAction({
  name: "expense_claim.file",
  input: z.object({ values: answers, lines }),
  authorize: (user) => canFileRequests(user.principal),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(user.person.id);
    const filed = await fileExpenseClaim(input, { personId: user.person.id, entityId: target?.entityId ?? null, unitPath: target?.unitPath ?? [], managerId: target?.managerId ?? null }, formatDong);
    revalidatePath("/requests");
    revalidatePath("/requests/claims");
    revalidatePath("/approvals");
    return {
      data: filed,
      // The audit line says how many lines and what they come to — the claim's own figure, which
      // its requester typed and may read. Nothing about anybody's pay.
      audit: { resource: { type: "approval:request:expense_claim", id: filed.requestId, entityId: target?.entityId ?? null }, summary: `${input.lines.length} khoản`, after: { outcome: filed.outcome } },
    };
  },
});

export async function fileExpenseClaimAction(input: unknown) {
  return filePipeline(input);
}

const refilePipeline = createAction({
  name: "expense_claim.refile",
  input: z.object({ requestId: z.uuid(), values: answers, lines }),
  authorize: async (user, input) => {
    const view = await getGenericRequest({ personId: user.person.id, principal: user.principal }, input.requestId);
    return !!view && view.isRequester && view.request.status === "returned";
  },
  run: async ({ user, input }) => {
    await refileExpenseClaim(input.requestId, user.person.id, { values: input.values, lines: input.lines }, formatDong);
    revalidatePath("/requests");
    revalidatePath("/requests/claims");
    revalidatePath(`/approvals/request/${input.requestId}`);
    return { data: { requestId: input.requestId }, audit: { resource: { type: "approval:request:expense_claim", id: input.requestId }, summary: `${input.lines.length} khoản`, after: { resubmitted: true } } };
  },
});

export async function refileExpenseClaimAction(input: unknown) {
  return refilePipeline(input);
}

const sweepPipeline = createAction({
  name: "expense_claim.sweep",
  input: z.object({}).default({}),
  // Whoever pays the company's people decides when the waiting claims go into a run.
  authorize: (user) => canSettleExpenseClaims(user.principal),
  run: async ({ user }) => {
    const result = await sweepApprovedClaims(user.person.id);
    revalidatePath("/requests/claims");
    return { data: result, audit: { resource: { type: "expense_claim", id: "sweep" }, summary: `posted ${result.posted}, released ${result.released}, waiting ${result.stillWaiting}`, after: result } };
  },
});

export async function sweepExpenseClaimsAction(input: unknown) {
  return sweepPipeline(input);
}
