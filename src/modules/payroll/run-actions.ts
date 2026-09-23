"use server";
// Payroll runs (FR-PAY-19, 30, 31; SRS D17). Every action asks for a recent re-authentication
// (FR-PLT-06) and a payroll permission over the **run's own entity** — never the org chart.
//
// What reaches the audit log: the run, the step, the person who took it and their comment.
// Never a figure, never a headcount's worth of anyone's pay (FR-ACL-04).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { RUN_STEPS, type RunStep, stepRun } from "./lifecycle";
import type { Principal } from "@/modules/platform/rbac/policy";
import { canApprovePayroll, canManageCompensation, canPayPayroll, canSetRunInputFor } from "./policy";
import { calculateNow } from "./run-calculation";
import { cancelRun, createOffCycleRun, createRegularRun, getRun, removeRunInput, setRunInput } from "./runs";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// Forms post "20.000.000" or "20,000,000"; a figure may be negative (an advance, a penalty).
const signedVnd = z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() === "" ? 0 : /^-?[\d.,\s_]+$/.test(value) ? Number(value.replace(/[.,\s_]/g, "")) : Number.NaN) : value),
  z.number().int().min(-100_000_000_000).max(100_000_000_000),
);

const refresh = (runId?: string) => {
  revalidatePath("/payroll/runs");
  revalidatePath("/payroll");
  if (runId) revalidatePath(`/payroll/runs/${runId}`);
};

/** The run, and whether this person may manage the entity it belongs to. */
const runFor = async (runId: string) => getRun(runId);

// ── Creating ────────────────────────────────────────────────────────────────────────────────

const createPipeline = createAction({
  name: "payroll_run.create",
  stepUp: true,
  input: z.object({ entityId: z.uuid(), month, note: text(500) }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const run = await createRegularRun(input, user.person.id);
    refresh(run.id);
    return { data: { id: run.id }, audit: { resource: { type: "payroll_run", id: run.id, entityId: run.entityId }, summary: `regular ${run.month}`, after: { month: run.month, kind: run.kind } } };
  },
});
export async function createPayrollRunAction(input: unknown) {
  return createPipeline(input);
}

const offCyclePipeline = createAction({
  name: "payroll_run.create_off_cycle",
  stepUp: true,
  input: z.object({
    entityId: z.uuid(),
    month,
    name: z.string().trim().min(1).max(200),
    note: text(500),
    lines: z.array(z.object({ personId: z.uuid(), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), amount: signedVnd, note: text(300) })).min(1).max(1000),
  }),
  // Nobody puts a line for themselves into an off-cycle run, as nobody types into their own line.
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }) && input.lines.every((line) => line.personId !== user.person.id),
  run: async ({ user, input }) => {
    const run = await createOffCycleRun(input, user.person.id);
    refresh(run.id);
    // The number of lines is not a figure: it says how big the run is, not what anyone is paid.
    return { data: { id: run.id }, audit: { resource: { type: "payroll_run", id: run.id, entityId: run.entityId }, summary: `off_cycle ${run.month}: ${input.name}`, after: { month: run.month, kind: run.kind, lines: input.lines.length } } };
  },
});
export async function createOffCycleRunAction(input: unknown) {
  return offCyclePipeline(input);
}

// ── Calculating ─────────────────────────────────────────────────────────────────────────────

const calculatePipeline = createAction({
  name: "payroll_run.calculate",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => {
    const run = await runFor(input.runId);
    return !!run && canManageCompensation(user.principal, run);
  },
  run: async ({ input }) => {
    const outcome = await calculateNow(input.runId);
    const run = await runFor(input.runId);
    refresh(input.runId);
    return { data: outcome, audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `calculated ${run?.month ?? ""}`, after: { headcount: outcome.headcount ?? 0 } } };
  },
});
export async function calculatePayrollRunAction(input: unknown) {
  return calculatePipeline(input);
}

// ── Figures typed into a run ────────────────────────────────────────────────────────────────

async function mayTouchInput(principal: Principal, input: { runId: string; personId: string }): Promise<boolean> {
  const [run, target] = await Promise.all([runFor(input.runId), getPersonTarget(input.personId)]);
  return !!run && !!target && canSetRunInputFor(principal, run, target);
}

const setInputPipeline = createAction({
  name: "payroll_run.set_input",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid(), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), amount: signedVnd, note: text(300) }),
  // The person must belong to an entity this C&B covers as well — a run id is not a way in — and
  // nobody types figures into their own pay.
  authorize: async (user, input) => mayTouchInput(user.principal, input),
  run: async ({ user, input }) => {
    await setRunInput(input, user.person.id);
    const run = await runFor(input.runId);
    refresh(input.runId);
    return { data: { ok: true }, audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `input ${input.code}`, after: { personId: input.personId, code: input.code } } };
  },
});
export async function setPayrollRunInputAction(input: unknown) {
  return setInputPipeline(input);
}

const removeInputPipeline = createAction({
  name: "payroll_run.remove_input",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid(), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/) }),
  authorize: async (user, input) => mayTouchInput(user.principal, input),
  run: async ({ input }) => {
    await removeRunInput(input.runId, input.personId, input.code);
    const run = await runFor(input.runId);
    refresh(input.runId);
    return { data: { ok: true }, audit: { resource: { type: "payroll_run", id: input.runId, entityId: run?.entityId ?? null }, summary: `input ${input.code} removed`, after: { personId: input.personId, code: input.code } } };
  },
});
export async function removePayrollRunInputAction(input: unknown) {
  return removeInputPipeline(input);
}

// ── The lifecycle (SRS D17) ─────────────────────────────────────────────────────────────────

/** Which permission each step asks for, over the run's entity. */
const allows = {
  "payroll:propose": canManageCompensation,
  "payroll:approve": canApprovePayroll,
  "payroll:pay": canPayPayroll,
} as const;

const stepPipeline = createAction({
  name: "payroll_run.step",
  stepUp: true,
  input: z.object({ runId: z.uuid(), step: z.enum(Object.keys(RUN_STEPS) as [RunStep, ...RunStep[]]), comment: text(1000) }),
  authorize: async (user, input) => {
    const run = await runFor(input.runId);
    return !!run && allows[RUN_STEPS[input.step].permission](user.principal, run);
  },
  run: async ({ user, input }) => {
    const { before, run } = await stepRun(input.runId, input.step, { personId: user.person.id }, { comment: input.comment });
    refresh(input.runId);
    return {
      data: { status: run.status },
      audit: {
        resource: { type: "payroll_run", id: run.id, entityId: run.entityId },
        summary: `${run.month} ${before.status} → ${run.status}`,
        before: { status: before.status },
        after: { status: run.status, step: input.step },
      },
    };
  },
});
export async function stepPayrollRunAction(input: unknown) {
  return stepPipeline(input);
}

const cancelPipeline = createAction({
  name: "payroll_run.cancel",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => {
    const run = await runFor(input.runId);
    return !!run && canManageCompensation(user.principal, run);
  },
  run: async ({ input }) => {
    const run = await cancelRun(input.runId);
    refresh(input.runId);
    return { data: { id: run.id }, audit: { resource: { type: "payroll_run", id: run.id, entityId: run.entityId }, summary: `cancelled ${run.month}`, after: { status: run.status } } };
  },
});
export async function cancelPayrollRunAction(input: unknown) {
  return cancelPipeline(input);
}
