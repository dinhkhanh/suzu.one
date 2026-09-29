import "server-only";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, findFile, readPublicInternalFile, softDeleteFile, type StoredFileRow } from "@/modules/platform/files/service";
import { PHOTO_OWNER_TYPE } from "@/modules/platform/files/rules";
import { findPersonById, setPersonPhoto } from "@/modules/platform/people/service";

// A person's profile picture (FR-CHR-01). The bytes are a stored file of owner type `person_photo`
// at the directory tier; `person.photo_file_id` says which one is up. A replaced or removed
// picture is soft-deleted, so only the current one is ever served. Who may change or see it is
// `canChangePhoto` / `canSeePhoto` in ./policy.

type Actor = { personId: string; email?: string | null };

export function beginPhotoUpload(person: { personId: string; entityId: string | null }, file: { fileName: string; sizeBytes: number }, actor: Actor) {
  return beginUpload({ ownerType: PHOTO_OWNER_TYPE, ownerId: person.personId, entityId: person.entityId, tier: "public_internal" }, file, actor);
}

/** Is this an upload the actor began for this person's picture and has not finished? */
export async function isPendingPhoto(fileId: string, personId: string, actorPersonId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(
      and(
        eq(schema.storedFile.id, fileId),
        eq(schema.storedFile.ownerType, PHOTO_OWNER_TYPE),
        eq(schema.storedFile.ownerId, personId),
        eq(schema.storedFile.uploadedByPersonId, actorPersonId),
        eq(schema.storedFile.status, "pending"),
      ),
    )
    .limit(1);
  return !!row;
}

/** Checks what arrived and puts it up in place of the old picture. */
export async function completePhotoUpload(personId: string, fileId: string, actor: Actor): Promise<StoredFileRow> {
  const file = await completeUpload(fileId, actor);
  const set = await setPersonPhoto(personId, file.id);
  if (!set) throw new ActionError("person_not_found");
  if (set.previousFileId && set.previousFileId !== file.id) await softDeleteFile(set.previousFileId);
  return file;
}

/** Takes the picture down; returns the file that was up, if any. */
export async function removePhoto(personId: string): Promise<string | null> {
  const set = await setPersonPhoto(personId, null);
  if (set?.previousFileId) await softDeleteFile(set.previousFileId);
  return set?.previousFileId ?? null;
}

/**
 * The picture a person has up now, when `fileId` is it — an old address, of a picture since
 * replaced, finds nothing. The caller decides whether the viewer may see it (`canSeePhoto`).
 */
export async function findCurrentPhoto(personId: string, fileId: string): Promise<{ file: StoredFileRow; status: string } | null> {
  const person = await findPersonById(personId);
  if (!person || person.photoFileId !== fileId) return null;
  const file = await findFile(fileId);
  if (!file || file.ownerType !== PHOTO_OWNER_TYPE || file.ownerId !== personId) return null;
  return { file, status: person.status };
}

export const readPhoto = (file: StoredFileRow) => readPublicInternalFile(file);
