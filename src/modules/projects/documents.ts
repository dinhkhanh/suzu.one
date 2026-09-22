// A project's documents (FR-PJM-31): one space on the knowledge-base engine — briefs, scripts,
// shot lists, meeting notes — opened to the project's people and nobody else, and one list of all
// its files (the FR-KB-15 query). Made when someone first asks for it on the Documents tab, not
// for every project up front: most internal projects never need one.
//
// Who reads it is the knowledge base's policy, through a single access row `project:<id>` at
// level edit (see `kb/access-sql.ts`): the project's members in any role, its lead and the leads
// of its owning team, resolved when the row is read — so joining or leaving the project changes
// what a person sees without anyone touching the space. The space belongs to the project's entity,
// whose knowledge-base managers administer it like any other space of the entity.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { createPage, createSpace, type KbViewer, listSpaceFiles, listTree, type LoadedSpace, loadSpace, projectStarters, spaceLevel, type KbLevel, type SpaceFileView, type TreeNode } from "../kb/service";

/** The space key of a project: fixed by the project's id, so it can never be made twice. */
export const projectSpaceKey = (projectId: string): string => `prj-${projectId.replace(/-/g, "").toLowerCase()}`;

/** The one access row of a project space. */
export const projectAudience = (projectId: string) => ({ subjectKey: `project:${projectId}`, level: "edit" as const });

/**
 * Makes the project's space with its starter pages (drafts, for the team to fill) and links it
 * to the plan — once, under the plan's lock: a second request finds the link and gets the same space.
 */
export async function ensureProjectSpace(projectId: string, actorPersonId: string): Promise<{ spaceId: string; created: boolean; pages: number }> {
  const starters = await projectStarters();
  return db().transaction(async (tx) => {
    const [plan] = await tx.select({ kbSpaceId: schema.projectPlan.kbSpaceId, jobNumber: schema.projectPlan.jobNumber }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1).for("update");
    if (!plan) throw new ActionError("project_not_found");
    if (plan.kbSpaceId) return { spaceId: plan.kbSpaceId, created: false, pages: 0 };
    const [project] = await tx.select({ name: schema.workProject.name, entityId: schema.workProject.entityId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
    if (!project) throw new ActionError("project_not_found");
    const name = [plan.jobNumber, project.name].filter(Boolean).join(" · ").slice(0, 120);
    const space = await createSpace({ key: projectSpaceKey(projectId), name, description: null, icon: "📁", entityId: project.entityId, ownerProjectId: projectId, kind: "open", sortOrder: 1000 }, actorPersonId, [projectAudience(projectId)], tx);
    for (const starter of starters) await createPage({ spaceId: space.id, parentId: null, title: starter.name, content: starter.content }, { personId: actorPersonId }, tx);
    await tx.update(schema.projectPlan).set({ kbSpaceId: space.id, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    return { spaceId: space.id, created: true, pages: starters.length };
  });
}

export type ProjectDocuments = { space: LoadedSpace["space"]; level: KbLevel | null; tree: TreeNode[]; files: SpaceFileView[] };

/**
 * The Documents tab: the space's pages and every file on them, as far as the knowledge base lets
 * this viewer see (filtered in SQL, as in the space's own page). null = no space yet, or one the
 * viewer may not open (a project reader who is not one of its people).
 */
export async function getProjectDocuments(viewer: KbViewer, spaceId: string | null): Promise<ProjectDocuments | null> {
  if (!spaceId) return null;
  const loaded = await loadSpace({ id: spaceId });
  if (!loaded) return null;
  const level = spaceLevel(viewer, loaded.facts);
  if (!level) return null;
  const [tree, files] = await Promise.all([listTree(viewer, loaded), listSpaceFiles(viewer, spaceId)]);
  return { space: loaded.space, level, tree, files };
}
