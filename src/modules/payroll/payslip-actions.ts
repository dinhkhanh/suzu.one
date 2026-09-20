"use server";
// Payslips and payslip queries (FR-PAY-32). Every action asks for a recent re-authentication
// (FR-PLT-06) — including the employee's own, because a payslip is compensation tier whoever
// reads it.
//
// The rule these actions enforce over and over: **a payslip belongs to its owner, to C&B over
// their entity, and to the owner of the company.** An id is never a way in — an action about
// someone else's payslip is refused exactly like one about a payslip that does not exist.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { closePayslipQuery, getPayslip, getQuery, publishPayslips, raisePayslipQuery, replyToPayslipQuery } from "./payslips";
import { canManageCompensation, canViewCompensationOf } from "./policy";
import { getRun } from "./runs";

const body = z.string().trim().min(1).max(4000);

const publishPipeline = createAction({
  name: "payslip.publish",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => {
    const run = await getRun(input.runId);
    return !!run && canManageCompensation(user.principal, run);
  },
  run: async ({ user, input }) => {
    const outcome = await publishPayslips(input.runId, user.person.id);
    const run = await getRun(input.runId);
    revalidatePath(`/payroll/runs/${input.runId}`);
    revalidatePath("/payslips");
    // How many people were told, not what any of them was paid.
    return { data: outcome, audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `payslips published ${run?.month ?? ""}`, after: { published: outcome.published } } };
  },
});
export async function publishPayslipsAction(input: unknown) {
  return publishPipeline(input);
}

// ── Queries ─────────────────────────────────────────────────────────────────────────────────

const raisePipeline = createAction({
  name: "payslip_query.raise",
  stepUp: true,
  input: z.object({ payslipId: z.uuid(), body }),
  // Only the person whose payslip it is asks about it; C&B answer, they do not ask on someone's behalf.
  authorize: async (user, input) => {
    const payslip = await getPayslip(input.payslipId);
    return !!payslip && payslip.personId === user.person.id;
  },
  run: async ({ user, input }) => {
    const query = await raisePayslipQuery(input, user.person.id);
    revalidatePath(`/payslips/${input.payslipId}`);
    revalidatePath("/payroll/queries");
    // The words belong to the thread, not to the audit log (the convention set by work comments).
    return { data: { id: query.id }, audit: { resource: { type: "payslip_query", id: query.id, entityId: query.entityId }, summary: "payslip query raised" } };
  },
});
export async function raisePayslipQueryAction(input: unknown) {
  return raisePipeline(input);
}

const replyPipeline = createAction({
  name: "payslip_query.reply",
  stepUp: true,
  input: z.object({ queryId: z.uuid(), body }),
  authorize: async (user, input) => {
    const query = await getQuery(input.queryId);
    // Its owner, or C&B over the entity. `canViewCompensationOf` is exactly that pair of rules.
    return !!query && canViewCompensationOf(user.principal, { personId: query.personId, entityId: query.entityId });
  },
  run: async ({ user, input }) => {
    const existing = await getQuery(input.queryId);
    const fromManager = existing!.personId !== user.person.id;
    const { query, payslip } = await replyToPayslipQuery({ ...input, fromManager }, user.person.id);
    revalidatePath(`/payslips/${payslip.id}`);
    revalidatePath("/payroll/queries");
    return { data: { status: query.status }, audit: { resource: { type: "payslip_query", id: query.id, entityId: query.entityId }, summary: `payslip query ${query.status}`, after: { status: query.status } } };
  },
});
export async function replyToPayslipQueryAction(input: unknown) {
  return replyPipeline(input);
}

const closePipeline = createAction({
  name: "payslip_query.close",
  stepUp: true,
  input: z.object({ queryId: z.uuid() }),
  authorize: async (user, input) => {
    const query = await getQuery(input.queryId);
    return !!query && canViewCompensationOf(user.principal, { personId: query.personId, entityId: query.entityId });
  },
  run: async ({ input }) => {
    const query = await closePayslipQuery(input.queryId);
    revalidatePath("/payroll/queries");
    revalidatePath("/payslips");
    return { data: { id: query.id }, audit: { resource: { type: "payslip_query", id: query.id, entityId: query.entityId }, summary: "payslip query closed", after: { status: query.status } } };
  },
});
export async function closePayslipQueryAction(input: unknown) {
  return closePipeline(input);
}
