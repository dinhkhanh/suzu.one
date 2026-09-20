import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { recordAudit } from "../audit/service";
import { type Tier, tierRank } from "../rbac/roles";
import { checkUpload, matchesSignature, MAX_FILE_BYTES } from "./rules";
import { createSignedDownloadUrl, createSignedUploadUrl, currentBucket, inspectObject, removeObject } from "./storage";

// This service checks *what* is uploaded. *Who* may upload to or open the files of a record is
// decided by the module that owns the record, before it calls in here (FR-PLT-32).

export type StoredFileRow = typeof schema.storedFile.$inferSelect;
export type FileOwner = { ownerType: string; ownerId: string; entityId: string | null; tier: Tier };
type Actor = { personId: string; email?: string | null };

const DOWNLOAD_LINK_SECONDS = 60;

/** Step 1 of an upload: checks the announcement and returns where the browser may PUT the bytes. */
export async function beginUpload(owner: FileOwner, file: { fileName: string; sizeBytes: number }, actor: Actor): Promise<{ fileId: string; uploadUrl: string; contentType: string }> {
  const checked = checkUpload(file);
  if (!checked.ok) throw new ActionError(checked.problem);

  const fileId = randomUUID();
  const extension = checked.fileName.split(".").pop()!.toLowerCase();
  // Nothing the uploader typed ends up in the path.
  const objectPath = `${owner.ownerType}/${new Date().getUTCFullYear()}/${fileId}.${extension}`;
  const uploadUrl = await createSignedUploadUrl(objectPath, MAX_FILE_BYTES);
  await db().insert(schema.storedFile).values({
    id: fileId,
    bucket: currentBucket(),
    objectPath,
    fileName: checked.fileName,
    contentType: checked.contentType,
    sizeBytes: file.sizeBytes,
    ...owner,
    uploadedByPersonId: actor.personId,
  });
  return { fileId, uploadUrl, contentType: checked.contentType };
}

/** Step 2: looks at what actually arrived. Bytes that are not what was announced are removed. */
export async function completeUpload(fileId: string, actor: Actor): Promise<StoredFileRow> {
  const [file] = await db()
    .select()
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.uploadedByPersonId, actor.personId), eq(schema.storedFile.status, "pending")))
    .limit(1);
  if (!file) throw new ActionError("file_not_found");

  const stored = await inspectObject(file.objectPath);
  if (!stored) throw new ActionError("file_not_uploaded");
  const problem = stored.sizeBytes > MAX_FILE_BYTES ? "file_too_large" : matchesSignature(file.fileName, stored.head) ? null : "file_content_mismatch";
  if (problem) {
    await removeObject(file.objectPath);
    await db().update(schema.storedFile).set({ status: "rejected" }).where(eq(schema.storedFile.id, fileId));
    throw new ActionError(problem);
  }
  const [ready] = await db().update(schema.storedFile).set({ status: "ready", sizeBytes: stored.sizeBytes }).where(eq(schema.storedFile.id, fileId)).returning();
  return ready;
}

export async function listFilesOf(ownerType: string, ownerId: string): Promise<StoredFileRow[]> {
  return db()
    .select()
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.ownerType, ownerType), eq(schema.storedFile.ownerId, ownerId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt)))
    .orderBy(asc(schema.storedFile.createdAt));
}

/** The names of a known set of files, for a screen that already decided the reader may see them. */
export async function listFileNames(fileIds: readonly string[]): Promise<Map<string, string>> {
  if (fileIds.length === 0) return new Map();
  const rows = await db()
    .select({ id: schema.storedFile.id, fileName: schema.storedFile.fileName })
    .from(schema.storedFile)
    .where(and(inArray(schema.storedFile.id, [...fileIds]), isNull(schema.storedFile.deletedAt)));
  return new Map(rows.map((row) => [row.id, row.fileName]));
}

export async function findFile(fileId: string): Promise<StoredFileRow | undefined> {
  const [file] = await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).limit(1);
  return file;
}

/** A one-minute download link. Opening a restricted or compensation file is written to the audit log. */
export async function createDownloadLink(file: StoredFileRow, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }): Promise<string> {
  const url = await createSignedDownloadUrl(file.objectPath, file.fileName, DOWNLOAD_LINK_SECONDS);
  if (tierRank(file.tier as Tier) >= tierRank("restricted")) {
    await recordAudit({ action: "file.read", actor: { personId: actor.personId, email: actor.email }, request, resource: { type: file.ownerType, id: file.ownerId, entityId: file.entityId }, summary: file.fileName });
  }
  return url;
}

/** Hides the file at once; the bytes go when the retention process purges them (DR-03). */
export async function softDeleteFile(fileId: string): Promise<StoredFileRow | undefined> {
  const [file] = await db().update(schema.storedFile).set({ deletedAt: new Date() }).where(and(eq(schema.storedFile.id, fileId), isNull(schema.storedFile.deletedAt))).returning();
  return file;
}

/** Uploads that were allowed but never finished: remove whatever arrived, a day later. */
export async function purgeAbandonedUploads(now: Date = new Date()): Promise<{ abandonedUploads: number }> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const abandoned = await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.status, "pending"), lt(schema.storedFile.createdAt, cutoff)));
  for (const file of abandoned) {
    await removeObject(file.objectPath);
    await db().update(schema.storedFile).set({ status: "rejected" }).where(eq(schema.storedFile.id, file.id));
  }
  return { abandonedUploads: abandoned.length };
}
