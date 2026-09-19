// Projects and who may open them. The visible set is computed with the same pure policy the
// single-record checks use: project rows are few (hundreds), so every list starts from
// `visibleProjects()` and SQL only ever sees ids the policy already allowed.
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { ProjectStatus, TeamRole, Visibility } from "./enums";
import { canContributeToProject, canContributeToTeam, canCreateProject, canViewProject, type ProjectFacts, type WorkViewer } from "./policy";
import { teamFacts, type TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type ProjectRow = typeof schema.workProject.$inferSelect;

export const projectFacts = (project: Pick<ProjectRow, "id" | "entityId" | "visibility">, team: Pick<TeamRow, "id" | "entityId" | "departmentId" | "defaultVisibility">): ProjectFacts => ({ id: project.id, entityId: project.entityId, visibility: project.visibility as Visibility, team: teamFacts(team) });

export type ProjectWithTeam = { project: ProjectRow; team: TeamRow };

export async function findProject(projectId: string, executor: Executor = db()): Promise<ProjectWithTeam | undefined> {
  const [row] = await executor.select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(eq(schema.workProject.id, projectId)).limit(1);
  return row;
}

export type ProjectSummary = ProjectRow & { teamKey: string; teamName: string; clientName: string | null; leadName: string | null; openTasks: number; doneTasks: number; overdueTasks: number };

/** Every project the viewer may open, with task counts. */
export async function visibleProjects(viewer: WorkViewer, options: { today: string; includeArchived?: boolean; executor?: Executor } = { today: "9999-12-31" }): Promise<ProjectSummary[]> {
  const executor = options.executor ?? db();
  const rows = await executor
    .select({ project: schema.workProject, team: schema.workTeam, clientName: schema.workClient.name, leadName: schema.person.fullName })
    .from(schema.workProject)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workProject.leadPersonId))
    .orderBy(asc(schema.workProject.name));
  const visible = rows.filter((row) => (options.includeArchived || row.project.status !== "archived") && canViewProject(viewer, projectFacts(row.project, row.team)));
  if (visible.length === 0) return [];

  const counts = await executor
    .select({
      projectId: schema.workTask.projectId,
      open: sql<number>`count(*) filter (where ${schema.task.status} in ('todo', 'in_progress'))::int`,
      done: sql<number>`count(*) filter (where ${schema.task.status} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${schema.task.status} in ('todo', 'in_progress') and ${schema.task.dueDate} < ${options.today})::int`,
    })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .where(and(inArray(schema.workTask.projectId, visible.map((row) => row.project.id)), isNull(schema.task.deletedAt)))
    .groupBy(schema.workTask.projectId);
  const byProject = new Map(counts.map((row) => [row.projectId, row]));
  return visible.map(({ project, team, clientName, leadName }) => {
    const tally = byProject.get(project.id);
    return { ...project, teamKey: team.key, teamName: team.name, clientName, leadName, openTasks: tally?.open ?? 0, doneTasks: tally?.done ?? 0, overdueTasks: tally?.overdue ?? 0 };
  });
}

export type ProjectInput = {
  teamId: string;
  name: string;
  description: string | null;
  clientId: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  leadPersonId: string | null;
  startDate: string | null;
  dueDate: string | null;
};

async function checkProjectInput(tx: Executor, input: ProjectInput): Promise<void> {
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ActionError("project_dates_invalid");
  if (input.clientId) {
    const [client] = await tx.select({ id: schema.workClient.id }).from(schema.workClient).where(eq(schema.workClient.id, input.clientId)).limit(1);
    if (!client) throw new ActionError("client_not_found");
  }
  if (input.leadPersonId) {
    const [lead] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.leadPersonId)).limit(1);
    if (!lead || lead.status === "offboarded") throw new ActionError("person_not_found");
  }
}

/** The creator and the named lead become members, so a private project is never out of everyone's reach. */
export async function createProject(input: ProjectInput, actorPersonId: string): Promise<ProjectRow> {
  return db().transaction(async (tx) => {
    const [team] = await tx.select().from(schema.workTeam).where(eq(schema.workTeam.id, input.teamId)).limit(1);
    if (!team || !team.isActive) throw new ActionError("team_not_found");
    await checkProjectInput(tx, input);
    const leadPersonId = input.leadPersonId ?? actorPersonId;
    const [project] = await tx.insert(schema.workProject).values({ ...input, leadPersonId, entityId: team.entityId, createdByPersonId: actorPersonId }).returning();
    const members = new Map<string, TeamRole>([[actorPersonId, "member"], [leadPersonId, "lead"]]);
    await tx.insert(schema.workProjectMember).values([...members].map(([personId, role]) => ({ projectId: project.id, personId, role })));
    return project;
  });
}

