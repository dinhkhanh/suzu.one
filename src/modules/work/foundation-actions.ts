"use server";
// Phase 10 on the task foundation: custom fields, bulk edit, moves, triage and blockers.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { raiseBlocker, resolveBlocker, findOpenBlocker } from "./blockers";
import { bulkEditTasks, MAX_BULK } from "./bulk";
import { findCustomField, saveCustomField } from "./custom-fields";
import { CUSTOM_FIELD_TYPES } from "./engine/custom-fields";
import { TRIAGE_SOURCES } from "./engine/triage";
import { canContributeToProject, canDecideTriage, canEditTask, canManageCustomFields, canMoveTask, canRaiseBlocker, canResolveBlocker } from "./policy";
import { moveTaskToTeam } from "./move";
import { findProject, listAssignable, projectFacts } from "./projects";
import { loadTask, loadTasks } from "./tasks";
import { findTeam, teamFacts } from "./teams";
import { acceptTriage, declineTriage, deleteTriageRule, findTriageRule, mergeTriage, saveTriageRule, snoozeTriage, triageLink } from "./triage";
import { loadViewer } from "./viewer";

type User = Parameters<typeof loadViewer>[0];
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const patchable = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable()).optional();
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.iso.date();
const auditTask = (taskId: string, entityId: string | null) => ({ type: "task:work", id: taskId, entityId });
const actorOf = (user: User & { person: { fullName: string } }) => ({ personId: user.person.id, fullName: user.person.fullName });

function refreshTask(taskId: string, projectId: string | null, teamId?: string) {
  revalidatePath(`/work/tasks/${taskId}`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
  if (teamId) revalidatePath(`/work/teams/${teamId}`);
  revalidatePath("/tasks");
}

// ── Custom fields (FR-PJM-35) ───────────────────────────────────────────────────────────────

const managesFieldsOf = async (user: User, teamId: string, projectId: string | null) => {
  const viewer = await loadViewer(user);
  if (projectId) {
    const found = await findProject(projectId);
    return !!found && canManageCustomFields(viewer, teamFacts(found.team), projectFacts(found.project, found.team)) && found.team.id === teamId;
  }
  const team = await findTeam(teamId);
  return !!team && canManageCustomFields(viewer, teamFacts(team));
};

const saveFieldPipeline = createAction({
  name: "work.custom_field.save",
  input: z.object({
    fieldId: optional(z.uuid()),
    teamId: z.uuid(),
    projectId: optional(z.uuid()),
    name: z.string().trim().min(1).max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.object({ id: optional(z.string().min(1).max(40)), label: z.string().trim().max(60), color: optional(z.string().max(20)) })).max(50).default([]),
    showOnCard: checkbox.default(false),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
    isActive: checkbox.default(true),
  }),
  // An existing field is changed where it lives, whatever the form claims.
  authorize: async (user, input) => {
    const existing = input.fieldId ? await findCustomField(input.fieldId) : null;
    if (input.fieldId && (!existing || existing.teamId !== input.teamId || existing.projectId !== input.projectId)) return false;
    return managesFieldsOf(user, input.teamId, input.projectId);
  },
  run: async ({ user, input }) => {
    const { fieldId, teamId, projectId, ...values } = input;
    const { before, after, cleared } = await saveCustomField({ teamId, projectId }, fieldId, { ...values, options: values.options.map((option) => ({ id: option.id, label: option.label, color: option.color })) }, user.person.id);
    revalidatePath(`/work/teams/${teamId}`);
    if (projectId) revalidatePath(`/work/projects/${projectId}`);
    return { data: { id: after.id, cleared }, audit: { resource: { type: "work_custom_field", id: after.id }, summary: `${after.name} (${after.type})${cleared ? `, cleared on ${cleared} tasks` : ""}`, before, after } };
  },
});
export async function saveCustomFieldAction(input: unknown) {
  return saveFieldPipeline(input);
}

// ── Bulk edit (FR-PJM-36) ───────────────────────────────────────────────────────────────────

