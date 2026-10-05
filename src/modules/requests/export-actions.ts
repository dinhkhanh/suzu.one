"use server";
// Export actions (FR-PLT-37): the pipeline audits who exported what — the file and its row count.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { buildExpenseClaimsExport, buildPayoutsExport } from "./exports";
import { canPayRequests, canSettleExpenseClaims } from "./policy";

const input = z.object({ locale: z.enum(["vi", "en"]).default("vi") });

const payoutsPipeline = createAction({
  name: "requests.payouts.export",
  input,
  authorize: (user) => canPayRequests(user.principal),
  run: async ({ user, input }) => {
    const { file, total } = await buildPayoutsExport(user.principal, input.locale);
    return { data: file, audit: { resource: { type: "export:requests-to-pay", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { rowCount: file.rowCount, total } } };
  },
});

export async function exportPayoutsAction(payload: unknown) {
  return payoutsPipeline(payload);
}

const claimsPipeline = createAction({
  name: "requests.claims.export",
  input,
  authorize: (user) => canSettleExpenseClaims(user.principal),
  run: async ({ user, input }) => {
    const { file, total } = await buildExpenseClaimsExport(user.principal, input.locale);
    return { data: file, audit: { resource: { type: "export:expense-claims", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { rowCount: file.rowCount, total } } };
  },
});

export async function exportExpenseClaimsAction(payload: unknown) {
  return claimsPipeline(payload);
}
