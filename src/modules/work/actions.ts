"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { findOrgUnit } from "../platform/org/service";
import { addComment, deleteComment, editComment, findComment, toggleReaction } from "./comments";
import { beginTaskUpload, completeTaskUpload, findTaskFile, removeTaskFile, taskFileLink } from "./attachments";
import { FILTER_KEYS, isFilterKey } from "./engine/filter";
import { setFollowing } from "./followers";
import { CHANNELS, CLIENT_KINDS, CONTENT_FORMATS, DEPENDENCY_TYPES, LABEL_COLORS, PROJECT_ROLES, PROJECT_STATUSES, REACTIONS, STATE_CATEGORIES, TEAM_ROLES, VISIBILITIES, WORKFLOW_PRESETS } from "./enums";
import { canAdminTeam, canContributeToProject, canViewProject, canContributeToTeam, canCreateProject, canDeleteTask, canEditTask, canManageProject, canManageWorkspace, canModerateTask, canViewTask } from "./policy";
import { createProject, findProject, projectFacts, setProjectMember, updateProject } from "./projects";
import { addDependency, createWorkTask, deleteWorkTask, findDependency, loadTask, removeDependency, updateWorkTask } from "./tasks";
import { createTeam, deleteLabel, findLabel, findTeam, saveClient, saveLabel, saveState, setTeamMember, teamFacts, updateTeam } from "./teams";
import { loadViewer } from "./viewer";
import { createSavedView, deleteSavedView, findSavedView } from "./views";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
/** For patches: absent = leave alone, blank = clear. */
const patchable = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable()).optional();
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.iso.date();

// ── Teams ───────────────────────────────────────────────────────────────────────────────────

const teamFields = {
  name: z.string().trim().min(1).max(80),
  description: optional(z.string().trim().max(500)),
  entityId: optional(z.uuid()),
  departmentId: optional(z.uuid()),
  defaultVisibility: z.enum(VISIBILITIES),
  isActive: checkbox.default(true),
};

const createTeamPipeline = createAction({
  name: "work.team.create",
  input: z.object({ ...teamFields, key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,7}$/), preset: z.enum(Object.keys(WORKFLOW_PRESETS) as [keyof typeof WORKFLOW_PRESETS, ...(keyof typeof WORKFLOW_PRESETS)[]]), stateNames: z.record(z.string(), z.string().trim().min(1).max(40)).default({}) }),
  authorize: async (user, input) => canManageWorkspace(await loadViewer(user), { entityId: input.entityId, departmentId: input.departmentId }),
  run: async ({ user, input }) => {
    const { preset, stateNames, ...values } = input;
    if (values.departmentId && !(await findOrgUnit(values.departmentId))) values.departmentId = null;
    const team = await createTeam(values, preset, stateNames, user.person.id);
    revalidatePath("/work");
    return { data: { id: team.id }, audit: { resource: { type: "work_team", id: team.id, entityId: team.entityId }, summary: `${team.key}: ${team.name}`, after: team } };
  },
});
export async function createTeamAction(input: unknown) {
  return createTeamPipeline(input);
}