const bulkPipeline = createAction({
  name: "work.task.bulk_update",
  input: z.object({
    taskIds: z.array(z.uuid()).min(1).max(MAX_BULK),
    stateId: z.uuid().optional(),
    assigneePersonId: patchable(z.uuid()),
    startDate: patchable(isoDate),
    dueDate: patchable(isoDate),
    priority: patchable(z.coerce.number().int().min(1).max(4)),
    addLabelIds: z.array(z.uuid()).max(20).optional(),
    removeLabelIds: z.array(z.uuid()).max(20).optional(),
    customValues: z.record(z.uuid(), z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(40)).max(50), z.null()])).optional(),
    cycleId: patchable(z.uuid()),
  }),
  // Each task is checked on its own inside `run`, and refused by name; the action itself needs the
  // right to edit at least one of them, so a stranger learns nothing about the others.
  authorize: async (user, input) => {
    const viewer = await loadViewer(user);
    return [...(await loadTasks(input.taskIds)).values()].some((task) => canEditTask(viewer, task.facts));
  },
  run: async ({ user, input }) => {
    const { taskIds, ...patch } = input;
    const outcome = await bulkEditTasks(await loadViewer(user), taskIds, patch, user.person.id);
    for (const task of outcome.updated) revalidatePath(`/work/tasks/${task.id}`);
    revalidatePath("/work", "layout");
    revalidatePath("/tasks");
    const summary = `${outcome.updated.length} updated, ${outcome.refused.length} refused`;
    return {
      data: { updated: outcome.updated.map(({ id, key }) => ({ id, key })), refused: outcome.refused },
      audit: { resource: { type: "task:work", id: taskIds[0] }, summary, before: { taskIds }, after: { patch, updated: outcome.updated.map((task) => ({ id: task.id, changed: task.changes.map((change) => change.field ?? change.type) })), refused: outcome.refused } },
    };
  },
});
export async function bulkUpdateTasksAction(input: unknown) {
  return bulkPipeline(input);
}

// ── Moving between teams (FR-PJM-34) ────────────────────────────────────────────────────────

