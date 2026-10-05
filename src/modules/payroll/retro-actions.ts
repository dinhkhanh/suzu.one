"use server";
// Retro items (FR-PAY-17): entering one by hand, cancelling one, and looking for differences.
// Like every payroll action these ask for a recent re-authentication (FR-PLT-06) and a payroll
// permission over the **entity that pays** — and, for one person's item, over that person too,
// never on one's own pay (`canEnterRetroItemFor`).
//
// What reaches the audit log: whose item, of which month and of what kind. Never the amount
// (FR-ACL-04), and not the reason either — it is free text beside a figure, and stays on the item.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { canEnterRetroItemFor, canManageCompensation } from "./policy";
import { enterRetroItem, getRetroItem, refreshRetroItems, withdrawRetroItem } from "./retro";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reason = z.string().trim().min(1).max(300);
// Forms post "1.500.000" or "-1.500.000": money owed to the person, or money to recover.
const signedVnd = z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() === "" ? 0 : /^-?[\d.,\s_]+$/.test(value) ? Number(value.replace(/[.,\s_]/g, "")) : Number.NaN) : value),
  z.number().int().min(-100_000_000_000).max(100_000_000_000),
);
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** The retro screen, the run register, and every run that was sent back to draft. */
const refresh = (runIds: readonly (string | null | undefined)[]) => {
  revalidatePath("/payroll/retro");
  revalidatePath("/payroll/runs");
  for (const runId of runIds) if (runId) revalidatePath(`/payroll/runs/${runId}`);
};

const addPipeline = createAction({
  name: "payroll_retro.add",
  stepUp: true,
  input: z.object({
    entityId: z.uuid(),
    personId: z.uuid(),
    sourceMonth: month,
    amount: signedVnd,
    reason,
    /** Set when the item stands in for an attendance correction the system could not price. */
    adjustmentId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
    /** The run screen the form was on, if any — only so that screen is refreshed. */
    runId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
  }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    return !!target && canEnterRetroItemFor(user.principal, { entityId: input.entityId }, target);
  },
  run: async ({ user, input }) => {
    const { item, reopenedRunIds } = await enterRetroItem(input, user.person.id);
    refresh([input.runId, ...reopenedRunIds]);
    return {
      data: { id: item.id, reopened: reopenedRunIds.length },
      audit: { resource: { type: "payroll_retro_item", id: item.id, entityId: item.entityId }, summary: `${item.kind} ${item.sourceMonth}`, after: { personId: item.personId, sourceMonth: item.sourceMonth, kind: item.kind, sourceRef: item.sourceRef, reopenedRunIds } },
    };
  },
});
export async function addRetroItemAction(input: unknown) {
  return addPipeline(input);
}

const cancelPipeline = createAction({
  name: "payroll_retro.cancel",
  stepUp: true,
  input: z.object({ id: z.uuid(), reason, runId: z.preprocess(blankToNull, z.uuid().nullable().default(null)) }),
  // The item's own entity and person decide — an id is not a way in, and nobody cancels a
  // recovery from their own pay.
  authorize: async (user, input) => {
    const item = await getRetroItem(input.id);
    const target = item ? await getPersonTarget(item.personId) : null;
    return !!item && !!target && canEnterRetroItemFor(user.principal, { entityId: item.entityId }, target);
  },
  run: async ({ user, input }) => {
    const { item, reopenedRunId } = await withdrawRetroItem(input.id, input.reason, user.person.id);
    refresh([input.runId, reopenedRunId]);
    return {
      data: { id: item.id, reopened: reopenedRunId ? 1 : 0 },
      audit: { resource: { type: "payroll_retro_item", id: item.id, entityId: item.entityId }, summary: `cancelled ${item.kind} ${item.sourceMonth}`, before: { status: reopenedRunId ? "taken" : "open" }, after: { status: item.status, personId: item.personId, reopenedRunId } },
    };
  },
});
export async function cancelRetroItemAction(input: unknown) {
  return cancelPipeline(input);
}

const derivePipeline = createAction({
  name: "payroll_retro.derive",
  stepUp: true,
  input: z.object({ entityId: z.uuid(), runId: z.preprocess(blankToNull, z.uuid().nullable().default(null)) }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const derived = await refreshRetroItems(input.entityId, user.person.id);
    refresh([input.runId, ...derived.reopenedRunIds]);
    // Counts, not figures and not names: how much was found, not what anyone is owed.
    const counts = { created: derived.created.length, skipped: derived.skipped.length, cancelled: derived.cancelled };
    return { data: counts, audit: { resource: { type: "payroll_retro_item", entityId: input.entityId }, summary: `derived ${counts.created}, skipped ${counts.skipped}, cancelled ${counts.cancelled}`, after: { ...counts, reopenedRunIds: derived.reopenedRunIds } } };
  },
});
export async function deriveRetroItemsAction(input: unknown) {
  return derivePipeline(input);
}
