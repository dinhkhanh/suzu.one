// Work tasks: a row of the engine's `task` table (kind "work") plus its `work_task` half. Every
// change is written to `work_activity`, field by field (FR-WRK-09).
import "server-only";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { createTask, type TaskRow } from "../platform/tasks-engine/service";
import { runTaskAutomations } from "./automations";
import { customValueChanges } from "./custom-fields";
import { changedFields } from "./engine/automation";
import { requirementFor } from "./handoff-gate";
import { assertPublishable } from "./publish-gate";
import { rankBetween, wouldCreateDependencyCycle, wouldCreateParentCycle } from "./engine/graph";
import { CATEGORY_STATUS, type DependencyType, type StateCategory } from "./enums";
import { notifyFollowers } from "./followers";
import { projectsWithTeams, workDirectory } from "./directory";
import { canViewProject, canViewTask, canViewTeamBacklog, type TaskFacts, type WorkViewer } from "./policy";
import { projectFacts, type ProjectRow } from "./projects";
import type { CustomFieldValue, TaskChecklistItem, TaskLink } from "./schema";
import { entryState, listStates, teamFacts, type StateRow, type TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type WorkTaskRow = typeof schema.workTask.$inferSelect;
export const WORK_KIND = "work";
export const PROJECT_CONTEXT = "work_project";

const live = isNull(schema.task.deletedAt);
const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
export const taskKey = (teamKey: string, number: number) => `${teamKey}-${number}`;

// ── Loading one task with what the policy needs ─────────────────────────────────────────────

export type LoadedTask = { task: TaskRow; work: WorkTaskRow; team: TeamRow; project: ProjectRow | null; /** Collaborators. */ peopleIds: string[]; followerIds: string[]; mutedIds: string[]; facts: TaskFacts };

export async function loadTask(taskId: string, executor: Executor = db()): Promise<LoadedTask | undefined> {
  return (await loadTasks([taskId], executor)).get(taskId);
}

/** `loadTask` for many tasks in two queries. Deleted and unknown tasks are left out of the map. */
export async function loadTasks(taskIds: readonly string[], executor: Executor = db()): Promise<Map<string, LoadedTask>> {
  const ids = [...new Set(taskIds)];
  const result = new Map<string, LoadedTask>();
  if (ids.length === 0) return result;
  const [rows, people] = await Promise.all([
    executor
      .select({ task: schema.task, work: schema.workTask, team: schema.workTeam, project: schema.workProject })
      .from(schema.task)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
      .where(and(ids.length === 1 ? eq(schema.task.id, ids[0]) : inArray(schema.task.id, ids), live)),
    executor.select({ taskId: schema.workTaskPerson.taskId, personId: schema.workTaskPerson.personId, role: schema.workTaskPerson.role }).from(schema.workTaskPerson).where(ids.length === 1 ? eq(schema.workTaskPerson.taskId, ids[0]) : inArray(schema.workTaskPerson.taskId, ids)),
  ]);
  const peopleOf = Map.groupBy(people, (person) => person.taskId);
  for (const row of rows) {
    const own = peopleOf.get(row.task.id) ?? [];
    // Following gives notifications, not rights: only collaborators count as people on the task.
    const peopleIds = own.filter((person) => person.role === "collaborator").map((person) => person.personId);
    const followerIds = own.filter((person) => person.role === "follower").map((person) => person.personId);
    const mutedIds = own.filter((person) => person.role === "muted").map((person) => person.personId);
    const facts: TaskFacts = {
      team: teamFacts(row.team),
      project: row.project ? projectFacts(row.project, row.team) : null,
      assigneePersonId: row.task.assigneePersonId,
      requesterPersonId: row.task.requesterPersonId,
      createdByPersonId: row.task.createdByPersonId,
      peopleIds,
    };
    result.set(row.task.id, { ...row, peopleIds, followerIds, mutedIds, facts });
  }
  return result;
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────

type ActivityEntry = { type: string; field?: string | null; from?: unknown; to?: unknown };

export type { ActivityEntry };
export async function logActivity(tx: Executor, taskId: string, actorPersonId: string | null, entries: ActivityEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(schema.workActivity).values(entries.map((entry) => ({ taskId, actorPersonId, type: entry.type, field: entry.field ?? null, fromValue: entry.from ?? null, toValue: entry.to ?? null })));
}

export type ActivityView = { id: string; type: string; field: string | null; fromValue: unknown; toValue: unknown; createdAt: Date; actorName: string | null };

export async function listActivity(taskId: string, limit = 200): Promise<ActivityView[]> {
  return db()
    .select({ id: schema.workActivity.id, type: schema.workActivity.type, field: schema.workActivity.field, fromValue: schema.workActivity.fromValue, toValue: schema.workActivity.toValue, createdAt: schema.workActivity.createdAt, actorName: schema.person.fullName })
    .from(schema.workActivity)
    .leftJoin(schema.person, eq(schema.person.id, schema.workActivity.actorPersonId))
    .where(eq(schema.workActivity.taskId, taskId))
    .orderBy(desc(schema.workActivity.createdAt), desc(schema.workActivity.id))
    .limit(limit);
}

// ── Checks shared by create and update ──────────────────────────────────────────────────────

type Named = { id: string; name: string } | null;

async function personNamed(tx: Executor, personId: string | null, options: { mustBeActive?: boolean } = {}): Promise<Named> {
  if (!personId) return null;
  const [row] = await tx.select({ id: schema.person.id, name: schema.person.fullName, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || (options.mustBeActive && row.status === "offboarded")) throw new ActionError("person_not_found");
  return { id: row.id, name: row.name };
}

async function clientNamed(tx: Executor, clientId: string | null): Promise<Named> {
  if (!clientId) return null;
  const [row] = await tx.select({ id: schema.workClient.id, name: schema.workClient.name }).from(schema.workClient).where(eq(schema.workClient.id, clientId)).limit(1);
  if (!row) throw new ActionError("client_not_found");
  return row;
}

async function projectOfTeam(tx: Executor, projectId: string | null, teamId: string): Promise<ProjectRow | null> {
  if (!projectId) return null;
  const [row] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!row) throw new ActionError("project_not_found");
  // A task uses its team's workflow; moving it to another team's project would strand its state.
  if (row.teamId !== teamId) throw new ActionError("project_other_team");
  if (row.status === "archived") throw new ActionError("project_archived");
  return row;
}

async function stateOfTeam(tx: Executor, stateId: string, teamId: string): Promise<StateRow> {
  const [row] = await tx.select().from(schema.workState).where(eq(schema.workState.id, stateId)).limit(1);
  if (!row || row.teamId !== teamId || !row.isActive) throw new ActionError("state_not_found");
  return row;
}

async function labelsOfTeam(tx: Executor, labelIds: readonly string[], teamId: string): Promise<{ id: string; name: string }[]> {
  if (labelIds.length === 0) return [];
  const rows = await tx.select().from(schema.workLabel).where(inArray(schema.workLabel.id, [...labelIds]));
  if (rows.length !== new Set(labelIds).size || rows.some((row) => row.teamId !== null && row.teamId !== teamId)) throw new ActionError("label_not_found");
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function parentOfTeam(tx: Executor, parentTaskId: string, teamId: string): Promise<{ task: TaskRow; work: WorkTaskRow }> {
  const [row] = await tx.select({ task: schema.task, work: schema.workTask }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(and(eq(schema.task.id, parentTaskId), live)).limit(1);
  if (!row || row.work.teamId !== teamId) throw new ActionError("parent_not_found");
  return row;
}

/** A cycle of the task's own team; planning into a closed cycle is refused (FR-PJM-10). */
async function cycleNamed(tx: Executor, cycleId: string | null, teamId: string, options: { mustBeOpen?: boolean } = {}): Promise<Named> {
  if (!cycleId) return null;
  const [row] = await tx.select().from(schema.workCycle).where(eq(schema.workCycle.id, cycleId)).limit(1);
  if (!row || row.teamId !== teamId) throw new ActionError("cycle_not_found");
  if (options.mustBeOpen && row.closedAt) throw new ActionError("cycle_closed");
  return { id: row.id, name: `#${row.number}` };
}

async function nextRank(tx: Executor, stateId: string): Promise<number> {
  const [row] = await tx.select({ value: sql<number | null>`max(${schema.workTask.boardRank})` }).from(schema.workTask).where(eq(schema.workTask.stateId, stateId));
  return rankBetween(row?.value ?? null, null);
}

const statusFields = (category: StateCategory, actorPersonId: string | null) => {
  const status = CATEGORY_STATUS[category];
  return { status, completedAt: status === "done" ? new Date() : null, completedByPersonId: status === "done" ? actorPersonId : null };
};

// ── Creating ────────────────────────────────────────────────────────────────────────────────

export type NewWorkTask = {
  teamId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  stateId?: string | null;
  assigneePersonId?: string | null;
  requesterPersonId?: string | null;
  priority?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  clientId?: string | null;
  channel?: string | null;
  contentFormat?: string | null;
  parentTaskId?: string | null;
  labelIds?: string[];
  collaboratorIds?: string[];
  /** Made from a template item or by a recurrence. */
  templateItemId?: string | null;
  recurrence?: { id: string; occurrenceDate: string } | null;
};

export async function createWorkTaskIn(tx: Executor, input: NewWorkTask, actorPersonId: string | null, options: { notify?: boolean } = {}): Promise<{ task: TaskRow; work: WorkTaskRow; key: string }> {
  const parent = input.parentTaskId ? await parentOfTeam(tx, input.parentTaskId, input.teamId) : null;
  // A sub-task lives where its parent lives unless told otherwise.
  const projectId = input.projectId === undefined ? (parent?.work.projectId ?? null) : input.projectId;
  const clientId = input.clientId === undefined ? (parent?.work.clientId ?? null) : input.clientId;

  const project = await projectOfTeam(tx, projectId, input.teamId);
  const state = input.stateId ? await stateOfTeam(tx, input.stateId, input.teamId) : entryState(await listStates([input.teamId], tx));
  if (!state) throw new ActionError("state_not_found");
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ActionError("task_dates_invalid");
  await personNamed(tx, input.assigneePersonId ?? null, { mustBeActive: true });
  await personNamed(tx, input.requesterPersonId ?? null);
  await clientNamed(tx, clientId ?? project?.clientId ?? null);
  const labels = await labelsOfTeam(tx, input.labelIds ?? [], input.teamId);

  const [team] = await tx.update(schema.workTeam).set({ taskSeq: sql`${schema.workTeam.taskSeq} + 1` }).where(and(eq(schema.workTeam.id, input.teamId), eq(schema.workTeam.isActive, true))).returning();
  if (!team) throw new ActionError("team_not_found");

  const task = await createTask(
    tx,
    {
      kind: WORK_KIND,
      title: input.title,
      description: input.description ?? null,
      assigneePersonId: input.assigneePersonId ?? null,
      requesterPersonId: input.requesterPersonId ?? actorPersonId,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      priority: input.priority ?? null,
      entityId: project?.entityId ?? team.entityId,
      parentTaskId: parent?.task.id ?? null,
      context: project ? { type: PROJECT_CONTEXT, id: project.id } : null,
      templateItemId: input.templateItemId ?? null,
    },
    actorPersonId,
    { notify: false },
  );
  const fields = statusFields(state.category as StateCategory, actorPersonId);
  if (fields.status !== "todo") await tx.update(schema.task).set(fields).where(eq(schema.task.id, task.id));

  const [work] = await tx
    .insert(schema.workTask)
    .values({ taskId: task.id, teamId: team.id, projectId: project?.id ?? null, number: team.taskSeq, stateId: state.id, clientId: clientId ?? project?.clientId ?? null, channel: input.channel ?? null, contentFormat: input.contentFormat ?? null, boardRank: await nextRank(tx, state.id), recurrenceId: input.recurrence?.id ?? null, occurrenceDate: input.recurrence?.occurrenceDate ?? null })
    .returning();
  if (labels.length) await tx.insert(schema.workTaskLabel).values(labels.map((label) => ({ taskId: task.id, labelId: label.id })));
  const collaborators = [...new Set(input.collaboratorIds ?? [])].filter((id) => id !== input.assigneePersonId);
  for (const personId of collaborators) await personNamed(tx, personId, { mustBeActive: true });
  if (collaborators.length) await tx.insert(schema.workTaskPerson).values(collaborators.map((personId) => ({ taskId: task.id, personId, role: "collaborator" })));

  await logActivity(tx, task.id, actorPersonId, [{ type: "created", to: { title: task.title, state: state.name } }]);
  const key = taskKey(team.key, work.number);
  if (options.notify !== false) {
    const recipients = [input.assigneePersonId, ...collaborators].filter((id): id is string => !!id && id !== actorPersonId);
    await notify({ recipients, kind: "tasks.work_assigned", params: { key, title: task.title }, link: taskLink(task.id) }, tx);
  }
  return { task: { ...task, ...fields }, work, key };
}

export const createWorkTask = (input: NewWorkTask, actorPersonId: string) => db().transaction((tx) => createWorkTaskIn(tx, input, actorPersonId));

// ── Updating ────────────────────────────────────────────────────────────────────────────────

export type WorkTaskPatch = Partial<{
  title: string;
  description: string | null;
  stateId: string;
  assigneePersonId: string | null;
  requesterPersonId: string | null;
  reviewerPersonId: string | null;
  priority: number | null;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  projectId: string | null;
  clientId: string | null;
  channel: string | null;
  contentFormat: string | null;
  parentTaskId: string | null;
  labelIds: string[];
  collaboratorIds: string[];
  checklist: TaskChecklistItem[];
  links: TaskLink[];
  /** Board drop: the neighbours the card landed between, in the target state. */
  position: { beforeTaskId: string | null; afterTaskId: string | null };
  /** FR-PJM-35: { [fieldId]: value }; only the fields named change, blank clears one. */
  customValues: Record<string, unknown>;
  /** FR-PJM-10: the team's cycle the task is planned in; null takes it out. */
  cycleId: string | null;
}>;

const changed = <T>(next: T | undefined, current: T): next is T => next !== undefined && next !== current;

export const updateWorkTask = (taskId: string, patch: WorkTaskPatch, actorPersonId: string) => db().transaction((tx) => updateWorkTaskIn(tx, taskId, patch, actorPersonId));

/** Inside someone else's transaction: the review step moves a task as part of handing in a deliverable. */
export async function updateWorkTaskIn(
  tx: Executor,
  taskId: string,
  patch: WorkTaskPatch,
  /** null = the system (a triage rule), not a person. */
  actorPersonId: string | null,
  options: {
    /** The caller sends its own, more specific notice about the move. */ quiet?: boolean;
    /** Nobody is told anything (work still waiting in triage). */ silent?: boolean;
    /**
     * The hand-off gate (FR-PJM-40). Absent: a move into a state that requires a package is refused
     * with what the sheet needs. "filled" = the caller is the hand-off itself, package checked;
     * "system" = a move nobody chose as a stage transition (triage cancelling a declined request,
     * a returned hand-off going back, a review decision); "automation" = a rule's move (FR-PJM-33):
     * no sheet to fill, but the publish gate still holds.
     */
    handoff?: "filled" | "system" | "automation";
    /**
     * How many automation rules deep this change is (FR-PJM-33): 0 = a person's change, 1 = a
     * rule's. The rules it sets off run at this depth, and only one level deep.
     */
    automationDepth?: number;
  } = {},
): Promise<{ before: LoadedTask; changes: ActivityEntry[] }> {
  {
    const before = await loadTask(taskId, tx);
    if (!before) throw new ActionError("task_not_found");
    const { task, work, team } = before;
    const taskSet: Partial<typeof schema.task.$inferInsert> = {};
    const workSet: Partial<typeof schema.workTask.$inferInsert> = {};
    const changes: ActivityEntry[] = [];
    const plain = (field: string, from: unknown, to: unknown) => changes.push({ type: "field_changed", field, from, to });

    const setOnTask = <Key extends keyof typeof taskSet>(key: Key, value: (typeof taskSet)[Key], from: unknown, logged = true) => {
      taskSet[key] = value;
      plain(key, logged ? from : null, logged ? value : null);
    };
    const setOnWork = <Key extends keyof typeof workSet>(key: Key, value: (typeof workSet)[Key], from: unknown) => {
      workSet[key] = value;
      plain(key, from, value);
    };
    if (changed(patch.title, task.title)) setOnTask("title", patch.title, task.title);
    // The brief can be long: the log says that it changed, not what it said.
    if (changed(patch.description, task.description)) setOnTask("description", patch.description, null, false);
    if (changed(patch.priority, task.priority)) setOnTask("priority", patch.priority, task.priority);
    if (changed(patch.estimateMinutes, task.estimateMinutes)) setOnTask("estimateMinutes", patch.estimateMinutes, task.estimateMinutes);
    if (changed(patch.startDate, task.startDate)) setOnTask("startDate", patch.startDate, task.startDate);
    if (changed(patch.dueDate, task.dueDate)) setOnTask("dueDate", patch.dueDate, task.dueDate);
    const startDate = patch.startDate === undefined ? task.startDate : patch.startDate;
    const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate;
    if (startDate && dueDate && dueDate < startDate) throw new ActionError("task_dates_invalid");
    if (changed(patch.channel, work.channel)) setOnWork("channel", patch.channel, work.channel);
    if (changed(patch.contentFormat, work.contentFormat)) setOnWork("contentFormat", patch.contentFormat, work.contentFormat);

    let newAssignee: string | null = null;
    if (changed(patch.assigneePersonId, task.assigneePersonId)) {
      const [from, to] = [await personNamed(tx, task.assigneePersonId), await personNamed(tx, patch.assigneePersonId, { mustBeActive: true })];
      taskSet.assigneePersonId = patch.assigneePersonId;
      newAssignee = patch.assigneePersonId;
      plain("assignee", from, to);
    }
    if (changed(patch.requesterPersonId, task.requesterPersonId)) {
      const [from, to] = [await personNamed(tx, task.requesterPersonId), await personNamed(tx, patch.requesterPersonId)];
      taskSet.requesterPersonId = patch.requesterPersonId;
      plain("requester", from, to);
    }
    if (changed(patch.reviewerPersonId, work.reviewerPersonId)) {
      const [from, to] = [await personNamed(tx, work.reviewerPersonId), await personNamed(tx, patch.reviewerPersonId, { mustBeActive: true })];
      workSet.reviewerPersonId = patch.reviewerPersonId;
      plain("reviewer", from, to);
    }
    if (changed(patch.clientId, work.clientId)) {
      const [from, to] = [await clientNamed(tx, work.clientId), await clientNamed(tx, patch.clientId)];
      workSet.clientId = patch.clientId;
      plain("client", from, to);
    }
    if (changed(patch.projectId, work.projectId)) {
      const project = await projectOfTeam(tx, patch.projectId, team.id);
      workSet.projectId = project?.id ?? null;
      taskSet.contextType = project ? PROJECT_CONTEXT : null;
      taskSet.contextId = project?.id ?? null;
      taskSet.entityId = project?.entityId ?? team.entityId;
      plain("project", before.project ? { id: before.project.id, name: before.project.name } : null, project ? { id: project.id, name: project.name } : null);
    }
    if (changed(patch.parentTaskId, task.parentTaskId)) {
      let parentTitle: Named = null;
      if (patch.parentTaskId) {
        const parent = await parentOfTeam(tx, patch.parentTaskId, team.id);
        const links = await tx.select({ id: schema.task.id, parentId: schema.task.parentTaskId }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(eq(schema.workTask.teamId, team.id));
        if (wouldCreateParentCycle(new Map(links.map((link) => [link.id, link.parentId])), taskId, parent.task.id)) throw new ActionError("parent_cycle");
        parentTitle = { id: parent.task.id, name: parent.task.title };
      }
      taskSet.parentTaskId = patch.parentTaskId;
      plain("parent", task.parentTaskId ? { id: task.parentTaskId } : null, parentTitle);
    }

    const targetStateId = patch.stateId ?? work.stateId;
    if (changed(patch.stateId, work.stateId)) {
      const [from] = await tx.select().from(schema.workState).where(eq(schema.workState.id, work.stateId)).limit(1);
      const to = await stateOfTeam(tx, patch.stateId, team.id);
      // The publish gate first (FR-PJM-54): a hand-off sheet filled for a post that is not out yet would be lost.
      if (options.handoff !== "system") await assertPublishable(tx, { id: taskId, channel: workSet.channel === undefined ? work.channel : (workSet.channel ?? null) }, to);
      if (!options.handoff) {
        const handoff = await requirementFor(tx, before, to.id, actorPersonId);
        if (handoff) throw new ActionError("handoff_required", { handoff });
      }
      workSet.stateId = to.id;
      const fields = statusFields(to.category as StateCategory, actorPersonId);
      // Moving between two "done" states (Published → Reported) keeps the first completion time.
      if (fields.status !== task.status) Object.assign(taskSet, fields);
      if (!patch.position) workSet.boardRank = await nextRank(tx, to.id);
      plain("state", from ? { id: from.id, name: from.name, category: from.category } : null, { id: to.id, name: to.name, category: to.category });
    }
    if (patch.position) {
      const neighbourIds = [patch.position.beforeTaskId, patch.position.afterTaskId].filter((id): id is string => !!id);
      const neighbours = neighbourIds.length ? await tx.select({ taskId: schema.workTask.taskId, rank: schema.workTask.boardRank }).from(schema.workTask).where(and(inArray(schema.workTask.taskId, neighbourIds), eq(schema.workTask.stateId, targetStateId))) : [];
      const rankOf = (id: string | null) => neighbours.find((row) => row.taskId === id)?.rank ?? null;
      workSet.boardRank = rankBetween(rankOf(patch.position.beforeTaskId), rankOf(patch.position.afterTaskId));
    }

    if (patch.labelIds) {
      const current = await tx.select({ id: schema.workLabel.id, name: schema.workLabel.name }).from(schema.workTaskLabel).innerJoin(schema.workLabel, eq(schema.workLabel.id, schema.workTaskLabel.labelId)).where(eq(schema.workTaskLabel.taskId, taskId));
      const wanted = await labelsOfTeam(tx, patch.labelIds, team.id);
      const added = wanted.filter((label) => !current.some((row) => row.id === label.id));
      const removed = current.filter((row) => !wanted.some((label) => label.id === row.id));
      if (added.length) await tx.insert(schema.workTaskLabel).values(added.map((label) => ({ taskId, labelId: label.id })));
      if (removed.length) await tx.delete(schema.workTaskLabel).where(and(eq(schema.workTaskLabel.taskId, taskId), inArray(schema.workTaskLabel.labelId, removed.map((row) => row.id))));
      changes.push(...added.map((label) => ({ type: "label_added", to: label })), ...removed.map((label) => ({ type: "label_removed", from: label })));
    }

    const newCollaborators: string[] = [];
    if (patch.collaboratorIds) {
      const current = await tx.select({ id: schema.person.id, name: schema.person.fullName, role: schema.workTaskPerson.role }).from(schema.workTaskPerson).innerJoin(schema.person, eq(schema.person.id, schema.workTaskPerson.personId)).where(eq(schema.workTaskPerson.taskId, taskId));
      const wantedIds = [...new Set(patch.collaboratorIds)];
      for (const personId of wantedIds.filter((id) => !current.some((row) => row.id === id && row.role === "collaborator"))) {
        const person = (await personNamed(tx, personId, { mustBeActive: true }))!;
        await tx.insert(schema.workTaskPerson).values({ taskId, personId, role: "collaborator" }).onConflictDoUpdate({ target: [schema.workTaskPerson.taskId, schema.workTaskPerson.personId], set: { role: "collaborator" } });
        changes.push({ type: "person_added", to: person });
        newCollaborators.push(personId);
      }
      const removed = current.filter((row) => row.role === "collaborator" && !wantedIds.includes(row.id));
      if (removed.length) await tx.delete(schema.workTaskPerson).where(and(eq(schema.workTaskPerson.taskId, taskId), inArray(schema.workTaskPerson.personId, removed.map((row) => row.id))));
      changes.push(...removed.map((row) => ({ type: "person_removed", from: { id: row.id, name: row.name } })));
    }

    if (patch.customValues && Object.keys(patch.customValues).length > 0) {
      // Checked against the fields of the project the task ends up in.
      const custom = await customValueChanges(tx, { teamId: team.id, projectId: workSet.projectId === undefined ? work.projectId : workSet.projectId, customValues: work.customValues }, patch.customValues);
      if (custom.changes.length) {
        workSet.customValues = custom.values;
        changes.push(...custom.changes);
      }
    }

    if (changed(patch.cycleId, work.cycleId)) {
      const [from, to] = [await cycleNamed(tx, work.cycleId, team.id), await cycleNamed(tx, patch.cycleId, team.id, { mustBeOpen: true })];
      workSet.cycleId = patch.cycleId;
      plain("cycle", from, to);
    }

    if (patch.checklist && JSON.stringify(patch.checklist) !== JSON.stringify(work.checklist)) {
      workSet.checklist = patch.checklist;
      const tally = (items: TaskChecklistItem[]) => ({ done: items.filter((item) => item.done).length, total: items.length });
      plain("checklist", tally(work.checklist), tally(patch.checklist));
    }
    if (patch.links && JSON.stringify(patch.links) !== JSON.stringify(work.links)) {
      workSet.links = patch.links;
      plain("links", work.links.length, patch.links.length);
    }

    if (Object.keys(taskSet).length || changes.length || Object.keys(workSet).length) await tx.update(schema.task).set({ ...taskSet, updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    if (Object.keys(workSet).length) await tx.update(schema.workTask).set(workSet).where(eq(schema.workTask.taskId, taskId));
    await logActivity(tx, taskId, actorPersonId, changes);

    const recipients = [newAssignee, ...newCollaborators].filter((id): id is string => !!id && id !== actorPersonId);
    if (options.silent) return { before, changes };
    await notify({ recipients, kind: "tasks.work_assigned", params: { key: taskKey(team.key, work.number), title: patch.title ?? task.title }, link: taskLink(taskId) }, tx);
    // A move to another state reaches everyone following the task (FR-WRK-17) — except whoever was
    // just handed it: one notice per event per person.
    const stateChange = changes.find((change) => change.field === "state");
    if (stateChange && !options.quiet) {
      const after = await loadTask(taskId, tx);
      const [actor] = actorPersonId ? await tx.select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, actorPersonId)).limit(1) : [];
      if (after) await notifyFollowers(tx, after, actorPersonId, "tasks.status_changed", { name: actor?.name ?? "", state: (stateChange.to as { name: string }).name }, recipients);
    }
    await automateChange(tx, before, changes, taskSet.status, options.automationDepth ?? 0, options.handoff === "filled");
    return { before, changes };
  }
}

/**
 * The rules a change sets off (FR-PJM-33), in the same transaction: the state it entered, the
 * fields it changed, and — when it closed the last open sub-task — "all sub-tasks done" on the parent.
 */
async function automateChange(tx: Executor, before: LoadedTask, changes: readonly ActivityEntry[], status: string | undefined, depth: number, handedOff: boolean): Promise<void> {
  if (changes.length === 0) return;
  // Most teams have no rules: one indexed look, and nothing more. (A parent is always of the same team.)
  const [any] = await tx.select({ id: schema.workAutomation.id }).from(schema.workAutomation).where(and(eq(schema.workAutomation.teamId, before.team.id), eq(schema.workAutomation.isActive, true))).limit(1);
  if (!any) return;
  const taskId = before.task.id;
  const state = changes.find((change) => change.field === "state")?.to as { id: string } | undefined;
  if (state) await runTaskAutomations(tx, taskId, { type: "state_entered", stateId: state.id, handedOff }, depth);
  const fields = changedFields(changes).filter((field) => field !== "state");
  if (fields.length) await runTaskAutomations(tx, taskId, { type: "field_changed", fields }, depth);
  const parentId = before.task.parentTaskId;
  if (parentId && (status === "done" || status === "cancelled")) {
    const [open] = await tx.select({ id: schema.task.id }).from(schema.task).where(and(eq(schema.task.parentTaskId, parentId), live, inArray(schema.task.status, ["todo", "in_progress"]))).limit(1);
    const [done] = open ? [] : await tx.select({ id: schema.task.id }).from(schema.task).where(and(eq(schema.task.parentTaskId, parentId), live, eq(schema.task.status, "done"))).limit(1);
    if (!open && done) await runTaskAutomations(tx, parentId, { type: "all_subtasks_done" }, depth);
  }
}

/** Soft delete, sub-tasks included. */
export async function deleteWorkTask(taskId: string, actorPersonId: string): Promise<{ task: TaskRow; deleted: number }> {
  return db().transaction(async (tx) => {
    const found = await loadTask(taskId, tx);
    if (!found) throw new ActionError("task_not_found");
    const ids = [taskId];
    for (let frontier = [taskId]; frontier.length > 0; ) {
      const children = await tx.select({ id: schema.task.id }).from(schema.task).where(and(inArray(schema.task.parentTaskId, frontier), live));
      frontier = children.map((child) => child.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    await tx.update(schema.task).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(schema.task.id, ids));
    await logActivity(tx, taskId, actorPersonId, [{ type: "deleted", from: { title: found.task.title, withSubtasks: ids.length - 1 } }]);
    return { task: found.task, deleted: ids.length };
  });
}

// ── Dependencies ────────────────────────────────────────────────────────────────────────────

export async function addDependency(blockerTaskId: string, blockedTaskId: string, type: DependencyType, actorPersonId: string): Promise<{ id: string }> {
  return db().transaction(async (tx) => {
    if (blockerTaskId === blockedTaskId) throw new ActionError("dependency_self");
    const both = await loadTasks([blockerTaskId, blockedTaskId], tx);
    const [blocker, blocked] = [both.get(blockerTaskId), both.get(blockedTaskId)];
    if (!blocker || !blocked) throw new ActionError("task_not_found");
    const existing = await tx.select().from(schema.workTaskDependency).where(or(and(eq(schema.workTaskDependency.blockerTaskId, blockerTaskId), eq(schema.workTaskDependency.blockedTaskId, blockedTaskId)), and(eq(schema.workTaskDependency.blockerTaskId, blockedTaskId), eq(schema.workTaskDependency.blockedTaskId, blockerTaskId), eq(schema.workTaskDependency.type, "relates"))));
    if (existing.length) throw new ActionError("dependency_exists");
    if (type === "blocks") {
      // Dependencies may cross teams and projects, so the whole "blocks" graph is the input.
      const edges = await tx.select({ blockerTaskId: schema.workTaskDependency.blockerTaskId, blockedTaskId: schema.workTaskDependency.blockedTaskId }).from(schema.workTaskDependency).where(eq(schema.workTaskDependency.type, "blocks"));
      if (wouldCreateDependencyCycle(edges, blockerTaskId, blockedTaskId)) throw new ActionError("dependency_cycle");
    }
    const [row] = await tx.insert(schema.workTaskDependency).values({ blockerTaskId, blockedTaskId, type, createdByPersonId: actorPersonId }).returning();
    const named = (loaded: LoadedTask) => ({ id: loaded.task.id, name: `${taskKey(loaded.team.key, loaded.work.number)} ${loaded.task.title}` });
    await logActivity(tx, blockedTaskId, actorPersonId, [{ type: "dependency_added", field: type === "blocks" ? "blocked_by" : "relates", to: named(blocker) }]);
    await logActivity(tx, blockerTaskId, actorPersonId, [{ type: "dependency_added", field: type === "blocks" ? "blocks" : "relates", to: named(blocked) }]);
    return { id: row.id };
  });
}

export async function findDependency(dependencyId: string) {
  const [row] = await db().select().from(schema.workTaskDependency).where(eq(schema.workTaskDependency.id, dependencyId)).limit(1);
  return row;
}

export async function removeDependency(dependencyId: string, actorPersonId: string): Promise<{ blockerTaskId: string; blockedTaskId: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.delete(schema.workTaskDependency).where(eq(schema.workTaskDependency.id, dependencyId)).returning();
    if (!row) throw new ActionError("dependency_not_found");
    await logActivity(tx, row.blockedTaskId, actorPersonId, [{ type: "dependency_removed", field: row.type === "blocks" ? "blocked_by" : "relates", from: { id: row.blockerTaskId } }]);
    await logActivity(tx, row.blockerTaskId, actorPersonId, [{ type: "dependency_removed", field: row.type === "blocks" ? "blocks" : "relates", from: { id: row.blockedTaskId } }]);
    return row;
  });
}

// ── Lists ───────────────────────────────────────────────────────────────────────────────────

/** One row of the list, board and calendar: everything the in-memory filters need. */
export type TaskListItem = {
  id: string;
  key: string;
  number: number;
  title: string;
  status: TaskRow["status"];
  stateId: string;
  priority: number | null;
  assigneePersonId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  parentTaskId: string | null;
  projectId: string | null;
  teamId: string;
  clientId: string | null;
  channel: string | null;
  contentFormat: string | null;
  boardRank: number;
  labelIds: string[];
  /** Open tasks that block this one. */
  blockedBy: number;
  subtasks: { done: number; total: number };
  checklist: { done: number; total: number };
  updatedAt: string;
  /** FR-PJM-35. */
  customValues: Record<string, CustomFieldValue>;
  /** FR-PJM-32: null = not in triage. */
  triageStatus: string | null;
  /** FR-PJM-28: the open blocker raised on the task, if any. */
  blocker: { reason: string; neededName: string | null; raisedAt: string } | null;
  /** FR-PJM-10. */
  cycleId: string | null;
  /** FR-PJM-44: the assignee is on leave with a submitted cover plan — "away, covered by X". */
  away: { until: string; coverName: string | null } | null;
};

export async function listItems(where: SQL | undefined, executor: Executor, limit = 2000): Promise<TaskListItem[]> {
  const assignee = alias(schema.person, "assignee");
  const rows = await executor
    .select({ task: schema.task, work: schema.workTask, teamKey: schema.workTeam.key, assigneeName: assignee.fullName })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(assignee, eq(assignee.id, schema.task.assigneePersonId))
    .where(and(eq(schema.task.kind, WORK_KIND), live, where))
    .orderBy(asc(schema.workTask.boardRank), asc(schema.workTask.number))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.task.id);
  const blocker = alias(schema.task, "blocker");
  const needed = alias(schema.person, "needed");
  const assignees = [...new Set(rows.map((row) => row.task.assigneePersonId).filter((id): id is string => !!id))];
  const [labels, blocks, children, raised, away] = await Promise.all([
    executor.select().from(schema.workTaskLabel).where(inArray(schema.workTaskLabel.taskId, ids)),
    executor
      .select({ taskId: schema.workTaskDependency.blockedTaskId, count: sql<number>`count(*)::int` })
      .from(schema.workTaskDependency)
      .innerJoin(blocker, eq(blocker.id, schema.workTaskDependency.blockerTaskId))
      .where(and(inArray(schema.workTaskDependency.blockedTaskId, ids), eq(schema.workTaskDependency.type, "blocks"), isNull(blocker.deletedAt), inArray(blocker.status, ["todo", "in_progress"])))
      .groupBy(schema.workTaskDependency.blockedTaskId),
    executor
      .select({ parentId: schema.task.parentTaskId, done: sql<number>`count(*) filter (where ${schema.task.status} = 'done')::int`, total: sql<number>`count(*) filter (where ${schema.task.status} <> 'cancelled')::int` })
      .from(schema.task)
      .where(and(inArray(schema.task.parentTaskId, ids), live))
      .groupBy(schema.task.parentTaskId),
    executor
      .select({ taskId: schema.workBlocker.taskId, reason: schema.workBlocker.reason, neededName: needed.fullName, raisedAt: schema.workBlocker.raisedAt })
      .from(schema.workBlocker)
      .leftJoin(needed, eq(needed.id, schema.workBlocker.neededPersonId))
      .where(and(inArray(schema.workBlocker.taskId, ids), isNull(schema.workBlocker.resolvedAt))),
    awayToday(executor, assignees),
  ]);
  const blockerOf = new Map(raised.map((row) => [row.taskId, { reason: row.reason, neededName: row.neededName, raisedAt: row.raisedAt.toISOString() }]));
  const labelsOf = Map.groupBy(labels, (label) => label.taskId);
  const blockedBy = new Map(blocks.map((row) => [row.taskId, row.count]));
  const subtasksOf = new Map(children.map((row) => [row.parentId, row]));
  return rows.map(({ task, work, teamKey, assigneeName }) => {
    const own = subtasksOf.get(task.id);
    return {
      id: task.id,
      key: taskKey(teamKey, work.number),
      number: work.number,
      title: task.title,
      status: task.status,
      stateId: work.stateId,
      priority: task.priority,
      assigneePersonId: task.assigneePersonId,
      assigneeName,
      startDate: task.startDate,
      dueDate: task.dueDate,
      estimateMinutes: task.estimateMinutes,
      parentTaskId: task.parentTaskId,
      projectId: work.projectId,
      teamId: work.teamId,
      clientId: work.clientId,
      channel: work.channel,
      contentFormat: work.contentFormat,
      boardRank: work.boardRank,
      labelIds: (labelsOf.get(task.id) ?? []).map((label) => label.labelId),
      blockedBy: blockedBy.get(task.id) ?? 0,
      subtasks: { done: own?.done ?? 0, total: own?.total ?? 0 },
      checklist: { done: work.checklist.filter((item) => item.done).length, total: work.checklist.length },
      updatedAt: task.updatedAt.toISOString(),
      customValues: work.customValues,
      triageStatus: work.triageStatus,
      blocker: blockerOf.get(task.id) ?? null,
      cycleId: work.cycleId,
      away: (task.assigneePersonId && away.get(task.assigneePersonId)) || null,
    };
  });
}

/**
 * Who of these people is away today under a submitted cover plan (FR-PJM-44), until when, and who
 * covers: the plan's cover for everything, else the first cover named on one of its items.
 */
export async function awayToday(executor: Executor, personIds: readonly string[]): Promise<Map<string, { until: string; coverName: string | null }>> {
  if (personIds.length === 0) return new Map();
  const today = todayInVietnam();
  const rows = await executor
    .select({
      personId: schema.workCoverPlan.personId,
      until: schema.workCoverPlan.toDate,
      // Spelled out: in a one-table query drizzle leaves columns unqualified, and "id" would be ambiguous inside the subqueries.
      coverName: sql<string | null>`coalesce((select p.full_name from person p where p.id = work_cover_plan.default_cover_person_id), (select p.full_name from work_cover_item i join person p on p.id = i.cover_person_id where i.plan_id = work_cover_plan.id order by p.full_name limit 1))`,
    })
    .from(schema.workCoverPlan)
    .where(and(inArray(schema.workCoverPlan.personId, [...personIds]), eq(schema.workCoverPlan.status, "submitted"), sql`${schema.workCoverPlan.fromDate} <= ${today} and ${schema.workCoverPlan.toDate} >= ${today}`));
  return new Map(rows.map((row) => [row.personId, { until: row.until, coverName: row.coverName }]));
}

/**
 * The "link a task" picker of a task page: the open tasks of its project (or of its team's
 * backlog), keys and titles only. The caller has checked the viewer may open that list.
 */
export async function listLinkableTasks(scope: { projectId: string | null; teamId: string }, limit = 2000): Promise<{ id: string; key: string; title: string }[]> {
  const rows = await db()
    .select({ id: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(eq(schema.task.kind, WORK_KIND), live, inArray(schema.task.status, ["todo", "in_progress"]), scope.projectId ? eq(schema.workTask.projectId, scope.projectId) : and(eq(schema.workTask.teamId, scope.teamId), isNull(schema.workTask.projectId))))
    .orderBy(asc(schema.workTask.boardRank), asc(schema.workTask.number))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, key: taskKey(row.teamKey, row.number), title: row.title }));
}

/** The caller has checked that the viewer may open the project. */
export const listProjectTasks = (projectId: string, executor: Executor = db()) => listItems(eq(schema.workTask.projectId, projectId), executor);

/** The team's own backlog: tasks outside any project. The caller has checked `canViewTeamBacklog`. */
export const listTeamBacklog = (teamId: string, executor: Executor = db()) => listItems(and(eq(schema.workTask.teamId, teamId), isNull(schema.workTask.projectId)), executor);

/**
 * The list form of `canViewTask`: which work tasks may this viewer see? Projects and teams are
 * few, so the pure policy picks the ids and SQL only matches them; the people on a task (assignee,
 * requester, creator, collaborators) always see it — followers do not: following gives no rights. A PGlite test keeps this and
 * `canViewTask` in step.
 */
export async function visibleTaskCondition(viewer: WorkViewer, executor?: Executor): Promise<SQL> {
  // From the cached directory, unless a transaction asks to read its own rows.
  const directory = await workDirectory(executor);
  const projects = projectsWithTeams(directory);
  const teams = directory.teams;
  const projectIds = projects.filter((row) => canViewProject(viewer, projectFacts(row.project, row.team))).map((row) => row.project.id);
  const teamIds = teams.filter((team) => canViewTeamBacklog(viewer, teamFacts(team))).map((team) => team.id);
  const self = viewer.principal.personId;
  const clauses: (SQL | undefined)[] = [
    projectIds.length ? inArray(schema.workTask.projectId, projectIds) : undefined,
    teamIds.length ? and(isNull(schema.workTask.projectId), inArray(schema.workTask.teamId, teamIds)) : undefined,
  ];
  if (self) {
    clauses.push(
      eq(schema.task.assigneePersonId, self),
      eq(schema.task.requesterPersonId, self),
      eq(schema.task.createdByPersonId, self),
      exists((executor ?? db()).select({ one: sql`1` }).from(schema.workTaskPerson).where(and(eq(schema.workTaskPerson.taskId, schema.task.id), eq(schema.workTaskPerson.personId, self), eq(schema.workTaskPerson.role, "collaborator")))),
    );
  }
  return or(...clauses.filter((clause): clause is SQL => !!clause)) ?? sql`false`;
}

export async function listVisibleTaskIds(viewer: WorkViewer, executor?: Executor): Promise<string[]> {
  const rows = await (executor ?? db()).select({ id: schema.task.id }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(and(eq(schema.task.kind, WORK_KIND), live, await visibleTaskCondition(viewer, executor)));
  return rows.map((row) => row.id);
}

/** A number the task had before it moved team (FR-PJM-34): "VID-123" keeps finding it. */
const aliasMatches = (number: number, teamKey: string | null) => {
  const oldTeam = alias(schema.workTeam, "old_team");
  return exists(
    db()
      .select({ one: sql`1` })
      .from(schema.workTaskNumberAlias)
      .innerJoin(oldTeam, eq(oldTeam.id, schema.workTaskNumberAlias.teamId))
      .where(and(eq(schema.workTaskNumberAlias.taskId, schema.task.id), eq(schema.workTaskNumberAlias.number, number), teamKey ? eq(oldTeam.key, teamKey.toUpperCase()) : undefined)),
  );
};

/**
 * "VID-123" → the task that has, or had, that number. Current numbers first; a number left behind
 * by a move still resolves. No access check: the caller opens the task through `getTaskDetail`.
 */
export async function resolveTaskKey(key: string, executor: Executor = db()): Promise<string | null> {
  const match = /^([a-z][a-z0-9]{1,7})-(\d{1,7})$/i.exec(key.trim());
  if (!match) return null;
  const [teamKey, number] = [match[1].toUpperCase(), Number(match[2])];
  const [current] = await executor.select({ id: schema.workTask.taskId }).from(schema.workTask).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId)).where(and(eq(schema.workTeam.key, teamKey), eq(schema.workTask.number, number))).limit(1);
  if (current) return current.id;
  const [moved] = await executor.select({ id: schema.workTaskNumberAlias.taskId }).from(schema.workTaskNumberAlias).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTaskNumberAlias.teamId)).where(and(eq(schema.workTeam.key, teamKey), eq(schema.workTaskNumberAlias.number, number))).limit(1);
  return moved?.id ?? null;
}

