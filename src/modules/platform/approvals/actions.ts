"use server";
// Only what is the same for every request type lives here. Deciding a request has an effect that
// belongs to the module owning the type, so each module has its own decide action.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { can, type Principal } from "../rbac/policy";
import { createDelegation, revokeDelegation } from "./delegations";
import { deleteFlow, flowDefinitionSchema, getFlow, saveFlow } from "./flows";
import { canWithdraw } from "./policy";
import { commentOnRequest, delegateRequest, isRequestParty, listInbox, withdrawRequest } from "./service";

const withdrawPipeline = createAction({
  name: "approval.withdraw",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => {
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, input.requestId)).limit(1);
    return !!request && canWithdraw(request, user.person.id);
  },
  run: async ({ user, input }) => {
    const { request, before } = await db().transaction((tx) => withdrawRequest(tx, input.requestId, user.person.id));
    revalidatePath("/approvals");
    if (request.link) revalidatePath(request.link);
    return {
      data: { id: request.id },
      audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: request.summary, before: { status: before.status }, after: { status: request.status } },
    };
  },
});

export async function withdrawApprovalAction(input: unknown) {
  return withdrawPipeline(input);
}

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));

function refreshRequest(link: string | null) {
  revalidatePath("/approvals");
  if (link) revalidatePath(link);
}

// Handing one's turn on a request to someone else. Whose turn it is comes from the flow state.
const delegatePipeline = createAction({
  name: "approval.delegate",
  input: z.object({ requestId: z.uuid(), toPersonId: z.uuid(), comment: optionalText(1000) }),
  authorize: async (user, input) => (await isRequestParty(input.requestId, user.person.id)).canDelegate,
  run: async ({ user, input }) => {
    const { request, toName } = await db().transaction((tx) => delegateRequest(tx, input.requestId, user.person.id, input));
    refreshRequest(request.link);
    return { data: { id: request.id }, audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: `delegated to ${toName}: ${request.summary}`, after: { toPersonId: input.toPersonId } } };
  },
});

export async function delegateApprovalAction(input: unknown) {
  return delegatePipeline(input);
}

const commentPipeline = createAction({
  name: "approval.comment",
  input: z.object({ requestId: z.uuid(), comment: z.string().trim().min(1).max(1000) }),
  authorize: async (user, input) => (await isRequestParty(input.requestId, user.person.id)).party,
  run: async ({ user, input }) => {
    const { request } = await db().transaction((tx) => commentOnRequest(tx, input.requestId, user.person.id, input.comment));
    refreshRequest(request.link);
    // The remark itself stays with the request; the audit log keeps that one was made.
    return { data: { id: request.id }, audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: request.summary } };
  },
});

export async function commentApprovalAction(input: unknown) {
  return commentPipeline(input);
}

// ── Standing delegations: everyone manages their own ─────────────────────────────────────────

const delegationPipeline = createAction({
  name: "approval.delegation.create",
  input: z.object({
    toPersonId: z.uuid(),
    validFrom: z.iso.date(),
    validTo: z.iso.date(),
    requestTypes: z.preprocess((value) => (typeof value === "string" ? (value ? [value] : []) : (value ?? [])), z.array(z.string().max(60)).max(20)),
    reason: optionalText(300),
    // Also hand over what is waiting for me now (only when the delegation already runs today).
    includePending: z.preprocess((value) => value === "on" || value === true, z.boolean()),
  }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const row = await createDelegation(user.person.id, { ...input, requestTypes: input.requestTypes.length ? input.requestTypes : null });
    let handedOver = 0;
    if (input.includePending && row.validFrom <= todayInVietnam()) {
      for (const waiting of await listInbox(user.person.id)) {
        if (row.requestTypes && !row.requestTypes.includes(waiting.type)) continue;
        try {
          await db().transaction((tx) => delegateRequest(tx, waiting.id, user.person.id, { toPersonId: row.toPersonId }));
          handedOver++;
        } catch (error) {
          // The delegate filed it, or already sits on the step: it stays with me.
          if (!(error instanceof ActionError)) throw error;
        }
      }
    }
    revalidatePath("/approvals");
    revalidatePath("/approvals/delegation");
    return { data: { id: row.id, handedOver }, audit: { resource: { type: "approval_delegation", id: row.id }, summary: `${row.validFrom} → ${row.validTo}`, after: { toPersonId: row.toPersonId, requestTypes: row.requestTypes, handedOver } } };
  },
});

export async function createDelegationAction(input: unknown) {
  return delegationPipeline(input);
}

const revokeDelegationPipeline = createAction({
  name: "approval.delegation.revoke",
  input: z.object({ id: z.uuid() }),
  authorize: () => true,
  run: async ({ user, input }) => {
    // The service only finds the caller's own delegation.
    const row = await revokeDelegation(user.person.id, input.id);
    revalidatePath("/approvals/delegation");
    return { data: { id: row.id }, audit: { resource: { type: "approval_delegation", id: row.id }, summary: "revoked", before: { revokedAt: null }, after: { revokedAt: row.revokedAt } } };
  },
});

export async function revokeDelegationAction(input: unknown) {
  return revokeDelegationPipeline(input);
}

// ── Flow configuration: whoever manages the organisation — the group's flows need a group grant ──

const canManageFlow = (user: { principal: Principal }, entityId: string | null) => can(user.principal, "org:manage", entityId ? { entityId } : {});

const saveFlowPipeline = createAction({
  name: "approval.flow.save",
  input: z.object({
    requestType: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
    entityId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
    active: z.preprocess((value) => value === "on" || value === true, z.boolean()),
    // The editor posts the flow as JSON text.
    definition: z.preprocess((value) => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }, flowDefinitionSchema),
  }),
  authorize: (user, input) => canManageFlow(user, input.entityId),
  run: async ({ user, input }) => {
    const { before, after } = await saveFlow(input, user.person.id);
    revalidatePath("/admin/approval-flows");
    return { data: { id: after.id }, audit: { resource: { type: "approval_flow", id: after.id, entityId: after.entityId }, summary: `${after.requestType}${after.active ? "" : " (off)"}`, before: before ? { definition: before.definition, active: before.active } : null, after: { definition: after.definition, active: after.active } } };
  },
});

export async function saveFlowAction(input: unknown) {
  return saveFlowPipeline(input);
}

const deleteFlowPipeline = createAction({
  name: "approval.flow.delete",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const flow = await getFlow(input.id);
    return !!flow && canManageFlow(user, flow.entityId);
  },
  run: async ({ input }) => {
    const row = await deleteFlow(input.id);
    if (!row) throw new ActionError("approval_not_found");
    revalidatePath("/admin/approval-flows");
    return { data: { id: row.id }, audit: { resource: { type: "approval_flow", id: row.id, entityId: row.entityId }, summary: `${row.requestType}: back to the default`, before: { definition: row.definition, active: row.active } } };
  },
});

export async function deleteFlowAction(input: unknown) {
  return deleteFlowPipeline(input);
}
