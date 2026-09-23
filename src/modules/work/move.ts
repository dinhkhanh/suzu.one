// Moving a task to another team (FR-PJM-34), its sub-tasks with it. Each moved task takes the
// target team's workflow (states mapped by category, engine/move.ts) and a new number from the
// target team's sequence; the old number stays in `work_task_number_alias`, so "VID-123" quoted in a
// chat still finds it. History, comments, files and links stay; the old team's own labels and cycle
// do not travel, and the project is the one chosen in the target team, or none.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { rankBetween } from "./engine/graph";
import { mapStatesByCategory } from "./engine/move";
import { CATEGORY_STATUS, type StateCategory } from "./enums";
import { assertInsidePrivateProject, type LoadedTask, loadTask, logActivity, PROJECT_CONTEXT, taskKey } from "./tasks";
import { projectsWithTeams, workDirectory } from "./directory";
import { canMoveTask, type TaskFacts, type WorkViewer } from "./policy";
import { projectFacts } from "./projects";
import { listStates, teamFacts } from "./teams";

export type MoveResult = { moved: { taskId: string; fromKey: string; toKey: string }[]; loaded: LoadedTask; targetTeamId: string; targetProjectId: string | null };

/** Where each state of the source team would land in the target team — for the task page to preview. */
export async function previewMove(fromTeamId: string, toTeamId: string): Promise<Map<string, string | null>> {
  const [from, to] = await Promise.all([listStates([fromTeamId]), listStates([toTeamId])]);
  return mapStatesByCategory(from, to);
}