const updateTeamPipeline = createAction({
  name: "work.team.update",
  input: z.object({ teamId: z.uuid(), ...teamFields }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    if (!team) return false;
    const viewer = await loadViewer(user);
    // Moving a team to another entity or department takes authority over where it goes, too.
    const moved = team.entityId !== input.entityId || team.departmentId !== input.departmentId;
    return canAdminTeam(viewer, teamFacts(team)) && (!moved || canManageWorkspace(viewer, { entityId: input.entityId, departmentId: input.departmentId }));
  },
  run: async ({ input }) => {
    const { teamId, ...values } = input;
    const { before, after } = await updateTeam(teamId, values);
    revalidatePath("/work");
    revalidatePath(`/work/teams/${teamId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_team", id: after.id, entityId: after.entityId }, summary: after.name, before, after } };
  },
});
export async function updateTeamAction(input: unknown) {
  return updateTeamPipeline(input);
}

const adminsTeam = async (user: Parameters<typeof loadViewer>[0], teamId: string) => {
  const team = await findTeam(teamId);
  return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
};

const teamMemberPipeline = createAction({
  name: "work.team.member",
  input: z.object({ teamId: z.uuid(), personId: z.uuid(), role: z.preprocess(blankToNull, z.enum(TEAM_ROLES).nullable()) }),
  authorize: (user, input) => adminsTeam(user, input.teamId),
  run: async ({ input }) => {
    const change = await setTeamMember(input.teamId, input.personId, input.role);
    revalidatePath(`/work/teams/${input.teamId}`);
    return { data: change, audit: { resource: { type: "work_team", id: input.teamId }, summary: `member ${input.personId}: ${change.before ?? "—"} → ${change.after ?? "—"}`, before: { personId: input.personId, role: change.before }, after: { personId: input.personId, role: change.after } } };
  },
});
export async function setTeamMemberAction(input: unknown) {
  return teamMemberPipeline(input);
}

const statePipeline = createAction({
  name: "work.state.save",
  input: z.object({ teamId: z.uuid(), stateId: optional(z.uuid()), name: z.string().trim().min(1).max(40), category: z.enum(STATE_CATEGORIES), sortOrder: z.coerce.number().int().min(0).max(10000), isActive: checkbox.default(true) }),
  authorize: (user, input) => adminsTeam(user, input.teamId),
  run: async ({ input }) => {
    const { teamId, stateId, ...values } = input;
    const { before, after } = await saveState(teamId, stateId, values);
    revalidatePath(`/work/teams/${teamId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_state", id: after.id }, summary: `${after.name} (${after.category})`, before, after } };
  },
});
export async function saveStateAction(input: unknown) {
  return statePipeline(input);
}

// A shared label (no team) belongs to the workspace; a team's label to whoever runs the team.
const mayKeepLabel = async (user: Parameters<typeof loadViewer>[0], teamId: string | null) => (teamId ? adminsTeam(user, teamId) : canManageWorkspace(await loadViewer(user), { entityId: null, departmentId: null }));

const labelPipeline = createAction({
  name: "work.label.save",
  input: z.object({ labelId: optional(z.uuid()), teamId: optional(z.uuid()), name: z.string().trim().min(1).max(40), color: z.enum(LABEL_COLORS) }),
  authorize: async (user, input) => {
    const existing = input.labelId ? await findLabel(input.labelId) : null;
    if (input.labelId && !existing) return false;
    return mayKeepLabel(user, existing ? existing.teamId : input.teamId);
  },
  run: async ({ input }) => {
    const { labelId, ...values } = input;
    const { before, after } = await saveLabel(labelId, values);
    if (after.teamId) revalidatePath(`/work/teams/${after.teamId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_label", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveLabelAction(input: unknown) {
  return labelPipeline(input);
}

const deleteLabelPipeline = createAction({
  name: "work.label.delete",
  input: z.object({ labelId: z.uuid() }),
  authorize: async (user, input) => {
    const label = await findLabel(input.labelId);
    return !!label && mayKeepLabel(user, label.teamId);
  },
  run: async ({ input }) => {
    const label = await deleteLabel(input.labelId);
    if (label.teamId) revalidatePath(`/work/teams/${label.teamId}`);
    return { data: { id: label.id }, audit: { resource: { type: "work_label", id: label.id }, summary: label.name, before: label } };
  },
});
export async function deleteLabelAction(input: unknown) {
  return deleteLabelPipeline(input);
}

// ── Clients and brands ──────────────────────────────────────────────────────────────────────

const clientPipeline = createAction({
  name: "work.client.save",
  input: z.object({
    clientId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(CLIENT_KINDS),
    parentId: optional(z.uuid()),
    entityId: optional(z.uuid()),
    note: optional(z.string().trim().max(1000)),
    isActive: checkbox.default(true),
  }),
  // The client list is shared by every team: leaders keep it, whatever their scope.
  authorize: async (user) => canManageWorkspace(await loadViewer(user)),
  run: async ({ input }) => {
    const { clientId, ...values } = input;
    const { before, after } = await saveClient(clientId, values);
    revalidatePath("/work/clients");
    return { data: { id: after.id }, audit: { resource: { type: "work_client", id: after.id, entityId: after.entityId }, summary: `${after.code}: ${after.name}`, before, after } };
  },
});
export async function saveClientAction(input: unknown) {
  return clientPipeline(input);
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

const projectFields = {
  name: z.string().trim().min(1).max(120),
  description: optional(z.string().trim().max(2000)),
  clientId: optional(z.uuid()),
  status: z.enum(PROJECT_STATUSES).default("active"),
  visibility: z.enum(VISIBILITIES),
  leadPersonId: optional(z.uuid()),
  startDate: optional(isoDate),
  dueDate: optional(isoDate),
};

const createProjectPipeline = createAction({
  name: "work.project.create",
  input: z.object({ teamId: z.uuid(), ...projectFields }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canCreateProject(await loadViewer(user), teamFacts(team));
  },
  run: async ({ user, input }) => {
    const project = await createProject(input, user.person.id);
    revalidatePath("/work");
    return { data: { id: project.id }, audit: { resource: { type: "work_project", id: project.id, entityId: project.entityId }, summary: project.name, after: project } };
  },
});
export async function createProjectAction(input: unknown) {
  return createProjectPipeline(input);
}

const managesProject = async (user: Parameters<typeof loadViewer>[0], projectId: string) => {
  const found = await findProject(projectId);
  return !!found && canManageProject(await loadViewer(user), projectFacts(found.project, found.team));
};

const updateProjectPipeline = createAction({
  name: "work.project.update",
  input: z.object({ projectId: z.uuid(), ...projectFields }),
  authorize: (user, input) => managesProject(user, input.projectId),
  run: async ({ input }) => {
    const { projectId, ...values } = input;
    const { before, after } = await updateProject(projectId, values);
    revalidatePath("/work");
    revalidatePath(`/work/projects/${projectId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_project", id: after.id, entityId: after.entityId }, summary: after.name, before, after } };
  },
});
export async function updateProjectAction(input: unknown) {
  return updateProjectPipeline(input);
}

const projectMemberPipeline = createAction({
  name: "work.project.member",
  input: z.object({ projectId: z.uuid(), personId: z.uuid(), role: z.preprocess(blankToNull, z.enum(PROJECT_ROLES).nullable()) }),
  authorize: (user, input) => managesProject(user, input.projectId),
  run: async ({ input }) => {
    const change = await setProjectMember(input.projectId, input.personId, input.role);
    revalidatePath(`/work/projects/${input.projectId}`);
    return { data: change, audit: { resource: { type: "work_project", id: input.projectId }, summary: `member ${input.personId}: ${change.before ?? "—"} → ${change.after ?? "—"}`, before: { personId: input.personId, role: change.before }, after: { personId: input.personId, role: change.after } } };
  },
});
export async function setProjectMemberAction(input: unknown) {
  return projectMemberPipeline(input);
}

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────

const auditTask = (taskId: string, entityId: string | null) => ({ type: "task:work", id: taskId, entityId });
function refreshTask(task: { id: string; parentTaskId?: string | null }, projectId: string | null) {
  revalidatePath(`/work/tasks/${task.id}`);
  if (task.parentTaskId) revalidatePath(`/work/tasks/${task.parentTaskId}`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/tasks");
}

const createTaskPipeline = createAction({
  name: "work.task.create",
  input: z.object({
    teamId: z.uuid(),
    projectId: patchable(z.uuid()),
    title: z.string().trim().min(1).max(200),
    description: optional(z.string().trim().max(10000)),
    stateId: optional(z.uuid()),
    assigneePersonId: optional(z.uuid()),
    priority: optional(z.coerce.number().int().min(1).max(4)),
    startDate: optional(isoDate),
    dueDate: optional(isoDate),
    estimateMinutes: optional(z.coerce.number().int().min(1).max(60000)),
    clientId: patchable(z.uuid()),
    channel: optional(z.enum(CHANNELS)),
    contentFormat: optional(z.enum(CONTENT_FORMATS)),
    parentTaskId: optional(z.uuid()),
    labelIds: z.array(z.uuid()).max(20).default([]),
    collaboratorIds: z.array(z.uuid()).max(20).default([]),
  }),
  authorize: async (user, input) => {
    const viewer = await loadViewer(user);
    // A sub-task goes where its parent is: whoever may work on the parent may add to it.
    if (input.projectId) {
      const found = await findProject(input.projectId);
      if (!found || !canContributeToProject(viewer, projectFacts(found.project, found.team))) return false;
    }
    if (input.parentTaskId) {
      const parent = await loadTask(input.parentTaskId);
      return !!parent && parent.work.teamId === input.teamId && canEditTask(viewer, parent.facts);
    }
    if (input.projectId) return true;
    const team = await findTeam(input.teamId);
    return !!team && canContributeToTeam(viewer, teamFacts(team));
  },
  run: async ({ user, input }) => {
    const { task, work, key } = await createWorkTask(input, user.person.id);
    refreshTask(task, work.projectId);
    return { data: { id: task.id, key }, audit: { resource: auditTask(task.id, task.entityId), summary: `${key} ${task.title}`, after: { title: task.title, projectId: work.projectId, stateId: work.stateId, assigneePersonId: task.assigneePersonId, dueDate: task.dueDate } } };
  },
});
export async function createTaskAction(input: unknown) {
  return createTaskPipeline(input);
}

/** FR-PJM-35: values are checked against the field's type by the service (engine/custom-fields.ts). */
const customValuesInput = z.record(z.uuid(), z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(40)).max(50), z.null()])).refine((values) => Object.keys(values).length <= 30);

const checklistItem = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(200), done: z.boolean() });
const linkItem = z.object({ id: z.string().min(1).max(40), url: z.url({ protocol: /^https$/ }).max(1000), title: optional(z.string().trim().max(120)) });