const movePipeline = createAction({
  name: "work.task.move",
  input: z.object({ taskId: z.uuid(), teamId: z.uuid(), projectId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const [task, team, project] = await Promise.all([loadTask(input.taskId), findTeam(input.teamId), input.projectId ? findProject(input.projectId) : undefined]);
    if (!task || !team || (input.projectId && !project)) return false;
    return canMoveTask(await loadViewer(user), task.facts, { team: teamFacts(team), project: project ? projectFacts(project.project, project.team) : null });
  },
  run: async ({ user, input }) => {
    const result = await moveTaskToTeam(input.taskId, { teamId: input.teamId, projectId: input.projectId }, user.person.id);
    refreshTask(input.taskId, result.loaded.work.projectId, result.loaded.team.id);
    refreshTask(input.taskId, result.targetProjectId, result.targetTeamId);
    const root = result.moved[0];
    return { data: { key: root.toKey, moved: result.moved.length }, audit: { resource: auditTask(input.taskId, result.loaded.task.entityId), summary: `${root.fromKey} → ${root.toKey} (+${result.moved.length - 1} sub-tasks)`, before: { teamId: result.loaded.team.id, projectId: result.loaded.work.projectId }, after: { teamId: result.targetTeamId, projectId: result.targetProjectId, moved: result.moved } } };
  },
});
export async function moveTaskAction(input: unknown) {
  return movePipeline(input);
}

// ── Triage (FR-PJM-32) ──────────────────────────────────────────────────────────────────────

const decidesTriageOf = async (user: User, taskId: string) => {
  const task = await loadTask(taskId);
  return !!task && canDecideTriage(await loadViewer(user), teamFacts(task.team));
};

const acceptPipeline = createAction({
  name: "work.triage.accept",
  input: z.object({ taskId: z.uuid(), assigneePersonId: optional(z.uuid()), projectId: optional(z.uuid()), dueDate: optional(isoDate), priority: optional(z.coerce.number().int().min(1).max(4)) }),
  authorize: async (user, input) => {
    if (!(await decidesTriageOf(user, input.taskId))) return false;
    if (!input.projectId) return true;
    const found = await findProject(input.projectId);
    return !!found && canContributeToProject(await loadViewer(user), projectFacts(found.project, found.team));
  },
  run: async ({ user, input }) => {
    const { taskId, ...values } = input;
    // Someone the task could be given to: the team's members and the chosen project's.
    if (values.assigneePersonId) {
      const task = (await loadTask(taskId))!;
      const people = await listAssignable(task.team.id, values.projectId);
      if (!people.some((person) => person.id === values.assigneePersonId)) throw new ActionError("person_not_assignable");
    }
    const loaded = await acceptTriage(taskId, values, actorOf(user));
    refreshTask(taskId, values.projectId, loaded.team.id);
    revalidatePath(triageLink(loaded.team.id));
    return { data: { id: taskId }, audit: { resource: auditTask(taskId, loaded.task.entityId), summary: `triage accepted: ${loaded.task.title}`, after: values } };
  },
});
export async function acceptTriageAction(input: unknown) {
  return acceptPipeline(input);
}

const declinePipeline = createAction({
  name: "work.triage.decline",
  input: z.object({ taskId: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => decidesTriageOf(user, input.taskId),
  run: async ({ user, input }) => {
    const loaded = await declineTriage(input.taskId, input.reason, actorOf(user));
    refreshTask(input.taskId, loaded.work.projectId, loaded.team.id);
    revalidatePath(triageLink(loaded.team.id));
    return { data: { id: input.taskId }, audit: { resource: auditTask(input.taskId, loaded.task.entityId), summary: `triage declined: ${loaded.task.title}`, after: { reason: input.reason } } };
  },
});
export async function declineTriageAction(input: unknown) {
  return declinePipeline(input);
}

const mergePipeline = createAction({
  name: "work.triage.merge",
  input: z.object({ taskId: z.uuid(), intoTaskId: z.uuid() }),
  // The request's brief lands on the other task: the lead must be able to work on that one too.
  authorize: async (user, input) => {
    if (!(await decidesTriageOf(user, input.taskId))) return false;
    const into = await loadTask(input.intoTaskId);
    return !!into && canEditTask(await loadViewer(user), into.facts);
  },
  run: async ({ user, input }) => {
    const { loaded, into } = await mergeTriage(input.taskId, input.intoTaskId, actorOf(user));
    refreshTask(input.taskId, loaded.work.projectId, loaded.team.id);
    refreshTask(input.intoTaskId, into.work.projectId);
    revalidatePath(triageLink(loaded.team.id));
    return { data: { id: input.taskId }, audit: { resource: auditTask(input.taskId, loaded.task.entityId), summary: `triage merged into ${input.intoTaskId}`, after: input } };
  },
});
export async function mergeTriageAction(input: unknown) {
  return mergePipeline(input);
}

const snoozePipeline = createAction({
  name: "work.triage.snooze",
  input: z.object({ taskId: z.uuid(), until: isoDate }),
  authorize: (user, input) => decidesTriageOf(user, input.taskId),
  run: async ({ user, input }) => {
    const loaded = await snoozeTriage(input.taskId, input.until, user.person.id, todayInVietnam());
    revalidatePath(triageLink(loaded.team.id));
    return { data: { id: input.taskId }, audit: { resource: auditTask(input.taskId, loaded.task.entityId), summary: `triage snoozed until ${input.until}`, after: { until: input.until } } };
  },
});
export async function snoozeTriageAction(input: unknown) {
  return snoozePipeline(input);
}

const decidesTriageForTeam = async (user: User, teamId: string) => {
  const team = await findTeam(teamId);
  return !!team && canDecideTriage(await loadViewer(user), teamFacts(team));
};

const saveRulePipeline = createAction({
  name: "work.triage_rule.save",
  input: z.object({
    ruleId: optional(z.uuid()),
    teamId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    source: optional(z.enum(TRIAGE_SOURCES)),
    intakeFormId: optional(z.uuid()),
    keyword: optional(z.string().trim().max(200)),
    assigneePersonId: optional(z.uuid()),
    projectId: optional(z.uuid()),
    labelIds: z.array(z.uuid()).max(10).default([]),
    priority: optional(z.coerce.number().int().min(1).max(4)),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
    isActive: checkbox.default(true),
  }),
  authorize: async (user, input) => {
    const existing = input.ruleId ? await findTriageRule(input.ruleId) : null;
    if (input.ruleId && existing?.teamId !== input.teamId) return false;
    return decidesTriageForTeam(user, input.teamId);
  },
  run: async ({ user, input }) => {
    const drop = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && !(Array.isArray(item) && item.length === 0))) as { [Key in keyof T]?: NonNullable<T[Key]> };
    const match = drop({ source: input.source ?? undefined, intakeFormId: input.intakeFormId ?? undefined, keyword: input.keyword ?? undefined });
    const set = drop({ assigneePersonId: input.assigneePersonId ?? undefined, projectId: input.projectId ?? undefined, labelIds: input.labelIds, priority: input.priority ?? undefined });
    const { before, after } = await saveTriageRule(input.teamId, input.ruleId, { name: input.name, match, set, sortOrder: input.sortOrder, isActive: input.isActive }, user.person.id);
    revalidatePath(triageLink(input.teamId));
    return { data: { id: after.id }, audit: { resource: { type: "work_triage_rule", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveTriageRuleAction(input: unknown) {
  return saveRulePipeline(input);
}

const deleteRulePipeline = createAction({
  name: "work.triage_rule.delete",
  input: z.object({ ruleId: z.uuid() }),
  authorize: async (user, input) => {
    const rule = await findTriageRule(input.ruleId);
    return !!rule && decidesTriageForTeam(user, rule.teamId);
  },
  run: async ({ input }) => {
    const rule = await deleteTriageRule(input.ruleId);
    revalidatePath(triageLink(rule.teamId));
    return { data: { id: rule.id }, audit: { resource: { type: "work_triage_rule", id: rule.id }, summary: rule.name, before: rule } };
  },
});
export async function deleteTriageRuleAction(input: unknown) {
  return deleteRulePipeline(input);
}

// ── Blockers (FR-PJM-28) ────────────────────────────────────────────────────────────────────

const raisePipeline = createAction({
  name: "work.blocker.raise",
  input: z.object({ taskId: z.uuid(), reason: z.string().trim().min(1).max(500), neededPersonId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    if (!task || !canRaiseBlocker(await loadViewer(user), task.facts)) return false;
    // The person it waits for comes from the task's assignable list: nobody outside the work is paged.
    return !input.neededPersonId || (await listAssignable(task.team.id, task.work.projectId)).some((person) => person.id === input.neededPersonId);
  },
  run: async ({ user, input }) => {
    const { blocker, loaded, notified } = await raiseBlocker(input.taskId, { reason: input.reason, neededPersonId: input.neededPersonId }, actorOf(user));
    refreshTask(input.taskId, loaded.work.projectId, loaded.team.id);
    revalidatePath("/work/leader");
    return { data: { id: blocker.id }, audit: { resource: auditTask(input.taskId, loaded.task.entityId), summary: `blocked: ${input.reason}`, after: { blockerId: blocker.id, neededPersonId: input.neededPersonId, notified: notified.length } } };
  },
});
export async function raiseBlockerAction(input: unknown) {
  return raisePipeline(input);
}

const resolvePipeline = createAction({
  name: "work.blocker.resolve",
  input: z.object({ taskId: z.uuid(), resolution: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const [task, blocker] = await Promise.all([loadTask(input.taskId), findOpenBlocker(input.taskId)]);
    return !!task && !!blocker && canResolveBlocker(await loadViewer(user), task.facts, blocker);
  },
  run: async ({ user, input }) => {
    const { blocker, loaded } = await resolveBlocker(input.taskId, input.resolution, actorOf(user));
    refreshTask(input.taskId, loaded.work.projectId, loaded.team.id);
    revalidatePath("/work/leader");
    return { data: { id: blocker.id }, audit: { resource: auditTask(input.taskId, loaded.task.entityId), summary: `unblocked: ${blocker.reason}`, after: { blockerId: blocker.id, resolution: input.resolution } } };
  },
});
export async function resolveBlockerAction(input: unknown) {
  return resolvePipeline(input);
}
