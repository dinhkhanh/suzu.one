"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { CONFIDENCES, GOAL_LEVELS, METRIC_TYPES, PERIOD_KEY } from "./enums";
import { createCheckIn, createGoal, findGoalParties, findKeyResult, type GoalRow, mayMove, moveGoal, removeKeyResult, reparentGoal, resolveDraft, saveKeyResult, updateGoal } from "./goals";
import { canCheckIn, canEditGoal } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const weight = z.coerce.number().int().min(1).max(100).default(1);
const periodKey = z.string().regex(PERIOD_KEY);

const auditGoal = (goal: Pick<GoalRow, "id" | "entityId">) => ({ type: "goal", id: goal.id, entityId: goal.entityId });
// What the audit log keeps of a goal: enough to see what changed, none of the prose.
const goalFacts = (goal: GoalRow) => ({ title: goal.title, level: goal.level, periodKey: goal.periodKey, status: goal.status, weight: goal.weight, ownerPersonId: goal.ownerPersonId, parentGoalId: goal.parentGoalId, finalProgressBp: goal.finalProgressBp });
function refresh(goalId?: string) {
  revalidatePath("/performance", "layout");
  if (goalId) revalidatePath(`/performance/goals/${goalId}`);
}

const goalDraft = z.object({
  level: z.enum(GOAL_LEVELS),
  entityId: optional(z.uuid()),
  departmentId: optional(z.uuid()),
  teamId: optional(z.uuid()),
  personId: optional(z.uuid()),
  ownerPersonId: optional(z.uuid()),
  parentGoalId: optional(z.uuid()),
  title: z.string().trim().min(1).max(200),
  description: optional(z.string().trim().max(4000)),
  periodKey,
  weight,
  activate: checkbox,
});

// An individual goal is its person's; a unit goal without a named owner is its author's.
const withOwner = (input: z.output<typeof goalDraft>, authorPersonId: string) => ({ ...input, ownerPersonId: input.level === "individual" ? input.personId : (input.ownerPersonId ?? authorPersonId) });

const createGoalPipeline = createAction({
  name: "performance.goal.create",
  input: goalDraft,
  // Where the goal would sit decides who may set it: a unit that does not exist is nobody's.
  authorize: async (user, input) => {
    const resolved = await resolveDraft(withOwner(input, user.person.id));
    return !!resolved && canEditGoal(user.principal, resolved.parties);
  },
  run: async ({ user, input }) => {
    const goal = await createGoal({ principal: user.principal, personId: user.person.id }, withOwner(input, user.person.id));
    refresh();
    return { data: { id: goal.id }, audit: { resource: auditGoal(goal), summary: goal.title, after: goalFacts(goal) } };
  },
});
export async function createGoalAction(input: unknown) {
  return createGoalPipeline(input);
}

const canEdit = async (user: { principal: Parameters<typeof canEditGoal>[0] }, goalId: string) => {
  const found = await findGoalParties(goalId);
  return !!found && canEditGoal(user.principal, found.parties);
};

const updateGoalPipeline = createAction({
  name: "performance.goal.update",
  input: z.object({ goalId: z.uuid(), title: z.string().trim().min(1).max(200), description: optional(z.string().trim().max(4000)), periodKey, weight, ownerPersonId: z.uuid() }),
  authorize: (user, input) => canEdit(user, input.goalId),
  run: async ({ input }) => {
    const { goalId, ...values } = input;
    const { before, after } = await updateGoal(goalId, values);
    refresh(goalId);
    return { data: { id: goalId }, audit: { resource: auditGoal(after), summary: after.title, before: goalFacts(before), after: goalFacts(after) } };
  },
});
export async function updateGoalAction(input: unknown) {
  return updateGoalPipeline(input);
}