const updateTaskPipeline = createAction({
  name: "work.task.update",
  input: z.object({
    taskId: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    description: patchable(z.string().trim().max(10000)),
    stateId: z.uuid().optional(),
    assigneePersonId: patchable(z.uuid()),
    requesterPersonId: patchable(z.uuid()),
    reviewerPersonId: patchable(z.uuid()),
    priority: patchable(z.coerce.number().int().min(1).max(4)),
    startDate: patchable(isoDate),
    dueDate: patchable(isoDate),
    estimateMinutes: patchable(z.coerce.number().int().min(1).max(60000)),
    projectId: patchable(z.uuid()),
    clientId: patchable(z.uuid()),
    channel: patchable(z.enum(CHANNELS)),
    contentFormat: patchable(z.enum(CONTENT_FORMATS)),
    parentTaskId: patchable(z.uuid()),
    labelIds: z.array(z.uuid()).max(20).optional(),
    collaboratorIds: z.array(z.uuid()).max(20).optional(),
    checklist: z.array(checklistItem).max(50).optional(),
    links: z.array(linkItem).max(30).optional(),
    position: z.object({ beforeTaskId: optional(z.uuid()), afterTaskId: optional(z.uuid()) }).optional(),
    customValues: customValuesInput.optional(),
    cycleId: patchable(z.uuid()),
  }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    if (!task) return false;
    const viewer = await loadViewer(user);
    if (!canEditTask(viewer, task.facts)) return false;
    // Moving a task into a project takes the right to work there, too.
    if (input.projectId && input.projectId !== task.work.projectId) {
      const target = await findProject(input.projectId);
      if (!target || !canContributeToProject(viewer, projectFacts(target.project, target.team))) return false;
    }
    return true;
  },
  run: async ({ user, input }) => {
    const { taskId, ...patch } = input;
    const { before, changes } = await updateWorkTask(taskId, patch, user.person.id);
    refreshTask(before.task, before.work.projectId);
    if (patch.projectId) revalidatePath(`/work/projects/${patch.projectId}`);
    const fields = changes.map((change) => change.field ?? change.type);
    return { data: { id: taskId, changed: fields }, audit: { resource: auditTask(taskId, before.task.entityId), summary: `${before.task.title}: ${fields.join(", ") || "no change"}`, before: Object.fromEntries(changes.map((change, index) => [`${index}:${change.field ?? change.type}`, change.from ?? null])), after: Object.fromEntries(changes.map((change, index) => [`${index}:${change.field ?? change.type}`, change.to ?? null])) } };
  },
});
export async function updateTaskAction(input: unknown) {
  return updateTaskPipeline(input);
}

