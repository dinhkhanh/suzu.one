"use server";
// Hand-offs (FR-PJM-40..46): packages, stage hand-offs with accept / return, cross-team hand-offs,
// leave cover, exit handover and account handover.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { acknowledgeCover, coverPlanFacts, findCoverPlan, handBackCover, saveCoverPlan, submitCoverPlan, syncCoverPlans } from "./cover";
import { HANDOFF_FIELD_TYPES, MAX_NOTE_LINKS, MAX_PACKAGE_CHECKS, MAX_PACKAGE_FIELDS } from "./engine/handoff";
import { OWNERSHIP_KINDS } from "./engine/exit";
import { completeExitHandover, exitHandoverFacts, findExitHandover, reassignOwnership } from "./exit";
import { acceptHandoff, changeAccountManager, deletePackage, findHandoff, findPackage, handOffStage, returnHandoff, savePackage, sendToTeam } from "./handoffs";
import { canAcknowledgeCover, canChangeAccountManager, canHandBackCover, canHandOff, canManageHandoffPackages, canRespondToHandoff, canRunExitHandover, canSendToTeam, canSubmitCoverPlan } from "./policy";
import { loadTask } from "./tasks";
import { findClient, findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

type User = Parameters<typeof loadViewer>[0] & { person: { fullName: string } };
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const actorOf = (user: User) => ({ personId: user.person.id, fullName: user.person.fullName });
const text = (max: number) => z.string().trim().max(max).optional();

/** FR-PJM-43: one note shape everywhere. */
const noteInput = z.object({ context: text(4000), state: text(4000), done: text(4000), next: text(4000), questions: text(4000), contacts: text(2000), links: z.array(z.string().trim().max(1000)).max(MAX_NOTE_LINKS).default([]) }).default({ links: [] });

function refreshTask(taskId: string, projectId?: string | null) {
  revalidatePath(`/work/tasks/${taskId}`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/tasks");
  revalidatePath("/today");
}

// ── Packages (FR-PJM-40) ────────────────────────────────────────────────────────────────────

const managesPackagesOf = async (user: User, teamId: string) => {
  const team = await findTeam(teamId);
  return !!team && canManageHandoffPackages(await loadViewer(user), teamFacts(team));
};

const savePackagePipeline = createAction({
  name: "work.handoff_package.save",
  input: z.object({
    packageId: optional(z.uuid()),
    teamId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    fromStateId: optional(z.uuid()),
    toStateId: z.uuid(),
    fields: z.array(z.object({ key: optional(z.string().regex(/^[a-z0-9_]{1,40}$/)), label: z.string().trim().min(1).max(80), type: z.enum(HANDOFF_FIELD_TYPES), required: checkbox.default(true) })).max(MAX_PACKAGE_FIELDS).default([]),
    checklist: z.array(z.object({ id: optional(z.string().regex(/^[a-z0-9_]{1,40}$/)), text: z.string().trim().min(1).max(200) })).max(MAX_PACKAGE_CHECKS).default([]),
    requireLink: checkbox.default(false),
    requireFile: checkbox.default(false),
    requireAccept: checkbox.default(true),
    isActive: checkbox.default(true),
  }),
  // An existing package is changed in its own team, whatever the form claims.
  authorize: async (user, input) => {
    const existing = input.packageId ? await findPackage(input.packageId) : null;
    if (input.packageId && existing?.teamId !== input.teamId) return false;
    return managesPackagesOf(user, input.teamId);
  },
  run: async ({ user, input }) => {
    const { packageId, teamId, ...values } = input;
    const { before, after } = await savePackage(teamId, packageId, values, user.person.id);
    revalidatePath(`/work/teams/${teamId}/handoffs`);
    return { data: { id: after.id }, audit: { resource: { type: "work_handoff_package", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveHandoffPackageAction(input: unknown) {
  return savePackagePipeline(input);
}

const deletePackagePipeline = createAction({
  name: "work.handoff_package.delete",
  input: z.object({ packageId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findPackage(input.packageId);
    return !!found && managesPackagesOf(user, found.teamId);
  },
  run: async ({ input }) => {
    const row = await deletePackage(input.packageId);
    revalidatePath(`/work/teams/${row.teamId}/handoffs`);
    return { data: { id: row.id }, audit: { resource: { type: "work_handoff_package", id: row.id }, summary: row.name, before: row } };
  },
});
export async function deleteHandoffPackageAction(input: unknown) {
  return deletePackagePipeline(input);
}

// ── Stage hand-off, accept, return (FR-PJM-40, 41) ──────────────────────────────────────────

const handOffPipeline = createAction({
  name: "work.handoff.stage",
  input: z.object({
    taskId: z.uuid(),
    toStateId: z.uuid(),
    values: z.record(z.string().max(40), z.string().max(2000)).default({}),
    checked: z.array(z.string().max(40)).max(MAX_PACKAGE_CHECKS).default([]),
    links: z.array(z.string().trim().max(1000)).max(MAX_NOTE_LINKS).default([]),
    fileId: optional(z.uuid()),
    toPersonId: optional(z.uuid()),
    note: noteInput,
  }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canHandOff(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { taskId, ...rest } = input;
    const { handoff, loaded } = await handOffStage(taskId, rest, actorOf(user));
    refreshTask(taskId, loaded.work.projectId);
    return { data: { id: handoff?.id ?? null, status: handoff?.status ?? null }, audit: { resource: { type: "task:work", id: taskId, entityId: loaded.task.entityId }, summary: `${loaded.task.title}: hand-off → ${input.toStateId}`, after: handoff ?? { stateId: input.toStateId } } };
  },
});
export async function handOffTaskAction(input: unknown) {
  return handOffPipeline(input);
}

const respondsTo = async (user: User, handoffId: string) => {
  const handoff = await findHandoff(handoffId);
  if (!handoff?.taskId) return false;
  const task = await loadTask(handoff.taskId);
  return !!task && canRespondToHandoff(await loadViewer(user), task.facts, handoff);
};

const acceptPipeline = createAction({
  name: "work.handoff.accept",
  input: z.object({ handoffId: z.uuid() }),
  authorize: (user, input) => respondsTo(user, input.handoffId),
  run: async ({ user, input }) => {
    const { handoff, loaded } = await acceptHandoff(input.handoffId, actorOf(user));
    refreshTask(loaded.task.id, loaded.work.projectId);
    return { data: { id: handoff.id }, audit: { resource: { type: "work_handoff", id: handoff.id, entityId: loaded.task.entityId }, summary: `accepted: ${loaded.task.title}`, after: { status: handoff.status } } };
  },
});
export async function acceptHandoffAction(input: unknown) {
  return acceptPipeline(input);
}

const returnPipeline = createAction({
  name: "work.handoff.return",
  input: z.object({ handoffId: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => respondsTo(user, input.handoffId),
  run: async ({ user, input }) => {
    const { handoff, loaded } = await returnHandoff(input.handoffId, input.reason, actorOf(user));
    refreshTask(loaded.task.id, loaded.work.projectId);
    return { data: { id: handoff.id }, audit: { resource: { type: "work_handoff", id: handoff.id, entityId: loaded.task.entityId }, summary: `returned: ${loaded.task.title}`, after: { status: handoff.status, reason: input.reason } } };
  },
});
export async function returnHandoffAction(input: unknown) {
  return returnPipeline(input);
}

// ── Cross-team (FR-PJM-42) ──────────────────────────────────────────────────────────────────

const sendToTeamPipeline = createAction({
  name: "work.handoff.cross_team",
  input: z.object({ taskId: z.uuid(), teamId: z.uuid(), title: z.string().trim().min(1).max(200), dueDate: optional(z.iso.date()), note: noteInput }),
  authorize: async (user, input) => {
    const [task, team] = await Promise.all([loadTask(input.taskId), findTeam(input.teamId)]);
    return !!task && !!team?.isActive && canSendToTeam(await loadViewer(user), task.facts, teamFacts(team));
  },
  run: async ({ user, input }) => {
    const { taskId, ...rest } = input;
    const { handoff, loaded, target } = await sendToTeam(taskId, rest, actorOf(user));
    refreshTask(taskId, loaded.work.projectId);
    revalidatePath(`/work/teams/${input.teamId}/triage`);
    return { data: { id: handoff.id, targetKey: target.key }, audit: { resource: { type: "task:work", id: taskId, entityId: loaded.task.entityId }, summary: `${loaded.task.title} → ${target.key}`, after: { handoffId: handoff.id, teamId: input.teamId, targetTaskId: target.id } } };
  },
});
export async function sendToTeamAction(input: unknown) {
  return sendToTeamPipeline(input);
}

// ── Account handover (FR-PJM-46) ────────────────────────────────────────────────────────────

const accountPipeline = createAction({
  name: "work.client.account_manager",
  input: z.object({ clientId: z.uuid(), toPersonId: z.uuid(), note: noteInput }),
  authorize: async (user, input) => !!(await findClient(input.clientId)) && canChangeAccountManager(await loadViewer(user)),
  run: async ({ user, input }) => {
    const result = await changeAccountManager(input.clientId, { toPersonId: input.toPersonId, note: input.note }, actorOf(user));
    revalidatePath("/work/clients");
    for (const project of result.projects) revalidatePath(`/work/projects/${project.id}`);
    return {
      data: { projects: result.projects.length, skipped: result.skipped.map((project) => project.name) },
      audit: { resource: { type: "work_client", id: input.clientId }, summary: `account manager → ${input.toPersonId} (${result.projects.length} projects)`, before: { accountManagerPersonId: result.before }, after: { accountManagerPersonId: result.after, projects: result.projects, skipped: result.skipped, note: result.handoff.note } },
    };
  },
});
export async function changeAccountManagerAction(input: unknown) {
  return accountPipeline(input);
}

// ── Leave cover (FR-PJM-44) ─────────────────────────────────────────────────────────────────

const coverChoice = {
  planId: z.uuid(),
  defaultCoverPersonId: optional(z.uuid()),
  items: z.array(z.object({ id: z.uuid(), coverPersonId: optional(z.uuid()) })).max(500).default([]),
  note: noteInput,
};

const coverPlanOf = async (planId: string) => {
  const plan = await findCoverPlan(planId);
  return plan ? { plan, facts: await coverPlanFacts(plan) } : null;
};

const saveCoverPipeline = createAction({
  name: "work.cover.save",
  input: z.object(coverChoice),
  authorize: async (user, input) => {
    const found = await coverPlanOf(input.planId);
    return !!found && canSubmitCoverPlan(await loadViewer(user), found.facts);
  },
  run: async ({ input }) => {
    const { planId, ...choice } = input;
    const plan = await saveCoverPlan(planId, choice);
    revalidatePath(`/work/cover/${planId}`);
    return { data: { id: plan.id }, audit: { resource: { type: "work_cover_plan", id: plan.id }, summary: "cover plan saved", after: choice } };
  },
});
export async function saveCoverPlanAction(input: unknown) {
  return saveCoverPipeline(input);
}

const submitCoverPipeline = createAction({
  name: "work.cover.submit",
  input: z.object(coverChoice),
  authorize: async (user, input) => {
    const found = await coverPlanOf(input.planId);
    return !!found && canSubmitCoverPlan(await loadViewer(user), found.facts);
  },
  run: async ({ user, input }) => {
    const { planId, ...choice } = input;
    const { plan, covers, applied } = await submitCoverPlan(planId, choice, actorOf(user), todayInVietnam());
    revalidatePath(`/work/cover/${planId}`);
    revalidatePath("/tasks");
    return { data: { id: plan.id, covers: covers.length, applied }, audit: { resource: { type: "work_cover_plan", id: plan.id }, summary: `cover plan submitted: ${covers.length} covers${applied ? ", applied" : ""}`, after: { ...choice, covers } } };
  },
});
export async function submitCoverPlanAction(input: unknown) {
  return submitCoverPipeline(input);
}

const acknowledgePipeline = createAction({
  name: "work.cover.acknowledge",
  input: z.object({ planId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await coverPlanOf(input.planId);
    return !!found && canAcknowledgeCover(await loadViewer(user), found.facts);
  },
  run: async ({ user, input }) => {
    const count = await acknowledgeCover(input.planId, actorOf(user));
    revalidatePath(`/work/cover/${input.planId}`);
    revalidatePath("/tasks");
    return { data: { acknowledged: count }, audit: { resource: { type: "work_cover_plan", id: input.planId }, summary: `acknowledged ${count} items` } };
  },
});
export async function acknowledgeCoverAction(input: unknown) {
  return acknowledgePipeline(input);
}

const handBackPipeline = createAction({
  name: "work.cover.hand_back",
  input: z.object({ planId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await coverPlanOf(input.planId);
    return !!found && canHandBackCover(await loadViewer(user), found.facts);
  },
  run: async ({ user, input }) => {
    const { returned, covers } = await handBackCover(input.planId, actorOf(user));
    revalidatePath(`/work/cover/${input.planId}`);
    revalidatePath("/tasks");
    return { data: { returned }, audit: { resource: { type: "work_cover_plan", id: input.planId }, summary: `handed back ${returned} items`, after: { covers } } };
  },
});
export async function handBackCoverAction(input: unknown) {
  return handBackPipeline(input);
}

/** The on-demand check (FR-PJM-44): the person's own leave, now, instead of waiting for the night's job. */
const checkCoverPipeline = createAction({
  name: "work.cover.check",
  input: z.object({}),
  authorize: (user) => !!user.person.id,
  run: async ({ user }) => {
    const result = await syncCoverPlans(todayInVietnam(), { personId: user.person.id });
    revalidatePath("/tasks");
    return { data: result, audit: { resource: { type: "work_cover_plan", id: user.person.id }, summary: `drafted ${result.drafted}, cancelled ${result.cancelled}` } };
  },
});
export async function checkMyCoverPlansAction(input: unknown) {
  return checkCoverPipeline(input);
}

// ── Exit / transfer handover (FR-PJM-45) ────────────────────────────────────────────────────

const runsHandover = async (user: User, handoverId: string) => {
  const handover = await findExitHandover(handoverId);
  return !!handover && canRunExitHandover(await loadViewer(user), await exitHandoverFacts(handover));
};

const reassignPipeline = createAction({
  name: "work.exit.reassign",
  input: z.object({ handoverId: z.uuid(), toPersonId: z.uuid(), items: z.array(z.object({ kind: z.enum(OWNERSHIP_KINDS), id: z.uuid() })).min(1).max(500), note: noteInput }),
  authorize: (user, input) => runsHandover(user, input.handoverId),
  run: async ({ user, input }) => {
    const { handoverId, ...rest } = input;
    const result = await reassignOwnership(handoverId, rest, actorOf(user));
    revalidatePath(`/work/handover/${handoverId}`);
    revalidatePath("/tasks");
    revalidatePath("/work", "layout");
    return { data: { moved: result.moved.length, remaining: result.remaining }, audit: { resource: { type: "work_exit_handover", id: handoverId }, summary: `${result.moved.length} items → ${input.toPersonId}, ${result.remaining} left`, after: { toPersonId: input.toPersonId, moved: result.moved, note: input.note } } };
  },
});
export async function reassignOwnershipAction(input: unknown) {
  return reassignPipeline(input);
}

const completeHandoverPipeline = createAction({
  name: "work.exit.complete",
  input: z.object({ handoverId: z.uuid() }),
  authorize: (user, input) => runsHandover(user, input.handoverId),
  run: async ({ user, input }) => {
    const after = await completeExitHandover(input.handoverId, user.person.id);
    revalidatePath(`/work/handover/${input.handoverId}`);
    revalidatePath("/tasks");
    revalidatePath(`/people/${after.personId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_exit_handover", id: after.id }, summary: "work handover done", after: { status: after.status } } };
  },
});
export async function completeExitHandoverAction(input: unknown) {
  return completeHandoverPipeline(input);
}
