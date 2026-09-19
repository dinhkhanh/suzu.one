// The viewer as the work policy wants them: the principal plus their team and project memberships.
import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema, type Tx } from "@/lib/db";
import type { Principal } from "../platform/rbac/policy";
import { loadGrants } from "../platform/rbac/service";
import type { TeamRole } from "./enums";
import type { WorkViewer } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type ViewerSource = { person: { id: string; primaryEntityId: string | null }; principal: Principal };

export async function loadViewerWith(executor: Executor, user: ViewerSource): Promise<WorkViewer> {
  const [teams, projects] = await Promise.all([
    executor.select({ id: schema.workTeamMember.teamId, role: schema.workTeamMember.role }).from(schema.workTeamMember).where(eq(schema.workTeamMember.personId, user.person.id)),
    executor.select({ id: schema.workProjectMember.projectId, role: schema.workProjectMember.role }).from(schema.workProjectMember).where(eq(schema.workProjectMember.personId, user.person.id)),
  ]);
  return {
    principal: user.principal,
    entityId: user.person.primaryEntityId,
    teamRoles: new Map(teams.map((row) => [row.id, row.role as TeamRole])),
    projectRoles: new Map(projects.map((row) => [row.id, row.role as TeamRole])),
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
  const [person] = await executor.select({ id: schema.person.id, primaryEntityId: schema.person.primaryEntityId, workforceType: schema.person.workforceType, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!person || person.status === "offboarded") return null;
  return loadViewerWith(executor, { person, principal: { personId: person.id, workforceType: person.workforceType, grants: await loadGrants(person.id, undefined, executor) } });
}
