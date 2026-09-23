"use server";
// The year-end bonus (FR-PAY-21). Every action here moves or reveals compensation, so every one
// asks for a recent re-authentication (FR-PLT-06) and every audit row keeps counts, ids and the
// reasons people gave — never an amount.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { createBonusRun, getBonusRun, overrideBonusLine, payBonusRun, simulateBonusRun, simulateWhatIf, stepBonusRun } from "./bonus";
import { checkBonusSchemeValue, decideBonusScheme, proposeBonusScheme } from "./bonus-schemes";
import { BONUS_MULTIPLIER_SOURCES, BONUS_OKR_LEVELS } from "./enums";
import { canAdjustBonusLine, canApproveBonusRun, canDecideBonusScheme, canManageBonusRun, canPayBonusRun, canProposeBonusRun, canProposeBonusScheme } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(inner: Schema) => z.preprocess(blankToNull, inner.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const wholeNumber = z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[.,\s_]/g, "")) : value), z.number().int());
const year = z.coerce.number().int().min(2000).max(2100);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const bp = z.coerce.number().int().min(0).max(1_000_000);
const bandKey = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
const label = z.string().trim().min(1).max(120);

const refresh = (runId?: string) => {
  revalidatePath("/payroll/bonus", "layout");
  if (runId) revalidatePath(`/payroll/bonus/${runId}`);
};

/** The scheme's shape as a form posts it. `checkBonusSchemeValue` does the real validation. */
const schemeValue = z.object({
  payComponentCode: z.string().trim().toUpperCase(),
  baseComponentCode: z.string().trim().toUpperCase(),
  referenceDay: z.string().trim(),
  roundingVnd: wholeNumber,
  capMultiplierBp: bp,
  serviceBands: z.array(z.object({ minMonths: z.coerce.number().int().min(0).max(600), label, factorBp: bp })).min(1).max(12),
  performanceMultiplier: z.object({ source: z.enum(BONUS_MULTIPLIER_SOURCES), bands: z.array(z.object({ key: bandKey, label, minScoreBp: bp, multiplierBp: bp })).min(1).max(12) }),
  unitOkr: z.object({ level: z.enum(BONUS_OKR_LEVELS), bands: z.array(z.object({ label, minProgressBp: bp, multiplierBp: bp })).min(1).max(12) }),
  eligibility: z.object({
    minServiceMonths: z.coerce.number().int().min(0).max(600),
    excludeWorkforceTypes: z.array(z.string().trim().max(40)).max(10).default([]),
    requireActive: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean()),
    requireResult: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean()),
  }),
});

// ── The scheme (FR-PLT-39: C&B proposes, the owner decides) ─────────────────────────────────

const proposeSchemePipeline = createAction({
  name: "bonus_scheme.propose",
  stepUp: true,
  input: z.object({ entityId: optional(z.uuid()), validFrom: z.iso.date(), note: text(500), value: schemeValue }),
  authorize: (user) => canProposeBonusScheme(user.principal),
  run: async ({ user, input }) => {
    const created = await proposeBonusScheme({ entityId: input.entityId, value: checkBonusSchemeValue(input.value), validFrom: input.validFrom, note: input.note }, user.person.id);
    revalidatePath("/payroll/bonus/scheme");
    // A scheme is a rule, not a person's pay: it is kept in the log in full.
    return { data: { id: created.id }, audit: { resource: { type: "bonus_scheme", id: created.id, entityId: created.entityId }, summary: `quy chế thưởng từ ${created.validFrom}`, after: created } };
  },
});
export async function proposeBonusSchemeAction(input: unknown) {
  return proposeSchemePipeline(input);
}