const deleteTaskPipeline = createAction({
  name: "work.task.delete",
  input: z.object({ taskId: z.uuid() }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canDeleteTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const found = await loadTask(input.taskId);
    const { task, deleted } = await deleteWorkTask(input.taskId, user.person.id);
    refreshTask(task, found?.work.projectId ?? null);
    return { data: { id: task.id, deleted }, audit: { resource: auditTask(task.id, task.entityId), summary: `${task.title} (+${deleted - 1} sub-tasks)`, before: { title: task.title } } };
  },
});
export async function deleteTaskAction(input: unknown) {
  return deleteTaskPipeline(input);
}

const addDependencyPipeline = createAction({
  name: "work.task.dependency.add",
  input: z.object({ blockerTaskId: z.uuid(), blockedTaskId: z.uuid(), type: z.enum(DEPENDENCY_TYPES).default("blocks") }),
  // Linking says something about both tasks: edit one, and at least see the other.
  authorize: async (user, input) => {
    const [blocker, blocked] = await Promise.all([loadTask(input.blockerTaskId), loadTask(input.blockedTaskId)]);
    if (!blocker || !blocked) return false;
    const viewer = await loadViewer(user);
    return (canEditTask(viewer, blocker.facts) && canViewTask(viewer, blocked.facts)) || (canEditTask(viewer, blocked.facts) && canViewTask(viewer, blocker.facts));
  },
  run: async ({ user, input }) => {
    const { id } = await addDependency(input.blockerTaskId, input.blockedTaskId, input.type, user.person.id);
    revalidatePath(`/work/tasks/${input.blockerTaskId}`);
    revalidatePath(`/work/tasks/${input.blockedTaskId}`);
    return { data: { id }, audit: { resource: { type: "task:work", id: input.blockedTaskId }, summary: `${input.type}: ${input.blockerTaskId} → ${input.blockedTaskId}`, after: input } };
  },
});
export async function addDependencyAction(input: unknown) {
  return addDependencyPipeline(input);
}

