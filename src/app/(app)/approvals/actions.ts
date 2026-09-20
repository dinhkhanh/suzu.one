"use server";
// Bulk approve (FR-PLT-22). Lives at the composition root because it reaches every module's own
// decide action. Each request goes through that action's full pipeline — its own authorization,
// its own transaction, its own audit entry — so ticking a box can do nothing opening it could not.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getRequestRows } from "@/modules/platform/approvals/service";
import { allRequestTypes } from "./registry";

type BulkResult = { requestId: string; ok: boolean; error?: string };

const bulkApprovePipeline = createAction({
  name: "approval.bulk_approve",
  input: z.object({ requestIds: z.array(z.uuid()).min(1).max(50) }),
  // Whether it is the caller's turn is each request's own question, asked by its action below.
  authorize: () => true,
  run: async ({ input }) => {
    const [rows, registered] = await Promise.all([getRequestRows(input.requestIds).then((all) => new Map(all.map((row) => [row.id, row]))), allRequestTypes()]);
    const results: BulkResult[] = [];
    for (const requestId of [...new Set(input.requestIds)]) {
      const row = rows.get(requestId);
      const type = row ? registered.get(row.type) : undefined;
      if (!row || !type) results.push({ requestId, ok: false, error: "approval_not_found" });
      else if (!type.definition.bulkApprovable?.(row)) results.push({ requestId, ok: false, error: "approval_open_to_decide" });
      else {
        const result = await type.approve(requestId);
        results.push(result.ok ? { requestId, ok: true } : { requestId, ok: false, error: (result.error === "failed" ? result.message : result.error) ?? "generic" });
      }
    }
    const approved = results.filter((result) => result.ok).length;
    return { data: { results }, audit: { resource: { type: "approval", id: null }, summary: `bulk approve: ${approved} of ${results.length}`, after: { results } } };
  },
});

export async function bulkApproveAction(input: unknown) {
  return bulkApprovePipeline(input);
}
