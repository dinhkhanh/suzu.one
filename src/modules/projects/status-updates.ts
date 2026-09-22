// Project status updates (FR-PJM-27): the lead's judgement — health, summary, highlights, next
// steps — over facts prefilled from the record. The latest health is kept on the plan so the
// portfolio reads one row per project; the history stays in `project_status_update`.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { Health } from "./engine/status";
import { loadStatusFacts } from "./metrics";
import { ensurePlan } from "./plans";

export type StatusUpdateRow = typeof schema.projectStatusUpdate.$inferSelect;
export type StatusUpdateInput = { health: Health; summary: string; highlights: string | null; nextSteps: string | null };

/**
 * Who hears about a project: its members and roles, and the leads of the owning team — the people
 * who follow its work. `except` leaves the author out.
 */
export async function projectFollowers(projectId: string, except: string | null): Promise<string[]> {
  const [project] = await db().select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project) return [];
  const [members, leads] = await Promise.all([
    db().select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), inArray(schema.workProjectMember.role, ["lead", "account_manager", "member"]))),
    db().select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, project.teamId), eq(schema.workTeamMember.role, "lead"))),
  ]);
  return [...new Set([...members, ...leads].map((row) => row.personId))].filter((id) => id !== except);
}

export async function postStatusUpdate(projectId: string, input: StatusUpdateInput, author: { personId: string; fullName: string }): Promise<StatusUpdateRow> {
  const plan = await ensurePlan(projectId);
  // The facts are taken now, on the server: what was true when the lead posted, not what the form showed.
  const facts = await loadStatusFacts(projectId, plan, todayInVietnam());
  const [project] = await db().select({ name: schema.workProject.name }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  const followers = await projectFollowers(projectId, author.personId);
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(schema.projectStatusUpdate).values({ projectId, ...input, facts, authorPersonId: author.personId }).returning();
    await tx.update(schema.projectPlan).set({ health: input.health, healthUpdatedAt: row.createdAt, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    await notify({ recipients: followers, kind: "projects.status_posted", params: { actor: author.fullName, project: project?.name ?? "" }, link: `/projects/${projectId}/updates` }, tx);
    return row;
  });
}

export type StatusUpdateView = StatusUpdateRow & { authorName: string | null };

/** Newest first. The caller has checked the viewer may read the plan; the facts hold hours, never money. */
export async function listStatusUpdates(projectId: string, limit = 50): Promise<StatusUpdateView[]> {
  return db()
    .select({ update: schema.projectStatusUpdate, authorName: schema.person.fullName })
    .from(schema.projectStatusUpdate)
    .leftJoin(schema.person, eq(schema.person.id, schema.projectStatusUpdate.authorPersonId))
    .where(eq(schema.projectStatusUpdate.projectId, projectId))
    .orderBy(desc(schema.projectStatusUpdate.createdAt))
    .limit(limit)
    .then((rows) => rows.map(({ update, authorName }) => ({ ...update, authorName })));
}