const removeDependencyPipeline = createAction({
  name: "work.task.dependency.remove",
  input: z.object({ dependencyId: z.uuid() }),
  authorize: async (user, input) => {
    const dependency = await findDependency(input.dependencyId);
    if (!dependency) return false;
    const [blocker, blocked] = await Promise.all([loadTask(dependency.blockerTaskId), loadTask(dependency.blockedTaskId)]);
    const viewer = await loadViewer(user);
    return [blocker, blocked].some((task) => !!task && canEditTask(viewer, task.facts));
  },
  run: async ({ user, input }) => {
    const row = await removeDependency(input.dependencyId, user.person.id);
    revalidatePath(`/work/tasks/${row.blockerTaskId}`);
    revalidatePath(`/work/tasks/${row.blockedTaskId}`);
    return { data: { id: input.dependencyId }, audit: { resource: { type: "task:work", id: row.blockedTaskId }, summary: `removed: ${row.blockerTaskId} → ${row.blockedTaskId}`, before: row } };
  },
});
export async function removeDependencyAction(input: unknown) {
  return removeDependencyPipeline(input);
}

// ── Saved filters ───────────────────────────────────────────────────────────────────────────

// The list's filters (a custom field's too, `cf.<fieldId>`), its grouping and its order.
const VIEW_PARAMETERS = [...FILTER_KEYS, "group", "sort"] as readonly string[];

const saveViewPipeline = createAction({
  name: "work.view.save",
  input: z.object({ projectId: z.uuid(), name: z.string().trim().min(1).max(60), isShared: checkbox.default(false), filters: z.record(z.string(), z.string().max(200)).refine((filters) => Object.keys(filters).every((key) => VIEW_PARAMETERS.includes(key) || isFilterKey(key))) }),
  // Anyone who can open the project keeps their own filters; a shared one is put in front of the
  // whole project, which is for the people working in it.
  authorize: async (user, input) => {
    const found = await findProject(input.projectId);
    if (!found) return false;
    const viewer = await loadViewer(user);
    const facts = projectFacts(found.project, found.team);
    return input.isShared ? canContributeToProject(viewer, facts) : canViewProject(viewer, facts);
  },
  run: async ({ user, input }) => {
    const view = await createSavedView(input, user.person.id);
    revalidatePath(`/work/projects/${input.projectId}`);
    return { data: { id: view.id }, audit: { resource: { type: "work_saved_view", id: view.id }, summary: `${view.name}${view.isShared ? " (shared)" : ""}`, after: view } };
  },
});
export async function saveViewAction(input: unknown) {
  return saveViewPipeline(input);
}

