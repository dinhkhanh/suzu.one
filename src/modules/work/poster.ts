// A project's poster (its key visual), shown beside its name. The bytes are a stored file of owner
// type `work_project_poster` at the directory tier, served by the app to whoever may open the
// project (`/api/work/projects/[id]/poster/[fileId]`); `work_project.poster_file_id` says which one
// is up. A replaced or removed poster is soft-deleted, so only the current one is ever served. Who
// may change it is `canManageProject`.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, findFile, readPublicInternalFile, softDeleteFile, type StoredFileRow } from "@/modules/platform/files/service";
import { POSTER_OWNER_TYPE } from "@/modules/platform/files/rules";
import { invalidateWorkDirectory } from "./directory";
import { findProject } from "./projects";

type Actor = { personId: string; email?: string | null };

export function beginPosterUpload(project: { id: string; entityId: string | null }, file: { fileName: string; sizeBytes: number }, actor: Actor) {
  return beginUpload({ ownerType: POSTER_OWNER_TYPE, ownerId: project.id, entityId: project.entityId, tier: "public_internal" }, file, actor);
}

/** Is this an upload the actor began for this project's poster and has not finished? */
export async function isPendingPoster(fileId: string, projectId: string, actorPersonId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.ownerType, POSTER_OWNER_TYPE), eq(schema.storedFile.ownerId, projectId), eq(schema.storedFile.uploadedByPersonId, actorPersonId), eq(schema.storedFile.status, "pending")))
    .limit(1);
  return !!row;
}

/** Puts the poster up (or takes it down, with null); returns the one that was up before. */
async function setPoster(projectId: string, fileId: string | null): Promise<string | null> {
  const previous = await db().transaction(async (tx) => {
    const [row] = await tx.select({ posterFileId: schema.workProject.posterFileId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).for("update").limit(1);
    if (!row) throw new ActionError("project_not_found");
    await tx.update(schema.workProject).set({ posterFileId: fileId, updatedAt: new Date() }).where(eq(schema.workProject.id, projectId));
    return row.posterFileId;
  });
  await invalidateWorkDirectory();
  if (previous && previous !== fileId) await softDeleteFile(previous);
  return previous;
}

/** Checks what arrived and puts it up in place of the old poster. */
export async function completePosterUpload(projectId: string, fileId: string, actor: Actor): Promise<StoredFileRow> {
  const file = await completeUpload(fileId, actor);
  await setPoster(projectId, file.id);
  return file;
}

export const removePoster = (projectId: string) => setPoster(projectId, null);

/**
 * The poster a project has up now, when `fileId` is it — an old address, of a poster since
 * replaced, finds nothing. The caller decides whether the viewer may open the project.
 */
export async function findCurrentPoster(projectId: string, fileId: string): Promise<{ file: StoredFileRow; found: NonNullable<Awaited<ReturnType<typeof findProject>>> } | null> {
  const found = await findProject(projectId);
  if (!found || found.project.posterFileId !== fileId) return null;
  const file = await findFile(fileId);
  if (!file || file.ownerType !== POSTER_OWNER_TYPE || file.ownerId !== projectId) return null;
  return { file, found };
}

export const readPoster = (file: StoredFileRow) => readPublicInternalFile(file);
