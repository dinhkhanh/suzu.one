// Saved list filters (FR-WRK-05): a name for a set of URL parameters — personal, or shared with
// everyone who can open the list it was saved on: a project's tasks, or a team's backlog (a view
// with no project). Every view names its team.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import type { SavedViewFilters } from "./schema";

export type SavedViewRow = typeof schema.workSavedView.$inferSelect;
/** The list a view belongs to: a project's, or the backlog of a team. */
export type SavedViewScope = { projectId: string } | { teamId: string };

const MAX_VIEWS_PER_LIST = 30;
const inScope = (scope: SavedViewScope) => ("projectId" in scope ? eq(schema.workSavedView.projectId, scope.projectId) : and(eq(schema.workSavedView.teamId, scope.teamId), isNull(schema.workSavedView.projectId)));

// Two entries in the shared cache: a person's own views (personal tier, one key each, every list
// they saved one on) and every shared view (one key for the lot — anybody's shared view shows on
// everybody's list). Each writer below drops its owner's entry, and the shared one when the view
// was or is shared. A project or team deleted with its views is bounded by the short TTL.
const ownViewsKey = (personId: string) => `work:views:${personId}`;
const SHARED_VIEWS_KEY = "work:views:shared";
const byName = (a: SavedViewRow, b: SavedViewRow) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);
const inList = (scope: SavedViewScope) => (view: SavedViewRow) => ("projectId" in scope ? view.projectId === scope.projectId : view.teamId === scope.teamId && view.projectId === null);

/** Drops the cached views a write touched: the owner's, and the shared ones if it was or is shared. */
function invalidateViews(...views: SavedViewRow[]): Promise<void> {
  return invalidate(...new Set(views.flatMap((view) => [ownViewsKey(view.ownerPersonId), ...(view.isShared ? [SHARED_VIEWS_KEY] : [])])));
}

/** The viewer's own views of a list, and the shared ones. The caller has checked they may open the list. */
export async function listSavedViews(scope: SavedViewScope, personId: string): Promise<SavedViewRow[]> {
  const read = (where: ReturnType<typeof eq>) => db().select().from(schema.workSavedView).where(where).orderBy(asc(schema.workSavedView.name), asc(schema.workSavedView.id));
  const [own, shared] = await Promise.all([cached(ownViewsKey(personId), TTL.personal, () => read(eq(schema.workSavedView.ownerPersonId, personId))), cached(SHARED_VIEWS_KEY, TTL.personal, () => read(eq(schema.workSavedView.isShared, true)))]);
  const wanted = inList(scope);
  const seen = new Set<string>();
  return [...own, ...shared].filter((view) => wanted(view) && !seen.has(view.id) && !!seen.add(view.id)).sort(byName);
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
  await invalidateViews(row);
  return row;
}

/** Renames a view, replaces its filters, or shares / unshares it; what is not given stays. */
export async function updateSavedView(viewId: string, patch: { name?: string; filters?: SavedViewFilters; isShared?: boolean }): Promise<{ before: SavedViewRow; after: SavedViewRow }> {
  const before = await findSavedView(viewId);
  if (!before) throw new ActionError("view_not_found");
  const [after] = await db().update(schema.workSavedView).set(patch).where(eq(schema.workSavedView.id, viewId)).returning();
  await invalidateViews(before, after);
  return { before, after };
}

export async function deleteSavedView(viewId: string): Promise<SavedViewRow> {
  const [row] = await db().delete(schema.workSavedView).where(eq(schema.workSavedView.id, viewId)).returning();
  if (!row) throw new ActionError("view_not_found");
  await invalidateViews(row);
  return row;
}