const deleteViewPipeline = createAction({
  name: "work.view.delete",
  input: z.object({ viewId: z.uuid() }),
  authorize: async (user, input) => {
    const view = await findSavedView(input.viewId);
    if (!view) return false;
    if (view.ownerPersonId === user.person.id) return true;
    const found = view.isShared && view.projectId ? await findProject(view.projectId) : undefined;
    return !!found && canManageProject(await loadViewer(user), projectFacts(found.project, found.team));
  },
  run: async ({ input }) => {
    const view = await deleteSavedView(input.viewId);
    if (view.projectId) revalidatePath(`/work/projects/${view.projectId}`);
    return { data: { id: view.id }, audit: { resource: { type: "work_saved_view", id: view.id }, summary: view.name, before: view } };
  },
});
export async function deleteViewAction(input: unknown) {
  return deleteViewPipeline(input);
}

// ── Conversation: comments, reactions, followers ────────────────────────────────────────────

const commentBody = z.string().trim().min(1).max(5000);
const actorOf = (user: { person: { id: string; fullName: string }; email: string }) => ({ personId: user.person.id, email: user.email, fullName: user.person.fullName });

const addCommentPipeline = createAction({
  name: "work.comment.add",
  input: z.object({ taskId: z.uuid(), body: commentBody, parentId: optional(z.uuid()) }),
  // Whoever may see the task may join the conversation — the requester too, who cannot edit it.
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canViewTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { comment, mentioned, told } = await addComment(input.taskId, input, user.person);
    revalidatePath(`/work/tasks/${input.taskId}`);
    // The audit log says that someone commented and who was called in — the words stay in the task.
    return { data: { id: comment.id, mentioned: mentioned.length }, audit: { resource: { type: "task:work", id: input.taskId }, summary: `comment ${comment.id}`, after: { commentId: comment.id, parentId: comment.parentId, mentioned, notified: told.length } } };
  },
});
export async function addCommentAction(input: unknown) {
  return addCommentPipeline(input);
}

const editCommentPipeline = createAction({
  name: "work.comment.edit",
  input: z.object({ commentId: z.uuid(), body: commentBody }),
  // Your own words only, and only while you may still see the task.
  authorize: async (user, input) => {
    const comment = await findComment(input.commentId);
    const task = comment && comment.authorPersonId === user.person.id ? await loadTask(comment.taskId) : undefined;
    return !!task && canViewTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { after, mentioned } = await editComment(input.commentId, input.body, user.person);
    revalidatePath(`/work/tasks/${after.taskId}`);
    return { data: { id: after.id }, audit: { resource: { type: "task:work", id: after.taskId }, summary: `comment ${after.id} edited`, after: { commentId: after.id, mentioned } } };
  },
});
export async function editCommentAction(input: unknown) {
  return editCommentPipeline(input);
}

const deleteCommentPipeline = createAction({
  name: "work.comment.delete",
  input: z.object({ commentId: z.uuid() }),
  authorize: async (user, input) => {
    const comment = await findComment(input.commentId);
    const task = comment ? await loadTask(comment.taskId) : undefined;
    if (!comment || !task) return false;
    const viewer = await loadViewer(user);
    return (comment.authorPersonId === user.person.id && canViewTask(viewer, task.facts)) || canModerateTask(viewer, task.facts);
  },
  run: async ({ user, input }) => {
    const comment = await deleteComment(input.commentId, user.person.id);
    revalidatePath(`/work/tasks/${comment.taskId}`);
    return { data: { id: comment.id }, audit: { resource: { type: "task:work", id: comment.taskId }, summary: `comment ${comment.id} deleted`, before: { commentId: comment.id, authorPersonId: comment.authorPersonId } } };
  },
});
export async function deleteCommentAction(input: unknown) {
  return deleteCommentPipeline(input);
}