export type TaskSearchHit = { id: string; key: string; title: string; status: TaskRow["status"]; projectName: string | null };

/** Command palette: by title, or by key ("VID-12", "12"). */
export async function searchTasks(viewer: WorkViewer, query: string, limit = 12): Promise<TaskSearchHit[]> {
  const text = query.trim().slice(0, 80);
  if (text.length < 2 && !/^\d+$/.test(text)) return [];
  const keyMatch = /^(?:([a-z0-9]{2,8})-)?(\d{1,7})$/i.exec(text);
  const escaped = text.replace(/[\\%_]/g, (character) => `\\${character}`);
  const matches = or(ilike(schema.task.title, `%${escaped}%`), keyMatch ? and(eq(schema.workTask.number, Number(keyMatch[2])), keyMatch[1] ? eq(schema.workTeam.key, keyMatch[1].toUpperCase()) : undefined) : undefined, keyMatch ? aliasMatches(Number(keyMatch[2]), keyMatch[1] ?? null) : undefined);
  const rows = await db()
    .select({ id: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, status: schema.task.status, projectName: schema.workProject.name })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(and(eq(schema.task.kind, WORK_KIND), live, matches, await visibleTaskCondition(viewer)))
    .orderBy(sql`case when ${schema.task.status} in ('todo', 'in_progress') then 0 else 1 end`, desc(schema.task.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, key: taskKey(row.teamKey, row.number), title: row.title, status: row.status, projectName: row.projectName }));
}

