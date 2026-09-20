"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { computeResults, findResult, findResultById, lockResult, overrideResult, type PerformanceResultRow, publishResult, unlockResult } from "./final-results";
import { loadDirectory } from "./people";
import { canComputeResults, canDecidePerformanceRules, canOverrideResult, canProposeWeighting, canSettleResultOf, type PersonContext } from "./policy";
import { decideWeighting, proposeWeighting } from "./weighting";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const year = z.coerce.number().int().min(2000).max(2100);
/** Percentages as typed ("103,5" → 10350 bp). */
const percentBp = z.coerce.number().min(0).max(10_000).transform((value) => Math.round(value * 100));

const refresh = () => revalidatePath("/performance", "layout");

// What the audit keeps of a result: the figures and the decision, never the prose of a review.
const resultFacts = (row: PerformanceResultRow) => ({ personId: row.personId, year: row.year, computedScoreBp: row.computedScoreBp, computedBand: row.computedBand, overrideScoreBp: row.overrideScoreBp, finalScoreBp: row.finalScoreBp, finalBand: row.finalBand, multiplierBp: row.multiplierBp, status: row.status });

const personOf = async (personId: string): Promise<PersonContext | null> => (await loadDirectory()).get(personId) ?? null;

// ── The weighting (configuration: HR proposes, the owner decides) ───────────────────────────

const proposeWeightingPipeline = createAction({
  name: "performance.weighting.propose",
  input: z.object({
    entityId: optional(z.uuid()),
    validFrom: isoDate,
    note: optional(z.string().trim().max(2000)),
    reviewPercent: z.coerce.number().min(0).max(100),
    kpiPercent: z.coerce.number().min(0).max(100),
    okrPercent: z.coerce.number().min(0).max(100),
    okrIndividualPercent: z.coerce.number().min(0).max(100),
    okrTeamPercent: z.coerce.number().min(0).max(100),
    okrDepartmentPercent: z.coerce.number().min(0).max(100),
    okrEntityPercent: z.coerce.number().min(0).max(100),
    okrGroupPercent: z.coerce.number().min(0).max(100),
    // Posted as `bands.0.key`, `bands.1.key`, … which the form nester turns into an object.
    bands: z.preprocess(
      (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : value),
      z.array(
        z.object({
          key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
          label: z.string().trim().min(1).max(120),
          labelEn: optional(z.string().trim().max(120)),
          minPercent: z.coerce.number().min(0).max(10_000),
          multiplierPercent: z.coerce.number().min(0).max(10_000),
        }),
      )
        .min(1)
        .max(12),
    ),
  }),
  authorize: (user) => canProposeWeighting(user.principal),
  run: async ({ user, input }) => {
    const value = {
      reviewBp: Math.round(input.reviewPercent * 100),
      kpiBp: Math.round(input.kpiPercent * 100),
      okrBp: Math.round(input.okrPercent * 100),
      okrMix: {
        individualBp: Math.round(input.okrIndividualPercent * 100),
        teamBp: Math.round(input.okrTeamPercent * 100),
        departmentBp: Math.round(input.okrDepartmentPercent * 100),
        entityBp: Math.round(input.okrEntityPercent * 100),
        groupBp: Math.round(input.okrGroupPercent * 100),
      },
      bands: input.bands.map((band) => ({ key: band.key, label: band.label, labelEn: band.labelEn, minScoreBp: Math.round(band.minPercent * 100), multiplierBp: Math.round(band.multiplierPercent * 100) })),
    };
    const row = await proposeWeighting({ entityId: input.entityId, value, validFrom: input.validFrom, note: input.note }, user.person.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "performance_weighting", id: row.id, entityId: row.entityId }, summary: `weighting from ${row.validFrom}`, after: { validFrom: row.validFrom, value } } };
  },
});
export async function proposeWeightingAction(input: unknown) {
  return proposeWeightingPipeline(input);
}

const decideWeightingPipeline = createAction({
  name: "performance.weighting.decide",
  input: z.object({ id: z.uuid(), decision: z.enum(["approve", "reject"]) }),
  authorize: (user) => canDecidePerformanceRules(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decideWeighting(input.id, input.decision, user.person.id);
    refresh();
    return { data: { status: after.status }, audit: { resource: { type: "performance_weighting", id: after.id, entityId: after.entityId }, summary: `${before.status} → ${after.status}`, before: { status: before.status }, after: { status: after.status, validFrom: after.validFrom, validTo: after.validTo } } };
  },
});
export async function decideWeightingAction(input: unknown) {
  return decideWeightingPipeline(input);
}

