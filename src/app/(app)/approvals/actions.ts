"use server";
// Bulk approve (FR-PLT-22). Lives at the composition root because it reaches every module's own
// decide action. Each request goes through that action's full pipeline — its own authorization,
// its own transaction, its own audit entry — so ticking a box can do nothing opening it could not.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { findActionToken, spendActionToken } from "@/modules/platform/approvals/action-tokens";
import { getRequestRows } from "@/modules/platform/approvals/service";
import { allRequestTypes, findRegisteredType } from "./registry";

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

// ── Approve straight from a notification (FR-PLT-24) ─────────────────────────────────────────

/**
 * Redeems a one-shot link. The token is a **shortcut, not an authentication**: `createAction`
 * has already demanded a real session, this checks the token names that very person, and the work
 * itself is the owning module's own decide action — the same pipeline, the same authorization, the
 * same audit entry as pressing "approve" on the request page. A link that reached the wrong inbox
 * therefore does nothing at all.
 *
 * The token is spent before the decision runs, so a double click decides once.
 */
const approveFromLinkPipeline = createAction({
  name: "approval.approve_from_link",
  input: z.object({ token: z.string().min(20).max(200) }),
  authorize: async (user, input) => {
    const lookup = await findActionToken(input.token);
    return lookup.ok && lookup.row.personId === user.person.id && lookup.row.action === "approve";
  },
  run: async ({ input }) => {
    const lookup = await findActionToken(input.token);
    if (!lookup.ok) throw new ActionError("approval_link_unusable");
    if (!(await spendActionToken(lookup.row.id))) throw new ActionError("approval_link_unusable");

    const [request] = await getRequestRows([lookup.row.requestId]);
    const registered = request ? await findRegisteredType(request.type) : undefined;
    if (!request || !registered) throw new ActionError("approval_not_found");

    const result = await registered.approve(request.id);
    if (!result.ok) throw new ActionError((result.error === "failed" ? result.message : result.error) ?? "generic");
    return { data: { requestId: request.id }, audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: `approved from a notification link: ${request.summary}` } };
  },
});

export async function approveFromLinkAction(input: unknown) {
  return approveFromLinkPipeline(input);
}