// ── One task, in full ───────────────────────────────────────────────────────────────────────

export type LinkedTask = { dependencyId: string; id: string; key: string; title: string; status: TaskRow["status"]; relation: "blocks" | "blocked_by" | "relates" };
export type TaskDetail = LoadedTask & {
  key: string;
  stateName: string;
  assigneeName: string | null;
  requesterName: string | null;
  createdByName: string | null;
  clientName: string | null;
  parent: { id: string; key: string; title: string } | null;
  labelIds: string[];
  collaborators: { id: string; name: string }[];
  subtasks: TaskListItem[];
  linked: LinkedTask[];
};

export async function getTaskDetail(taskId: string, viewer: WorkViewer): Promise<TaskDetail | undefined> {
  const loaded = await loadTask(taskId);
  if (!loaded || !canViewTask(viewer, loaded.facts)) return undefined;
  const { task, work, team } = loaded;
  const personIds = [task.assigneePersonId, task.requesterPersonId, task.createdByPersonId, ...loaded.peopleIds].filter((id): id is string => !!id);
  const [people, [state], [client], labels, subtasks, dependencies, parent] = await Promise.all([
    personIds.length ? db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, personIds)) : [],
    db().select({ name: schema.workState.name }).from(schema.workState).where(eq(schema.workState.id, work.stateId)),
    work.clientId ? db().select({ name: schema.workClient.name }).from(schema.workClient).where(eq(schema.workClient.id, work.clientId)) : [],
    db().select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, taskId)),
    listItems(eq(schema.task.parentTaskId, taskId), db()),
    db().select().from(schema.workTaskDependency).where(or(eq(schema.workTaskDependency.blockerTaskId, taskId), eq(schema.workTaskDependency.blockedTaskId, taskId))),
    task.parentTaskId ? loadTask(task.parentTaskId) : undefined,
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  // A linked task in a project the viewer cannot open stays out of sight, title and all.
  const otherOf = (dependency: (typeof dependencies)[number]) => (dependency.blockerTaskId === taskId ? dependency.blockedTaskId : dependency.blockerTaskId);
  const others = await loadTasks(dependencies.map(otherOf));
  const linked: LinkedTask[] = [];
  for (const dependency of dependencies) {
    const other = others.get(otherOf(dependency));
    if (!other || !canViewTask(viewer, other.facts)) continue;
    const relation = dependency.type === "relates" ? "relates" : dependency.blockerTaskId === taskId ? "blocks" : "blocked_by";
    linked.push({ dependencyId: dependency.id, id: other.task.id, key: taskKey(other.team.key, other.work.number), title: other.task.title, status: other.task.status, relation });
  }
  return {
    ...loaded,
    key: taskKey(team.key, work.number),
    stateName: state?.name ?? "",
    assigneeName: nameOf(task.assigneePersonId),
    requesterName: nameOf(task.requesterPersonId),
    createdByName: nameOf(task.createdByPersonId),
    clientName: client?.name ?? null,
    parent: parent && canViewTask(viewer, parent.facts) ? { id: parent.task.id, key: taskKey(parent.team.key, parent.work.number), title: parent.task.title } : null,
    labelIds: labels.map((label) => label.labelId),
    collaborators: loaded.peopleIds.map((personId) => ({ id: personId, name: nameOf(personId) ?? "" })),
    subtasks,
    linked,
  };
}