// ── Computing, overriding, locking, publishing ──────────────────────────────────────────────

const computePipeline = createAction({
  name: "performance.result.compute",
  input: z.object({ year, personIds: z.preprocess((value) => (typeof value === "string" ? [value] : value), z.array(z.uuid()).min(1).max(2000)) }),
  // Every person asked for must be in the caller's reach: one they may not manage fails the lot.
  authorize: async (user, input) => {
    const directory = await loadDirectory();
    return input.personIds.every((personId) => {
      const person = directory.get(personId);
      return !!person && canComputeResults(user.principal, person.entityId ?? null);
    });
  },
  run: async ({ user, input }) => {
    const summary = await computeResults({ personIds: input.personIds, year: input.year }, user.person.id);
    refresh();
    return { data: summary, audit: { resource: { type: "performance_result", id: String(input.year) }, summary: `${input.year}: computed ${summary.computed}, skipped ${summary.skipped.length}`, after: { year: input.year, computed: summary.computed, skipped: summary.skipped.length } } };
  },
});
export async function computeResultsAction(input: unknown) {
  return computePipeline(input);
}

const overridePipeline = createAction({
  name: "performance.result.override",
  // A reason is the point of an override (SRS D13): the amount it moves must be explainable.
  input: z.object({ resultId: z.uuid(), scorePercent: optional(percentBp), reason: z.string().trim().min(5).max(2000) }),
  authorize: (user) => canOverrideResult(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await overrideResult(input.resultId, { scoreBp: input.scorePercent, reason: input.reason }, user.person.id);
    refresh();
    return { data: { finalScoreBp: after.finalScoreBp, finalBand: after.finalBand }, audit: { resource: { type: "performance_result", id: after.id, entityId: after.entityId }, summary: input.scorePercent === null ? "override removed" : `override → ${after.finalScoreBp} bp`, before: resultFacts(before), after: { ...resultFacts(after), overrideReason: after.overrideReason } } };
  },
});
export async function overrideResultAction(input: unknown) {
  return overridePipeline(input);
}

const settle = (name: string, step: (resultId: string, actorPersonId: string) => Promise<{ before: PerformanceResultRow; after: PerformanceResultRow }>) =>
  createAction({
    name,
    input: z.object({ resultId: z.uuid() }),
    authorize: async (user, input) => {
      const row = await findResultById(input.resultId);
      if (!row) return false;
      const person = await personOf(row.personId);
      return !!person && canSettleResultOf(user.principal, person);
    },
    run: async ({ user, input }) => {
      const { before, after } = await step(input.resultId, user.person.id);
      refresh();
      return { data: { status: after.status }, audit: { resource: { type: "performance_result", id: after.id, entityId: after.entityId }, summary: `${before.status} → ${after.status}`, before: resultFacts(before), after: resultFacts(after) } };
    },
  });

const lockPipeline = settle("performance.result.lock", lockResult);
export async function lockResultAction(input: unknown) {
  return lockPipeline(input);
}

const publishPipeline = settle("performance.result.publish", publishResult);
export async function publishResultAction(input: unknown) {
  return publishPipeline(input);
}

const unlockPipeline = settle("performance.result.unlock", (resultId) => unlockResult(resultId));
export async function unlockResultAction(input: unknown) {
  return unlockPipeline(input);
}

/** The whole year for one person, for the "recompute" button on a single row. */
const recomputeOnePipeline = createAction({
  name: "performance.result.recompute",
  input: z.object({ personId: z.uuid(), year }),
  authorize: async (user, input) => {
    const person = await personOf(input.personId);
    return !!person && canComputeResults(user.principal, person.entityId ?? null);
  },
  run: async ({ user, input }) => {
    const summary = await computeResults({ personIds: [input.personId], year: input.year }, user.person.id);
    const row = await findResult(input.personId, input.year);
    refresh();
    return { data: summary, audit: { resource: { type: "performance_result", id: row?.id ?? input.personId, entityId: row?.entityId ?? null }, summary: `recomputed ${input.year}`, after: row ? resultFacts(row) : { year: input.year } } };
  },
});
export async function recomputeResultAction(input: unknown) {
  return recomputeOnePipeline(input);
}
