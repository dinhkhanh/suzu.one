"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { completePhotoUpload, beginPhotoUpload, isPendingPhoto, removePhoto } from "./photo";
import { canChangePhoto } from "./policy";
import { getPersonTarget } from "./service";

// The profile picture (FR-CHR-01): the browser crops and shrinks it, then uploads it straight to
// storage through a signed URL (`uploadThroughSignedUrl`). Every screen shows it, sidebar included.

const mayChange = async (principal: Parameters<typeof canChangePhoto>[0], personId: string) => canChangePhoto(principal, await getPersonTarget(personId));

const beginPipeline = createAction({
  name: "person.photo.begin",
  input: z.object({ personId: z.uuid(), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => mayChange(user.principal, input.personId),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(input.personId);
    const entityId = target?.entityId ?? null;
    const upload = await beginPhotoUpload({ personId: input.personId, entityId }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "file", id: upload.fileId, entityId }, summary: `profile picture: ${input.fileName}` } };
  },
});
export async function beginPhotoUploadAction(input: unknown) {
  return beginPipeline(input);
}

const completePipeline = createAction({
  name: "person.photo.set",
  input: z.object({ personId: z.uuid(), fileId: z.uuid() }),
  // Only the upload this actor began for this person: nobody attaches a file meant for somebody else.
  authorize: async (user, input) => (await mayChange(user.principal, input.personId)) && isPendingPhoto(input.fileId, input.personId, user.person.id),
  run: async ({ user, input }) => {
    const file = await completePhotoUpload(input.personId, input.fileId, { personId: user.person.id, email: user.email });
    revalidatePath("/", "layout");
    return { data: { fileId: file.id }, audit: { resource: { type: "person", id: input.personId, entityId: file.entityId }, summary: "profile picture changed", after: { photoFileId: file.id } } };
  },
});
export async function completePhotoUploadAction(input: unknown) {
  return completePipeline(input);
}

const removePipeline = createAction({
  name: "person.photo.remove",
  input: z.object({ personId: z.uuid() }),
  authorize: (user, input) => mayChange(user.principal, input.personId),
  run: async ({ input }) => {
    const [target, previous] = await Promise.all([getPersonTarget(input.personId), removePhoto(input.personId)]);
    revalidatePath("/", "layout");
    return { data: { removed: !!previous }, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: "profile picture removed", before: { photoFileId: previous }, after: { photoFileId: null } } };
  },
});
export async function removePhotoAction(input: unknown) {
  return removePipeline(input);
}
