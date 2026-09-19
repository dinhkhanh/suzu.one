// Work tasks: a row of the engine's `task` table (kind "work") plus its `work_task` half. Every
// change is written to `work_activity`, field by field (FR-WRK-09).
import "server-only";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { createTask, type TaskRow } from "../platform/tasks-engine/service";
import { rankBetween, wouldCreateDependencyCycle, wouldCreateParentCycle } from "./engine/graph";
import { CATEGORY_STATUS, type DependencyType, type StateCategory } from "./enums";
import { canViewProject, canViewTask, canViewTeamBacklog, type TaskFacts, type WorkViewer } from "./policy";
import { projectFacts, type ProjectRow } from "./projects";
import type { TaskChecklistItem, TaskLink } from "./schema";
import { entryState, listStates, teamFacts, type StateRow, type TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type WorkTaskRow = typeof schema.workTask.$inferSelect;
export const WORK_KIND = "work";
export const PROJECT_CONTEXT = "work_project";

const live = isNull(schema.task.deletedAt);
const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
export const taskKey = (teamKey: string, number: number) => `${teamKey}-${number}`;

// ── Loading one task with what the policy needs ─────────────────────────────────────────────

export type LoadedTask = { task: TaskRow; work: WorkTaskRow; team: TeamRow; project: ProjectRow | null; peopleIds: string[]; facts: TaskFacts };

export async function loadTask(taskId: string, executor: Executor = db()): Promise<LoadedTask | undefined> {
  const [row] = await executor
    .select({ task: schema.task, work: schema.workTask, team: schema.workTeam, project: schema.workProject })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(and(eq(schema.task.id, taskId), live))
    .limit(1);
  if (!row) return undefined;
  const people = await executor.select({ personId: schema.workTaskPerson.personId }).from(schema.workTaskPerson).where(eq(schema.workTaskPerson.taskId, taskId));
  const peopleIds = people.map((person) => person.personId);
  const facts: TaskFacts = {
    team: teamFacts(row.team),
    project: row.project ? projectFacts(row.project, row.team) : null,
    assigneePersonId: row.task.assigneePersonId,
    requesterPersonId: row.task.requesterPersonId,
    createdByPersonId: row.task.createdByPersonId,
    peopleIds,
  };
  return { ...row, peopleIds, facts };
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────

type ActivityEntry = { type: string; field?: string | null; from?: unknown; to?: unknown };

async function logActivity(tx: Executor, taskId: string, actorPersonId: string | null, entries: ActivityEntry[]): Promise<void> {
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
    },
    actorPersonId,
    { notify: false },
  );
  const fields = statusFields(state.category as StateCategory, actorPersonId);
  if (fields.status !== "todo") await tx.update(schema.task).set(fields).where(eq(schema.task.id, task.id));

  const [work] = await tx
    .insert(schema.workTask)
    .values({ taskId: task.id, teamId: team.id, projectId: project?.id ?? null, number: team.taskSeq, stateId: state.id, clientId: clientId ?? project?.clientId ?? null, channel: input.channel ?? null, contentFormat: input.contentFormat ?? null, boardRank: await nextRank(tx, state.id) })
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
}>;

const changed = <T>(next: T | undefined, current: T): next is T => next !== undefined && next !== current;

export async function updateWorkTask(taskId: string, patch: WorkTaskPatch, actorPersonId: string): Promise<{ before: LoadedTask; changes: ActivityEntry[] }> {
  return db().transaction(async (tx) => {
    const before = await loadTask(taskId, tx);
    if (!before) throw new ActionError("task_not_found");
    const { task, work, team } = before;
    const taskSet: Partial<typeof schema.task.$inferInsert> = {};
    const workSet: Partial<typeof schema.workTask.$inferInsert> = {};
    const changes: ActivityEntry[] = [];
    const plain = (field: string, from: unknown, to: unknown) => changes.push({ type: "field_changed", field, from, to });

    if (changed(patch.title, task.title)) (taskSet.title = patch.title), plain("title", task.title, patch.title);
    if (changed(patch.description, task.description)) (taskSet.description = patch.description), plain("description", null, null);
    if (changed(patch.priority, task.priority)) (taskSet.priority = patch.priority), plain("priority", task.priority, patch.priority);
    if (changed(patch.estimateMinutes, task.estimateMinutes)) (taskSet.estimateMinutes = patch.estimateMinutes), plain("estimateMinutes", task.estimateMinutes, patch.estimateMinutes);
    if (changed(patch.startDate, task.startDate)) (taskSet.startDate = patch.startDate), plain("startDate", task.startDate, patch.startDate);
    if (changed(patch.dueDate, task.dueDate)) (taskSet.dueDate = patch.dueDate), plain("dueDate", task.dueDate, patch.dueDate);
    const startDate = patch.startDate === undefined ? task.startDate : patch.startDate;
    const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate;
    if (startDate && dueDate && dueDate < startDate) throw new ActionError("task_dates_invalid");
    if (changed(patch.channel, work.channel)) (workSet.channel = patch.channel), plain("channel", work.channel, patch.channel);
    if (changed(patch.contentFormat, work.contentFormat)) (workSet.contentFormat = patch.contentFormat), plain("contentFormat", work.contentFormat, patch.contentFormat);

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
    await notify({ recipients, kind: "tasks.work_assigned", params: { key: taskKey(team.key, work.number), title: patch.title ?? task.title }, link: taskLink(taskId) }, tx);
    return { before, changes };
  });
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
    const [blocker, blocked] = [await loadTask(blockerTaskId, tx), await loadTask(blockedTaskId, tx)];
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
};

