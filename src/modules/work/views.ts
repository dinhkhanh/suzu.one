// Saved list filters (FR-WRK-05): a name for a set of URL parameters — personal, or shared with
// everyone who can open the project.
import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { SavedViewFilters } from "./schema";

export type SavedViewRow = typeof schema.workSavedView.$inferSelect;

export async function listSavedViews(projectId: string, personId: string): Promise<SavedViewRow[]> {
  return db().select().from(schema.workSavedView).where(and(eq(schema.workSavedView.projectId, projectId), or(eq(schema.workSavedView.ownerPersonId, personId), eq(schema.workSavedView.isShared, true)))).orderBy(asc(schema.workSavedView.name));
}

export async function findSavedView(viewId: string): Promise<SavedViewRow | undefined> {
  const [row] = await db().select().from(schema.workSavedView).where(eq(schema.workSavedView.id, viewId)).limit(1);
  return row;
}

export async function createSavedView(input: { projectId: string; name: string; filters: SavedViewFilters; isShared: boolean }, ownerPersonId: string): Promise<SavedViewRow> {
  const mine = await db().select({ id: schema.workSavedView.id }).from(schema.workSavedView).where(and(eq(schema.workSavedView.projectId, input.projectId), eq(schema.workSavedView.ownerPersonId, ownerPersonId)));
  if (mine.length >= 30) throw new ActionError("view_limit");
  const [row] = await db().insert(schema.workSavedView).values({ ...input, ownerPersonId }).returning();
  return row;
}

export async function deleteSavedView(viewId: string): Promise<SavedViewRow> {
  const [row] = await db().delete(schema.workSavedView).where(eq(schema.workSavedView.id, viewId)).returning();
  if (!row) throw new ActionError("view_not_found");
  return row;
}
