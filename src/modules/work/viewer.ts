// The viewer as the work policy wants them: the principal plus their team and project memberships.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import type { Principal } from "../platform/rbac/policy";
import { loadGrantsOfPeople } from "../platform/rbac/service";
import type { ProjectRole, TeamRole } from "./enums";
import type { WorkViewer } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
// The signed-in user (`CurrentUser`) satisfies this, so a page hands the whole user over and the
// viewer carries who they are to the audit log (`WorkViewer.reader`) as well as what they may do.
export type ViewerSource = { person: { id: string; primaryEntityId: string | null }; principal: Principal; userId?: string | null; email?: string | null; request?: { ipAddress?: string | null; userAgent?: string | null } };

// A person's team and project memberships are read by every work, project and daily page, so
// they sit in the shared cache (personal tier), one entry per person. Every writer of
// `work_team_member` and `work_project_member` calls `invalidateMemberships` with the people it
// touched; a transaction reads its own rows.
const membershipsKey = (personId: string) => `work:memberships:${personId}`;
type Memberships = { teams: { id: string; role: string }[]; projects: { id: string; role: string }[] };

async function readMemberships(executor: Executor, personId: string): Promise<Memberships> {
  const [teams, projects] = await Promise.all([
    executor.select({ id: schema.workTeamMember.teamId, role: schema.workTeamMember.role }).from(schema.workTeamMember).where(eq(schema.workTeamMember.personId, personId)).orderBy(schema.workTeamMember.teamId),
    executor.select({ id: schema.workProjectMember.projectId, role: schema.workProjectMember.role }).from(schema.workProjectMember).where(eq(schema.workProjectMember.personId, personId)).orderBy(schema.workProjectMember.projectId),
  ]);
  return { teams, projects };
}

/** After a write to `work_team_member` or `work_project_member` (inside the transaction is fine). */
export const invalidateMemberships = (...personIds: readonly string[]) => invalidate(...[...new Set(personIds)].map(membershipsKey));

export async function loadViewerWith(executor: Executor, user: ViewerSource): Promise<WorkViewer> {
  const { teams, projects } = executor === db() ? await cached(membershipsKey(user.person.id), TTL.personal, () => readMemberships(executor, user.person.id)) : await readMemberships(executor, user.person.id);
  return {
    principal: user.principal,
    entityId: user.person.primaryEntityId,
    teamRoles: new Map(teams.map((row) => [row.id, row.role as TeamRole])),
    projectRoles: new Map(projects.map((row) => [row.id, row.role as ProjectRole])),
    reader: { userId: user.userId ?? null, email: user.email ?? null, request: user.request },
  };
}

// Once per request: `getCurrentUser` is cached, so pages, components and an action's authorize
// step pass the same object and share one answer.
export const loadViewer = cache((user: ViewerSource): Promise<WorkViewer> => loadViewerWith(db(), user));

/**
 * Somebody else as the policy sees them — to decide whether a mention may reach them, or whether
 * a follower still belongs on a task. null = unknown or gone.
 */
export async function viewerOfPerson(executor: Executor, personId: string): Promise<WorkViewer | null> {
  return (await viewersOfPeople(personId ? [personId] : [], executor)).get(personId) ?? null;
}

/**
 * `viewerOfPerson` for many people at once, in a fixed number of queries however many they are.
 * People unknown or gone are left out of the map. Inside a transaction pass the executor, and
 * everything is read there.
 */
export async function viewersOfPeople(personIds: readonly string[], executor?: Executor): Promise<Map<string, WorkViewer>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, WorkViewer>();
  if (ids.length === 0) return result;
  const from = executor ?? db();
  const [people, teams, projects] = await Promise.all([
    from.select({ id: schema.person.id, primaryEntityId: schema.person.primaryEntityId, workforceType: schema.person.workforceType, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, ids)),
    from.select({ personId: schema.workTeamMember.personId, id: schema.workTeamMember.teamId, role: schema.workTeamMember.role }).from(schema.workTeamMember).where(inArray(schema.workTeamMember.personId, ids)),
    from.select({ personId: schema.workProjectMember.personId, id: schema.workProjectMember.projectId, role: schema.workProjectMember.role }).from(schema.workProjectMember).where(inArray(schema.workProjectMember.personId, ids)),
  ]);
  const present = people.filter((person) => person.status !== "offboarded");
  // One pass over the grants for all of them: an automation naming a dozen people must not cost a
  // round trip each, and inside a transaction that would be a dozen queries.
  const grants = await loadGrantsOfPeople(present.map((person) => person.id), undefined, executor);
  const teamsOf = Map.groupBy(teams, (row) => row.personId);
  const projectsOf = Map.groupBy(projects, (row) => row.personId);
  present.forEach((person) => {
    result.set(person.id, {
      principal: { personId: person.id, workforceType: person.workforceType, grants: grants.get(person.id) ?? [] },
      entityId: person.primaryEntityId,
      teamRoles: new Map((teamsOf.get(person.id) ?? []).map((row) => [row.id, row.role as TeamRole])),
      projectRoles: new Map((projectsOf.get(person.id) ?? []).map((row) => [row.id, row.role as ProjectRole])),
    });
  });
  return result;
}
