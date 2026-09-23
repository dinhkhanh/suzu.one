// Who a project's work may be given to: its own members and its team's — a private project's own
// members and the team's leads only — nobody who has left: the same people the work module's
// assignee picker offers (`listAssignable`). Asked here with the caller's executor, so a milestone
// owner, a line's assignee or an issue's task can be checked inside the very transaction that
// writes it, and ids that come from the browser are never taken on trust.
import "server-only";
import { and, eq, ne, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;

/** Is this person one of the project's people today? */
export async function isProjectPerson(executor: Executor, projectId: string, personId: string): Promise<boolean> {
  const [person] = await executor.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!person || person.status === "offboarded") return false;
  const [member] = await executor.select({ id: schema.workProjectMember.id }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), eq(schema.workProjectMember.personId, personId))).limit(1);
  if (member) return true;
  const [team] = await executor
    .select({ id: schema.workTeamMember.id })
    .from(schema.workTeamMember)
    .innerJoin(schema.workProject, eq(schema.workProject.teamId, schema.workTeamMember.teamId))
    // A private project's people are its members and the team's leads only (`listAssignable`).
    .where(and(eq(schema.workProject.id, projectId), eq(schema.workTeamMember.personId, personId), or(ne(schema.workProject.visibility, "private"), eq(schema.workTeamMember.role, "lead"))))
    .limit(1);
  return !!team;
}

/** The same, as a guard: nobody, or one of the project's people. */
export async function checkProjectPerson(executor: Executor, projectId: string, personId: string | null): Promise<void> {
  if (!personId) return;
  if (!(await isProjectPerson(executor, projectId, personId))) throw new ActionError("person_not_in_project");
}