async function listItems(where: SQL | undefined, executor: Executor, limit = 2000): Promise<TaskListItem[]> {
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
  const [labels, blocks, children] = await Promise.all([
    executor.select().from(schema.workTaskLabel).where(inArray(schema.workTaskLabel.taskId, ids)),
    executor
      .select({ taskId: schema.workTaskDependency.blockedTaskId })
      .from(schema.workTaskDependency)
      .innerJoin(blocker, eq(blocker.id, schema.workTaskDependency.blockerTaskId))
      .where(and(inArray(schema.workTaskDependency.blockedTaskId, ids), eq(schema.workTaskDependency.type, "blocks"), isNull(blocker.deletedAt), inArray(blocker.status, ["todo", "in_progress"]))),
    executor.select({ parentId: schema.task.parentTaskId, status: schema.task.status }).from(schema.task).where(and(inArray(schema.task.parentTaskId, ids), live)),
  ]);
  return rows.map(({ task, work, teamKey, assigneeName }) => {
    const own = children.filter((child) => child.parentId === task.id && child.status !== "cancelled");
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
      labelIds: labels.filter((label) => label.taskId === task.id).map((label) => label.labelId),
      blockedBy: blocks.filter((row) => row.taskId === task.id).length,
      subtasks: { done: own.filter((child) => child.status === "done").length, total: own.length },
      checklist: { done: work.checklist.filter((item) => item.done).length, total: work.checklist.length },
      updatedAt: task.updatedAt.toISOString(),
    };
  });
}

/** The caller has checked that the viewer may open the project. */
export const listProjectTasks = (projectId: string, executor: Executor = db()) => listItems(eq(schema.workTask.projectId, projectId), executor);

/** The team's own backlog: tasks outside any project. The caller has checked `canViewTeamBacklog`. */
export const listTeamBacklog = (teamId: string, executor: Executor = db()) => listItems(and(eq(schema.workTask.teamId, teamId), isNull(schema.workTask.projectId)), executor);

/**
 * The list form of `canViewTask`: which work tasks may this viewer see? Projects and teams are
 * few, so the pure policy picks the ids and SQL only matches them; the people on a task (assignee,
 * requester, creator, collaborators, followers) always see it. A PGlite test keeps this and
 * `canViewTask` in step.
 */
export async function visibleTaskCondition(viewer: WorkViewer, executor: Executor = db()): Promise<SQL> {
  const [projects, teams] = await Promise.all([
    executor.select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)),
    executor.select().from(schema.workTeam),
  ]);
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
      exists(executor.select({ one: sql`1` }).from(schema.workTaskPerson).where(and(eq(schema.workTaskPerson.taskId, schema.task.id), eq(schema.workTaskPerson.personId, self)))),
    );
  }
  return or(...clauses.filter((clause): clause is SQL => !!clause)) ?? sql`false`;
}

export async function listVisibleTaskIds(viewer: WorkViewer, executor: Executor = db()): Promise<string[]> {
  const rows = await executor.select({ id: schema.task.id }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(and(eq(schema.task.kind, WORK_KIND), live, await visibleTaskCondition(viewer, executor)));
  return rows.map((row) => row.id);
}

export type TaskSearchHit = { id: string; key: string; title: string; status: TaskRow["status"]; projectName: string | null };

/** Command palette: by title, or by key ("VID-12", "12"). */
export async function searchTasks(viewer: WorkViewer, query: string, limit = 12): Promise<TaskSearchHit[]> {
  const text = query.trim().slice(0, 80);
  if (text.length < 2 && !/^\d+$/.test(text)) return [];
  const keyMatch = /^(?:([a-z0-9]{2,8})-)?(\d{1,7})$/i.exec(text);
  const escaped = text.replace(/[\\%_]/g, (character) => `\\${character}`);
  const matches = or(ilike(schema.task.title, `%${escaped}%`), keyMatch ? and(eq(schema.workTask.number, Number(keyMatch[2])), keyMatch[1] ? eq(schema.workTeam.key, keyMatch[1].toUpperCase()) : undefined) : undefined);
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
  const [people, [state], [client], labels, roles, subtasks, dependencies, parent] = await Promise.all([
    personIds.length ? db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, personIds)) : [],
    db().select({ name: schema.workState.name }).from(schema.workState).where(eq(schema.workState.id, work.stateId)),
    work.clientId ? db().select({ name: schema.workClient.name }).from(schema.workClient).where(eq(schema.workClient.id, work.clientId)) : [],
    db().select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, taskId)),
    db().select().from(schema.workTaskPerson).where(eq(schema.workTaskPerson.taskId, taskId)),
    listItems(eq(schema.task.parentTaskId, taskId), db()),
    db().select().from(schema.workTaskDependency).where(or(eq(schema.workTaskDependency.blockerTaskId, taskId), eq(schema.workTaskDependency.blockedTaskId, taskId))),
    task.parentTaskId ? loadTask(task.parentTaskId) : undefined,
  ]);
  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? null;

  // A linked task in a project the viewer cannot open stays out of sight, title and all.
  const linked: LinkedTask[] = [];
  for (const dependency of dependencies) {
    const otherId = dependency.blockerTaskId === taskId ? dependency.blockedTaskId : dependency.blockerTaskId;
    const other = await loadTask(otherId);
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
    collaborators: roles.filter((role) => role.role === "collaborator").map((role) => ({ id: role.personId, name: nameOf(role.personId) ?? "" })),
    subtasks,
    linked,
  };
}