const reactPipeline = createAction({
  name: "work.comment.react",
  input: z.object({ commentId: z.uuid(), emoji: z.enum(REACTIONS) }),
  authorize: async (user, input) => {
    const comment = await findComment(input.commentId);
    const task = comment ? await loadTask(comment.taskId) : undefined;
    return !!task && canViewTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { comment, added } = await toggleReaction(input.commentId, input.emoji, user.person.id);
    revalidatePath(`/work/tasks/${comment.taskId}`);
    return { data: { id: comment.id, added }, audit: { resource: { type: "task:work", id: comment.taskId }, summary: `${added ? "+" : "−"}${input.emoji} on comment ${comment.id}` } };
  },
});
export async function reactToCommentAction(input: unknown) {
  return reactPipeline(input);
}

const followPipeline = createAction({
  name: "work.task.follow",
  input: z.object({ taskId: z.uuid(), follow: z.boolean() }),
  // For yourself only; stopping is always allowed, starting takes the right to see the task.
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && (!input.follow || canViewTask(await loadViewer(user), task.facts));
  },
  run: async ({ user, input }) => {
    const { before, after } = await setFollowing(input.taskId, user.person.id, input.follow);
    revalidatePath(`/work/tasks/${input.taskId}`);
    return { data: { state: after }, audit: { resource: { type: "task:work", id: input.taskId }, summary: `follow: ${before} → ${after}`, before: { state: before }, after: { state: after } } };
  },
});
export async function followTaskAction(input: unknown) {
  return followPipeline(input);
}

// ── Attachments (platform files module; signed-URL upload) ──────────────────────────────────

const beginUploadPipeline = createAction({
  name: "work.task.file.begin",
  input: z.object({ taskId: z.uuid(), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canEditTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const task = (await loadTask(input.taskId))!;
    const upload = await beginTaskUpload(task, input, actorOf(user));
    return { data: upload, audit: { resource: auditTask(input.taskId, task.task.entityId), summary: input.fileName, after: { fileId: upload.fileId, fileName: input.fileName, sizeBytes: input.sizeBytes } } };
  },
});
export async function beginTaskUploadAction(input: unknown) {
  return beginUploadPipeline(input);
}

const completeUploadPipeline = createAction({
  name: "work.task.file.add",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findTaskFile(input.fileId, { pending: true });
    return !!found && found.file.uploadedByPersonId === user.person.id && canEditTask(await loadViewer(user), found.loaded.facts);
  },
  run: async ({ user, input }) => {
    const file = await completeTaskUpload(input.fileId, actorOf(user));
    revalidatePath(`/work/tasks/${file.ownerId}`);
    return { data: { id: file.id }, audit: { resource: auditTask(file.ownerId, file.entityId), summary: file.fileName, after: { fileId: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes } } };
  },
});
export async function completeTaskUploadAction(input: unknown) {
  return completeUploadPipeline(input);
}

const downloadPipeline = createAction({
  name: "work.task.file.open",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findTaskFile(input.fileId);
    return !!found && canViewTask(await loadViewer(user), found.loaded.facts);
  },
  run: async ({ user, input }) => {
    const { file } = (await findTaskFile(input.fileId))!;
    const url = await taskFileLink(file, actorOf(user), user.request);
    return { data: { url }, audit: { resource: auditTask(file.ownerId, file.entityId), summary: file.fileName } };
  },
});
export async function openTaskFileAction(input: unknown) {
  return downloadPipeline(input);
}

const removeFilePipeline = createAction({
  name: "work.task.file.remove",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findTaskFile(input.fileId);
    if (!found) return false;
    const viewer = await loadViewer(user);
    return (found.file.uploadedByPersonId === user.person.id && canEditTask(viewer, found.loaded.facts)) || canModerateTask(viewer, found.loaded.facts);
  },
  run: async ({ user, input }) => {
    const file = await removeTaskFile(input.fileId, user.person.id);
    revalidatePath(`/work/tasks/${file.ownerId}`);
    return { data: { id: file.id }, audit: { resource: auditTask(file.ownerId, file.entityId), summary: file.fileName, before: { fileId: file.id, fileName: file.fileName } } };
  },
});
export async function removeTaskFileAction(input: unknown) {
  return removeFilePipeline(input);
}