/** The team stays: task numbers and workflow states belong to it. */
export async function updateProject(projectId: string, input: Omit<ProjectInput, "teamId">): Promise<{ before: ProjectRow; after: ProjectRow }> {
  return db().transaction(async (tx) => {
    const found = await findProject(projectId, tx);
    if (!found) throw new ActionError("project_not_found");
    await checkProjectInput(tx, { ...input, teamId: found.project.teamId });
    const [after] = await tx.update(schema.workProject).set({ ...input, updatedAt: new Date() }).where(eq(schema.workProject.id, projectId)).returning();
    if (input.leadPersonId && input.leadPersonId !== found.project.leadPersonId) {
      await tx.insert(schema.workProjectMember).values({ projectId, personId: input.leadPersonId, role: "lead" }).onConflictDoUpdate({ target: [schema.workProjectMember.projectId, schema.workProjectMember.personId], set: { role: "lead" } });
    }
    return { before: found.project, after };
  });
}

export type ProjectMemberView = { personId: string; fullName: string; role: TeamRole; workforceType: string };

export async function listProjectMembers(projectId: string): Promise<ProjectMemberView[]> {
  const rows = await db()
    .select({ personId: schema.person.id, fullName: schema.person.fullName, role: schema.workProjectMember.role, workforceType: schema.person.workforceType })
    .from(schema.workProjectMember)
    .innerJoin(schema.person, eq(schema.person.id, schema.workProjectMember.personId))
    .where(eq(schema.workProjectMember.projectId, projectId))
    .orderBy(asc(schema.workProjectMember.role), asc(schema.person.searchName));
  return rows.map((row) => ({ ...row, role: row.role as TeamRole }));
}

/** `role` null removes the person. A private project keeps at least one lead among its members or its team. */
export async function setProjectMember(projectId: string, personId: string, role: TeamRole | null): Promise<{ before: TeamRole | null; after: TeamRole | null }> {
  return db().transaction(async (tx) => {
    const members = await tx.select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, projectId));
    const current = members.find((member) => member.personId === personId);
    const before = (current?.role as TeamRole | undefined) ?? null;
    if (role === null) {
      if (members.length === 1 && current) throw new ActionError("project_last_member");
      if (current) await tx.delete(schema.workProjectMember).where(eq(schema.workProjectMember.id, current.id));
    } else if (current) {
      await tx.update(schema.workProjectMember).set({ role }).where(eq(schema.workProjectMember.id, current.id));
    } else {
      const [person] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
      if (!person || person.status === "offboarded") throw new ActionError("person_not_found");
      await tx.insert(schema.workProjectMember).values({ projectId, personId, role });
    }
    return { before, after: role };
  });
}

export type CreateTargets = { teams: { id: string; key: string; name: string; defaultVisibility: string; canFileInBacklog: boolean; canCreateProject: boolean }[]; projects: { id: string; teamId: string; name: string }[] };

/** Where may this viewer file a new task (quick-create) or start a project? */
export async function listCreateTargets(viewer: WorkViewer): Promise<CreateTargets> {
  const [teams, projects] = await Promise.all([
    db().select().from(schema.workTeam).where(eq(schema.workTeam.isActive, true)).orderBy(asc(schema.workTeam.name)),
    db().select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(and(inArray(schema.workProject.status, ["planned", "active", "paused"]), eq(schema.workTeam.isActive, true))).orderBy(asc(schema.workProject.name)),
  ]);
  const open = projects.filter((row) => canContributeToProject(viewer, projectFacts(row.project, row.team))).map((row) => ({ id: row.project.id, teamId: row.project.teamId, name: row.project.name }));
  const listed = teams
    .map((team) => ({ id: team.id, key: team.key, name: team.name, defaultVisibility: team.defaultVisibility, canFileInBacklog: canContributeToTeam(viewer, teamFacts(team)), canCreateProject: canCreateProject(viewer, teamFacts(team)) }))
    .filter((team) => team.canFileInBacklog || team.canCreateProject || open.some((project) => project.teamId === team.id));
  return { teams: listed, projects: open };
}

/** Who a task here can be given to: the team and the project's members — not the whole directory. */
export async function listAssignable(teamId: string, projectId: string | null): Promise<{ id: string; fullName: string }[]> {
  const [team, project] = await Promise.all([
    db().select({ id: schema.person.id, fullName: schema.person.fullName, searchName: schema.person.searchName, status: schema.person.status }).from(schema.workTeamMember).innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId)).where(eq(schema.workTeamMember.teamId, teamId)),
    projectId ? db().select({ id: schema.person.id, fullName: schema.person.fullName, searchName: schema.person.searchName, status: schema.person.status }).from(schema.workProjectMember).innerJoin(schema.person, eq(schema.person.id, schema.workProjectMember.personId)).where(eq(schema.workProjectMember.projectId, projectId)) : [],
  ]);
  const byId = new Map([...team, ...project].filter((person) => person.status !== "offboarded").map((person) => [person.id, person]));
  return [...byId.values()].sort((a, b) => a.searchName.localeCompare(b.searchName)).map(({ id, fullName }) => ({ id, fullName }));
}