const statusPipeline = createAction({
  name: "performance.goal.status",
  input: z.object({ goalId: z.uuid(), move: z.enum(["activate", "close", "cancel", "reopen"]), reason: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const found = await findGoalParties(input.goalId);
    return !!found && mayMove(user.principal, found.goal, found.parties, input.move);
  },
  run: async ({ user, input }) => {
    // Taking a frozen figure back is only done for a reason someone can read later.
    if (input.move === "reopen" && !input.reason) throw new ActionError("reason_required");
    const { before, after } = await moveGoal({ principal: user.principal, personId: user.person.id }, input.goalId, input.move);
    refresh(input.goalId);
    return { data: { id: after.id, status: after.status, finalProgressBp: after.finalProgressBp }, audit: { resource: auditGoal(after), summary: `${after.title}: ${before.status} → ${after.status}${input.reason ? ` — ${input.reason}` : ""}`, before: goalFacts(before), after: goalFacts(after) } };
  },
});
export async function moveGoalAction(input: unknown) {
  return statusPipeline(input);
}

const reparentPipeline = createAction({
  name: "performance.goal.reparent",
  input: z.object({ goalId: z.uuid(), parentGoalId: optional(z.uuid()) }),
  authorize: (user, input) => canEdit(user, input.goalId),
  run: async ({ user, input }) => {
    const { before, after } = await reparentGoal({ principal: user.principal, personId: user.person.id }, input.goalId, input.parentGoalId);
    refresh(input.goalId);
    return { data: { id: after.id }, audit: { resource: auditGoal(after), summary: after.title, before: { parentGoalId: before.parentGoalId }, after: { parentGoalId: after.parentGoalId } } };
  },
});
export async function reparentGoalAction(input: unknown) {
  return reparentPipeline(input);
}

const lines = (value: string | null) => (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

const saveKeyResultPipeline = createAction({
  name: "performance.kr.save",
  input: z.object({
    goalId: z.uuid(),
    keyResultId: optional(z.uuid()),
    title: z.string().trim().min(1).max(200),
    metricType: z.enum(METRIC_TYPES),
    startValue: optional(z.string().trim().max(30)),
    targetValue: optional(z.string().trim().max(30)),
    // One milestone per line.
    milestones: optional(z.string().max(2000)),
    weight,
  }),
  authorize: (user, input) => canEdit(user, input.goalId),
  run: async ({ input }) => {
    const { before, after } = await saveKeyResult(input.goalId, input.keyResultId, { title: input.title, metricType: input.metricType, startValue: input.startValue, targetValue: input.targetValue, milestones: lines(input.milestones).slice(0, 30), weight: input.weight });
    const found = (await findGoalParties(input.goalId))!;
    refresh(input.goalId);
    const facts = (row: typeof after) => ({ title: row.title, metricType: row.metricType, startValue: row.startValue, targetValue: row.targetValue, currentValue: row.currentValue, weight: row.weight, milestones: row.milestones });
    return { data: { id: after.id }, audit: { resource: auditGoal(found.goal), summary: after.title, before: before ? facts(before) : undefined, after: facts(after) } };
  },
});
export async function saveKeyResultAction(input: unknown) {
  return saveKeyResultPipeline(input);
}

const removeKeyResultPipeline = createAction({
  name: "performance.kr.remove",
  input: z.object({ keyResultId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findKeyResult(input.keyResultId);
    return !!found && canEditGoal(user.principal, found.parties);
  },
  run: async ({ input }) => {
    const found = (await findKeyResult(input.keyResultId))!;
    const removed = await removeKeyResult(input.keyResultId);
    refresh(found.goal.id);
    return { data: { id: removed.id }, audit: { resource: auditGoal(found.goal), summary: removed.title, before: { title: removed.title, metricType: removed.metricType, startValue: removed.startValue, targetValue: removed.targetValue } } };
  },
});
export async function removeKeyResultAction(input: unknown) {
  return removeKeyResultPipeline(input);
}

const checkInPipeline = createAction({
  name: "performance.checkin.create",
  input: z.object({
    keyResultId: z.uuid(),
    value: optional(z.string().trim().max(30)),
    // Indexes of the milestones that are done, for a milestone key result.
    doneMilestones: z.array(z.coerce.number().int().min(0).max(100)).max(30).default([]),
    confidence: z.enum(CONFIDENCES),
    note: optional(z.string().trim().max(1000)),
  }),
  authorize: async (user, input) => {
    const found = await findKeyResult(input.keyResultId);
    return !!found && canCheckIn(user.principal, found.parties);
  },
  run: async ({ user, input }) => {
    const found = (await findKeyResult(input.keyResultId))!;
    const { checkIn, before, after } = await createCheckIn({ principal: user.principal, personId: user.person.id }, input.keyResultId, { value: input.value, doneMilestones: input.doneMilestones, confidence: input.confidence, note: input.note });
    refresh(found.goal.id);
    return { data: { id: checkIn.id }, audit: { resource: auditGoal(found.goal), summary: `${found.goal.title} — ${after.title}`, before: { currentValue: before.currentValue, confidence: before.confidence }, after: { currentValue: after.currentValue, confidence: after.confidence, checkInId: checkIn.id } } };
  },
});
export async function createCheckInAction(input: unknown) {
  return checkInPipeline(input);
}