export async function moveTaskToTeam(taskId: string, target: { teamId: string; projectId: string | null }, actorPersonId: string): Promise<MoveResult> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const fromTeam = loaded.team;
    if (fromTeam.id === target.teamId) throw new ActionError("move_same_team");
    const [toTeam] = await tx.select().from(schema.workTeam).where(and(eq(schema.workTeam.id, target.teamId), eq(schema.workTeam.isActive, true))).limit(1);
    if (!toTeam) throw new ActionError("team_not_found");
    let project: typeof schema.workProject.$inferSelect | null = null;
    if (target.projectId) {
      [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, target.projectId)).limit(1);
      if (!project || project.teamId !== toTeam.id) throw new ActionError("project_not_found");
      if (project.status === "archived") throw new ActionError("project_archived");
    }

    // The task and every live sub-task below it, parents before children.
    const ids = [taskId];
    for (let frontier = [taskId]; frontier.length > 0; ) {
      const children = await tx.select({ id: schema.task.id }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(and(inArray(schema.task.parentTaskId, frontier), isNull(schema.task.deletedAt), eq(schema.workTask.teamId, fromTeam.id)));
      frontier = children.map((child) => child.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    const rows = await tx.select({ task: schema.task, work: schema.workTask }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(inArray(schema.task.id, ids));
    const byId = new Map(rows.map((row) => [row.task.id, row]));

    // A sub-task filed in another private project is that project's work: it does not leave with a
    // task from elsewhere (the move is weighed against the root's project only), so the move is refused.
    const elsewhere = [...new Set(rows.flatMap((row) => (row.work.projectId && row.work.projectId !== loaded.work.projectId ? [row.work.projectId] : [])))];
    if (elsewhere.length) {
      const [closed] = await tx.select({ id: schema.workProject.id }).from(schema.workProject).where(and(inArray(schema.workProject.id, elsewhere), eq(schema.workProject.visibility, "private"))).limit(1);
      if (closed) throw new ActionError("move_subtask_private");
    }
    // Everyone on the family ends up in the target project: a private one takes only its own people.
    const collaborators = await tx.select({ personId: schema.workTaskPerson.personId }).from(schema.workTaskPerson).where(and(inArray(schema.workTaskPerson.taskId, ids), eq(schema.workTaskPerson.role, "collaborator")));
    await assertInsidePrivateProject(tx, project?.id ?? null, [...rows.flatMap((row) => [row.task.assigneePersonId, row.task.requesterPersonId, row.work.reviewerPersonId]), ...collaborators.map((row) => row.personId)]);

    const [fromStates, toStates] = await Promise.all([listStates([fromTeam.id], tx), listStates([toTeam.id], tx)]);
    const mapping = mapStatesByCategory(fromStates, toStates);
    for (const row of rows) if (!mapping.get(row.work.stateId)) throw new ActionError("move_no_state");

    // One bump of the target's sequence for the whole family: numbers follow the order above.
    const [bumped] = await tx.update(schema.workTeam).set({ taskSeq: sql`${schema.workTeam.taskSeq} + ${ids.length}` }).where(eq(schema.workTeam.id, toTeam.id)).returning({ taskSeq: schema.workTeam.taskSeq });
    const firstNumber = bumped.taskSeq - ids.length + 1;
    const oldTeamLabels = (await tx.select({ id: schema.workLabel.id }).from(schema.workLabel).where(eq(schema.workLabel.teamId, fromTeam.id))).map((row) => row.id);
    const stateName = (id: string, states: typeof toStates) => states.find((state) => state.id === id);
    const [{ rank }] = await tx.select({ rank: sql<number | null>`max(${schema.workTask.boardRank})` }).from(schema.workTask).where(eq(schema.workTask.teamId, toTeam.id));
    let lastRank = rank ?? null;

    const moved: MoveResult["moved"] = [];
    for (const [index, id] of ids.entries()) {
      const { task, work } = byId.get(id)!;
      const number = firstNumber + index;
      const stateId = mapping.get(work.stateId)!;
      const [fromState, toState] = [stateName(work.stateId, fromStates)!, stateName(stateId, toStates)!];
      const status = CATEGORY_STATUS[toState.category as StateCategory];
      lastRank = rankBetween(lastRank, null);
      await tx.insert(schema.workTaskNumberAlias).values({ teamId: fromTeam.id, number: work.number, taskId: id }).onConflictDoNothing();
      await tx.update(schema.workTask).set({ teamId: toTeam.id, number, stateId, projectId: project?.id ?? null, boardRank: lastRank, cycleId: null, triageStatus: null, triageSource: null, triageSnoozedUntil: null }).where(eq(schema.workTask.taskId, id));
      await tx
        .update(schema.task)
        .set({
          // The root leaves its parent behind (a parent stays in its own team); sub-tasks keep theirs.
          ...(id === taskId ? { parentTaskId: null } : {}),
          contextType: project ? PROJECT_CONTEXT : null,
          contextId: project?.id ?? null,
          entityId: project?.entityId ?? toTeam.entityId,
          ...(status !== task.status ? { status, completedAt: status === "done" ? (task.completedAt ?? new Date()) : null, completedByPersonId: status === "done" ? (task.completedByPersonId ?? actorPersonId) : null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.task.id, id));
      const dropped = oldTeamLabels.length ? await tx.delete(schema.workTaskLabel).where(and(eq(schema.workTaskLabel.taskId, id), inArray(schema.workTaskLabel.labelId, oldTeamLabels))).returning({ labelId: schema.workTaskLabel.labelId }) : [];
      const [fromKey, toKey] = [taskKey(fromTeam.key, work.number), taskKey(toTeam.key, number)];
      await logActivity(tx, id, actorPersonId, [
        { type: "moved", from: { id: fromTeam.id, name: fromKey, team: fromTeam.name, state: fromState.name }, to: { id: toTeam.id, name: toKey, team: toTeam.name, state: toState.name, project: project?.name ?? null, labelsDropped: dropped.length } },
        ...(id === taskId && task.parentTaskId ? [{ type: "field_changed", field: "parent", from: { id: task.parentTaskId }, to: null }] : []),
      ]);
      moved.push({ taskId: id, fromKey, toKey });
    }
    return { moved, loaded, targetTeamId: toTeam.id, targetProjectId: project?.id ?? null };
  });
}

/** Where the viewer may move this task: other active teams, each with the projects there that would take it. */
export async function listMoveTargets(viewer: WorkViewer, task: TaskFacts): Promise<{ id: string; key: string; name: string; /** Into the team's backlog, without a project. */ backlog: boolean; projects: { id: string; name: string }[] }[]> {
  const directory = await workDirectory();
  const projects = projectsWithTeams(directory).filter(({ project }) => project.status !== "archived" && project.status !== "done");
  return directory.teams
    .filter((team) => team.isActive && team.id !== task.team.id)
    .flatMap((team) => {
      const facts = teamFacts(team);
      const own = projects.filter(({ project }) => project.teamId === team.id && canMoveTask(viewer, task, { team: facts, project: projectFacts(project, team) })).map(({ project }) => ({ id: project.id, name: project.name }));
      const backlog = canMoveTask(viewer, task, { team: facts, project: null });
      return own.length > 0 || backlog ? [{ id: team.id, key: team.key, name: team.name, backlog, projects: own }] : [];
    });
}
