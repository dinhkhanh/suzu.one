// Files on a task (FR-WRK-02), kept by the platform files module: the browser uploads straight to
// private storage through a signed URL, and every download link is made for one minute on click,
// after the work policy has said the viewer may see the task.
import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, listFilesOf, softDeleteFile, type StoredFileRow } from "../platform/files/service";
import { notifyFollowers } from "./followers";
import { type LoadedTask, loadTask, logActivity } from "./tasks";

export const TASK_FILE_OWNER = "work_task";
type Actor = { personId: string; email?: string | null };

export type TaskFileView = { id: string; fileName: string; sizeBytes: number; contentType: string; uploadedByPersonId: string | null; uploadedByName: string | null; createdAt: Date };

export async function listTaskFiles(taskId: string): Promise<TaskFileView[]> {
  const files = await listFilesOf(TASK_FILE_OWNER, taskId);
  const uploaderIds = [...new Set(files.map((file) => file.uploadedByPersonId).filter((id): id is string => !!id))];
  const people = uploaderIds.length ? await db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, uploaderIds)) : [];
  return files.map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, contentType: file.contentType, uploadedByPersonId: file.uploadedByPersonId, uploadedByName: people.find((person) => person.id === file.uploadedByPersonId)?.name ?? null, createdAt: file.createdAt }));
}

/** Task files carry no personal data by themselves: the work policy, not a sensitivity tier, decides who opens them. */
export const beginTaskUpload = (loaded: LoadedTask, file: { fileName: string; sizeBytes: number }, actor: Actor) => beginUpload({ ownerType: TASK_FILE_OWNER, ownerId: loaded.task.id, entityId: loaded.task.entityId, tier: "public_internal" }, file, actor);

/** A task file with its task; `pending` looks at an upload that is still to be confirmed. */
export async function findTaskFile(fileId: string, options: { pending?: boolean } = {}): Promise<{ file: StoredFileRow; loaded: LoadedTask } | undefined> {
  const file = options.pending ? (await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "pending"))).limit(1))[0] : await findFile(fileId);
  if (!file || file.ownerType !== TASK_FILE_OWNER) return undefined;
  const loaded = await loadTask(file.ownerId);
  return loaded ? { file, loaded } : undefined;
}

export async function completeTaskUpload(fileId: string, actor: Actor & { fullName: string }): Promise<StoredFileRow> {
  const found = await findTaskFile(fileId, { pending: true });
  if (!found) throw new ActionError("file_not_found");
  const file = await completeUpload(fileId, actor);
  await db().transaction(async (tx) => {
    await logActivity(tx, found.loaded.task.id, actor.personId, [{ type: "attachment_added", to: { id: file.id, name: file.fileName } }]);
    await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, found.loaded.task.id));
    await notifyFollowers(tx, found.loaded, actor.personId, "tasks.commented", { name: actor.fullName, excerpt: `📎 ${file.fileName}` });
  });
  return file;
}

export const taskFileLink = (file: StoredFileRow, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }) => createDownloadLink(file, actor, request);

export async function removeTaskFile(fileId: string, actorPersonId: string): Promise<StoredFileRow> {
  // A version the client approved is frozen with its file (FR-PJM-51), and the evidence of a client
  // decision is the record of it: neither may go.
  const [frozen] = await db().select({ id: schema.workDeliverable.id }).from(schema.workDeliverable).where(and(eq(schema.workDeliverable.fileId, fileId), isNotNull(schema.workDeliverable.frozenAt))).limit(1);
  if (frozen) throw new ActionError("deliverable_frozen");
  const [evidence] = await db().select({ id: schema.workDeliverableDecision.id }).from(schema.workDeliverableDecision).where(sql`${schema.workDeliverableDecision.client} ->> 'evidenceFileId' = ${fileId}`).limit(1);
  if (evidence) throw new ActionError("client_evidence_locked");
  const file = await softDeleteFile(fileId);
  if (!file) throw new ActionError("file_not_found");
  await logActivity(db(), file.ownerId, actorPersonId, [{ type: "attachment_removed", from: { id: file.id, name: file.fileName } }]);
  return file;
}