const decideSchemePipeline = createAction({
  name: "bonus_scheme.decide",
  stepUp: true,
  input: z.object({ id: z.uuid(), decision: z.enum(["approve", "reject"]) }),
  authorize: (user) => canDecideBonusScheme(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decideBonusScheme(input.id, input.decision, user.person.id);
    revalidatePath("/payroll/bonus/scheme");
    return { data: { id: after.id }, audit: { resource: { type: "bonus_scheme", id: after.id, entityId: after.entityId }, summary: `${input.decision} từ ${after.validFrom}`, before, after } };
  },
});
export async function decideBonusSchemeAction(input: unknown) {
  return decideSchemePipeline(input);
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────

const createRunPipeline = createAction({
  name: "bonus_run.create",
  stepUp: true,
  input: z.object({ year, name: z.string().trim().min(1).max(160), entityIds: z.array(z.uuid()).min(1).max(20), payrollMonth: month, note: text(500) }),
  authorize: (user, input) => canManageBonusRun(user.principal, input.entityIds),
  run: async ({ user, input }) => {
    const created = await createBonusRun(input, user.person.id);
    refresh();
    return { data: { id: created.id }, audit: { resource: { type: "bonus_run", id: created.id, entityId: null }, summary: `${created.name} (${created.year})`, after: { year: created.year, name: created.name, entityIds: created.entityIds, payrollMonth: created.payrollMonth } } };
  },
});
export async function createBonusRunAction(input: unknown) {
  return createRunPipeline(input);
}

/** Loads the run first, because who may act is decided by the entities the run covers. */
const overRun = async (runId: string) => {
  const run = await getBonusRun(runId);
  if (!run) throw new ActionError("bonus_run_not_found");
  return run;
};

const simulatePipeline = createAction({
  name: "bonus_run.simulate",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => canManageBonusRun(user.principal, (await overRun(input.runId)).entityIds),
  run: async ({ user, input }) => {
    const { run, cost } = await simulateBonusRun(input.runId, user.person.id);
    refresh(run.id);
    // Counts only: how many people and how many of them get nothing. No đồng in the log.
    return { data: { headcount: cost.totals.headcount, eligible: cost.totals.eligible }, audit: { resource: { type: "bonus_run", id: run.id, entityId: null }, summary: `mô phỏng ${run.year}`, after: { headcount: run.headcount, eligibleCount: run.eligibleCount, overriddenCount: run.overriddenCount } } };
  },
});
export async function simulateBonusRunAction(input: unknown) {
  return simulatePipeline(input);
}

/**
 * The what-if (FR-PAY-21): the whole group's cost under a multiplier table that has not been
 * approved. Stores nothing, so the figures come straight back to the screen that asked.
 */
const whatIfPipeline = createAction({
  name: "bonus_run.what_if",
  stepUp: true,
  input: z.object({ runId: z.uuid(), value: schemeValue }),
  authorize: async (user, input) => canManageBonusRun(user.principal, (await overRun(input.runId)).entityIds),
  run: async ({ input }) => {
    const simulation = await simulateWhatIf(input.runId, checkBonusSchemeValue(input.value));
    return { data: { totals: simulation.cost.totals, byEntity: simulation.cost.byEntity }, audit: { resource: { type: "bonus_run", id: input.runId, entityId: null }, summary: "mô phỏng thử bảng hệ số khác", after: { headcount: simulation.cost.totals.headcount } } };
  },
});
export async function bonusWhatIfAction(input: unknown) {
  return whatIfPipeline(input);
}

const overridePipeline = createAction({
  name: "bonus_run.override_line",
  stepUp: true,
  input: z.object({ runId: z.uuid(), personId: z.uuid(), amount: optional(wholeNumber.pipe(z.number().int().min(0).max(100_000_000_000))), reason: z.string().trim().max(500).default("") }),
  // The owner alone adjusts an individual amount (SRS D13) — not the CEO, not C&B.
  authorize: (user) => canAdjustBonusLine(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await overrideBonusLine({ runId: input.runId, personId: input.personId, amountVnd: input.amount, reason: input.reason }, user.person.id);
    refresh(input.runId);
    // The reason is the point of the record and is kept; the two amounts are not.
    return {
      data: { overridden: after.override !== null },
      audit: { resource: { type: "bonus_run_line", id: `${input.runId}:${input.personId}`, entityId: null }, summary: after.override ? `điều chỉnh: ${after.override.reason}` : "bỏ điều chỉnh", before: { overridden: before.override !== null }, after: { personId: input.personId, overridden: after.override !== null, reason: after.override?.reason ?? null } },
    };
  },
});
export async function overrideBonusLineAction(input: unknown) {
  return overridePipeline(input);
}

const stepPipeline = createAction({
  name: "bonus_run.step",
  stepUp: true,
  input: z.object({ runId: z.uuid(), step: z.enum(["propose", "approve", "return", "cancel"]), comment: text(1000) }),
  authorize: async (user, input) => {
    const run = await overRun(input.runId);
    // Each step asks for its own desk: HR puts it up, the CEO signs or sends it back.
    if (input.step === "propose") return canProposeBonusRun(user.principal, run.entityIds);
    if (input.step === "approve" || input.step === "return") return canApproveBonusRun(user.principal, run.entityIds);
    return canManageBonusRun(user.principal, run.entityIds);
  },
  run: async ({ user, input }) => {
    const { before, after } = await stepBonusRun(input.runId, input.step, user.person.id, { comment: input.comment });
    refresh(input.runId);
    return { data: { status: after.status }, audit: { resource: { type: "bonus_run", id: after.id, entityId: null }, summary: `${before.status} → ${after.status}`, before: { status: before.status }, after: { status: after.status, comment: input.comment } } };
  },
});
export async function stepBonusRunAction(input: unknown) {
  return stepPipeline(input);
}

const payPipeline = createAction({
  name: "bonus_run.pay",
  stepUp: true,
  input: z.object({ runId: z.uuid() }),
  authorize: async (user, input) => canPayBonusRun(user.principal, (await overRun(input.runId)).entityIds),
  run: async ({ user, input }) => {
    const result = await payBonusRun(input.runId, user.person.id);
    refresh(input.runId);
    revalidatePath("/payroll/runs");
    return { data: result, audit: { resource: { type: "bonus_run", id: input.runId, entityId: null }, summary: `chi qua ${result.payrollRuns.length} kỳ lương ngoài kỳ`, after: { payrollRuns: result.payrollRuns.map((run) => ({ entityId: run.entityId, payrollRunId: run.payrollRunId, headcount: run.headcount })) } } };
  },
});
export async function payBonusRunAction(input: unknown) {
  return payPipeline(input);
}
