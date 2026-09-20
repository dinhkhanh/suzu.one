"use server";
// Attachments on a request form (FR-REQ-01). The file is uploaded *before* the request exists —
// the requester is still filling the form in — so it is owned by the person who uploaded it and
// the submission merely records its id. The same shape as attendance evidence.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getPersonTarget } from "@/modules/core-hr/service";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "@/modules/platform/files/service";
import { canFileRequests } from "./policy";
import { getGenericRequest } from "./service";

export const ATTACHMENT_OWNER_TYPE = "request_attachment";

const beginPipeline = createAction({
  name: "request.attachment.begin",
  input: z.object({ fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user) => canFileRequests(user.principal),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(user.person.id);
    // A request's own answers are personal, never more: nothing compensation-tier is attached here.
    const upload = await beginUpload({ ownerType: ATTACHMENT_OWNER_TYPE, ownerId: user.person.id, entityId: target?.entityId ?? null, tier: "personal" }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: target?.entityId ?? null }, summary: input.fileName } };
  },
});

export async function beginRequestAttachmentAction(input: unknown) {
  return beginPipeline(input);
}

const completePipeline = createAction({
  name: "request.attachment.complete",
  input: z.object({ fileId: z.uuid() }),
  // Only the pending upload this person started a moment ago.
  authorize: async (user, input) => {
    const [row] = await db()
      .select({ id: schema.storedFile.id })
      .from(schema.storedFile)
      .where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, ATTACHMENT_OWNER_TYPE), eq(schema.storedFile.ownerId, user.person.id), eq(schema.storedFile.status, "pending")))
      .limit(1);
    return !!row;
  },
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function completeRequestAttachmentAction(input: unknown) {
  return completePipeline(input);
}

const openPipeline = createAction({
  name: "request.attachment.open",
  input: z.object({ requestId: z.uuid(), fileId: z.uuid() }),
  // The file opens for whoever may open the request it is attached to — never on the file id alone.
  authorize: async (user, input) => {
    const view = await getGenericRequest({ personId: user.person.id, principal: user.principal }, input.requestId);
    return !!view && (view.submission.attachmentFileIds ?? []).includes(input.fileId);
  },
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.deletedAt || file.ownerType !== ATTACHMENT_OWNER_TYPE) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function openRequestAttachmentAction(input: unknown) {
  return openPipeline(input);
}
