// Saved list filters (FR-WRK-05): a name for a set of URL parameters — personal, or shared with
// everyone who can open the list it was saved on: a project's tasks, or a team's backlog (a view
// with no project). Every view names its team.
import "server-only";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { SavedViewFilters } from "./schema";

export type SavedViewRow = typeof schema.workSavedView.$inferSelect;
/** The list a view belongs to: a project's, or the backlog of a team. */
export type SavedViewScope = { projectId: string } | { teamId: string };

const MAX_VIEWS_PER_LIST = 30;
const inScope = (scope: SavedViewScope) => ("projectId" in scope ? eq(schema.workSavedView.projectId, scope.projectId) : and(eq(schema.workSavedView.teamId, scope.teamId), isNull(schema.workSavedView.projectId)));

/** The viewer's own views of a list, and the shared ones. The caller has checked they may open the list. */
export async function listSavedViews(scope: SavedViewScope, personId: string): Promise<SavedViewRow[]> {
  return db().select().from(schema.workSavedView).where(and(inScope(scope), or(eq(schema.workSavedView.ownerPersonId, personId), eq(schema.workSavedView.isShared, true)))).orderBy(asc(schema.workSavedView.name), asc(schema.workSavedView.id));
}

export async function findSavedView(viewId: string): Promise<SavedViewRow | undefined> {
  const [row] = await db().select().from(schema.workSavedView).where(eq(schema.workSavedView.id, viewId)).limit(1);
  return row;
}

/** `teamId` is the list's team — the project's own for a project's view; `projectId` null is the team's backlog. */
export async function createSavedView(input: { teamId: string; projectId: string | null; name: string; filters: SavedViewFilters; isShared: boolean }, ownerPersonId: string): Promise<SavedViewRow> {
  const scope: SavedViewScope = input.projectId ? { projectId: input.projectId } : { teamId: input.teamId };
  const mine = await db().select({ id: schema.workSavedView.id }).from(schema.workSavedView).where(and(inScope(scope), eq(schema.workSavedView.ownerPersonId, ownerPersonId)));
  if (mine.length >= MAX_VIEWS_PER_LIST) throw new ActionError("view_limit");
  const [row] = await db().insert(schema.workSavedView).values({ ...input, ownerPersonId }).returning();
  return row;
}

/** Renames a view, replaces its filters, or shares / unshares it; what is not given stays. */
export async function updateSavedView(viewId: string, patch: { name?: string; filters?: SavedViewFilters; isShared?: boolean }): Promise<{ before: SavedViewRow; after: SavedViewRow }> {
  const before = await findSavedView(viewId);
  if (!before) throw new ActionError("view_not_found");
  const [after] = await db().update(schema.workSavedView).set(patch).where(eq(schema.workSavedView.id, viewId)).returning();
  return { before, after };
}

export async function deleteSavedView(viewId: string): Promise<SavedViewRow> {
  const [row] = await db().delete(schema.workSavedView).where(eq(schema.workSavedView.id, viewId)).returning();
  if (!row) throw new ActionError("view_not_found");
  return row;
}
