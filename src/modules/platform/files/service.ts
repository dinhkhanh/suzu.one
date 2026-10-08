import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { recordAudit } from "../audit/service";
import { type Tier, tierRank } from "../rbac/roles";
import { checkUpload, matchesSignature, MAX_FILE_BYTES, maxBytesFor } from "./rules";
import { createSignedDownloadUrl, createSignedUploadUrl, currentBucket, finalizeObject, inspectObject, putObject, readObject, removeObject } from "./storage";

// This service checks *what* is uploaded. *Who* may upload to or open the files of a record is
// decided by the module that owns the record, before it calls in here (FR-PLT-32).

export type StoredFileRow = typeof schema.storedFile.$inferSelect;
export type FileOwner = { ownerType: string; ownerId: string; entityId: string | null; tier: Tier };
type Actor = { personId: string; email?: string | null };

const DOWNLOAD_LINK_SECONDS = 60;

/** Step 1 of an upload: checks the announcement and returns where the browser may PUT the bytes. */
export async function beginUpload(owner: FileOwner, file: { fileName: string; sizeBytes: number }, actor: Actor): Promise<{ fileId: string; uploadUrl: string; contentType: string }> {
  const checked = checkUpload(file, owner.ownerType);
  if (!checked.ok) throw new ActionError(checked.problem);

  const fileId = randomUUID();
  const extension = checked.fileName.split(".").pop()!.toLowerCase();
  // Nothing the uploader typed ends up in the path.
  const objectPath = `${owner.ownerType}/${new Date().getUTCFullYear()}/${fileId}.${extension}`;
  const uploadUrl = await createSignedUploadUrl(objectPath, checked.contentType);
  await db()
    .insert(schema.storedFile)
    .values({
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
  // The cap and the types are the owner's (a work task takes video), as when the upload was begun.
  const problem = stored.sizeBytes > maxBytesFor(file.fileName, file.ownerType) ? "file_too_large" : matchesSignature(file.fileName, stored.head, file.ownerType) ? null : "file_content_mismatch";
  if (problem) {
    await removeObject(file.objectPath);
    await db().update(schema.storedFile).set({ status: "rejected" }).where(eq(schema.storedFile.id, fileId));
    throw new ActionError(problem);
  }
  // Only a checked file is given its download name (the object said nothing about it until now).
  await finalizeObject(file.objectPath, file.contentType, file.fileName);
  const [ready] = await db().update(schema.storedFile).set({ status: "ready", sizeBytes: stored.sizeBytes }).where(eq(schema.storedFile.id, fileId)).returning();
  return ready;
}

/**
 * The whole of an upload in one call, from bytes the server is already holding — the path the
 * public careers form takes (FR-REC-03). Two differences from `beginUpload`/`completeUpload`, and
 * both are deliberate:
 *
 *   · **no signed URL is ever minted.** A stranger is never given a capability to write into
 *     private storage; their file arrives inside the POST, is checked in memory, and is written by
 *     the server or not at all.
 *   · **`uploadedByPersonId` is null.** Nobody inside the company uploaded it. Who may open it is
 *     decided, as always, by the module that owns the record — here `recruit/policy.ts`, which
 *     keeps a candidate's CV to the people hiring for that opening.
 *
 * The same two checks run as on every other upload: the name decides the type (`checkUpload`) and
 * the **first bytes must match it** (`matchesSignature`), so a `.pdf` that is really a script is
 * refused before anything is written. The row is left `scan_status = not_scanned`, which is the
 * truth: this system has no virus scanner.
 */
export async function storeIncomingFile(owner: FileOwner, file: { fileName: string; bytes: Uint8Array }, options: { maxBytes?: number } = {}): Promise<StoredFileRow> {
  const limit = Math.min(options.maxBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
  const checked = checkUpload({ fileName: file.fileName, sizeBytes: file.bytes.byteLength });
  if (!checked.ok) throw new ActionError(checked.problem);
  if (file.bytes.byteLength > limit) throw new ActionError("file_too_large");
  if (!matchesSignature(checked.fileName, file.bytes.slice(0, 512))) throw new ActionError("file_content_mismatch");

  const fileId = randomUUID();
  const extension = checked.fileName.split(".").pop()!.toLowerCase();
  // Nothing the uploader typed ends up in the path.
  const objectPath = `${owner.ownerType}/${new Date().getUTCFullYear()}/${fileId}.${extension}`;
  await putObject(objectPath, file.bytes, checked.contentType, checked.fileName);
  const [row] = await db()
    .insert(schema.storedFile)
    .values({
      id: fileId,
      bucket: currentBucket(),
      objectPath,
      fileName: checked.fileName,
      contentType: checked.contentType,
      sizeBytes: file.bytes.byteLength,
      ...owner,
      status: "ready",
      uploadedByPersonId: null,
    })
    .returning();
  return row;
}

/** Attaches a file that was stored before its owner record existed (the public form uploads, then applies). */
export async function reownFile(fileId: string, owner: Pick<FileOwner, "ownerId" | "entityId">): Promise<void> {
  await db().update(schema.storedFile).set({ ownerId: owner.ownerId, entityId: owner.entityId }).where(eq(schema.storedFile.id, fileId));
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
  const [file] = await db()
    .select()
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt)))
    .limit(1);
  return file;
}

/** A one-minute download link. Opening a restricted or compensation file is written to the audit log. */
export async function createDownloadLink(file: StoredFileRow, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }): Promise<string> {
  const url = await createSignedDownloadUrl(file.objectPath, DOWNLOAD_LINK_SECONDS);
  if (tierRank(file.tier as Tier) >= tierRank("restricted")) {
    await recordAudit({ action: "file.read", actor: { personId: actor.personId, email: actor.email }, request, resource: { type: file.ownerType, id: file.ownerId, entityId: file.entityId }, summary: file.fileName });
  }
  return url;
}

/** The longest a link handed to somebody outside the company may live, whatever the caller asks for. */
const MAX_VISITOR_LINK_SECONDS = 60 * 60;

/**
 * Who opened a file when nobody inside the company did: somebody holding a credential of their own
 * — a client on a review link (D24). `via` names the kind of credential, `id` the record of it
 * (never the credential itself), and `visitorKey` is the hashed visitor the public surface already
 * counts and audits under, never an address.
 */
export type VisitorReader = { via: string; id: string; visitorKey: string };

/**
 * A download link for a visitor. The owning module has already decided this visitor may have this
 * file; what this adds is an honest audit entry. A restricted or compensation file is audited
 * exactly as `createDownloadLink` audits it — the same action, the same resource — but the entry
 * names **what opened it**: signing in the name of whoever handed the credential out would put an
 * account manager's name on a read they never made.
 *
 * `expiresInSeconds` is the caller's to choose (a video played in place outlives a minute) and is
 * capped here.
 */
export async function createVisitorDownloadLink(file: StoredFileRow, reader: VisitorReader, expiresInSeconds: number = DOWNLOAD_LINK_SECONDS): Promise<string> {
  const url = await createSignedDownloadUrl(file.objectPath, Math.max(1, Math.min(Math.round(expiresInSeconds), MAX_VISITOR_LINK_SECONDS)));
  if (tierRank(file.tier as Tier) >= tierRank("restricted")) {
    await recordAudit({
      action: "file.read",
      actor: { userId: null, personId: null, email: null },
      request: { ipAddress: reader.visitorKey, userAgent: null },
      resource: { type: file.ownerType, id: file.ownerId, entityId: file.entityId },
      summary: file.fileName,
      after: { via: reader.via, id: reader.id },
    });
  }
  return url;
}

/**
 * The bytes of a directory-tier file for the app to serve itself — a profile picture, shown on
 * many screens at once, where a signed link per picture per page would be a round trip each.
 * Never for anything above the directory tier: those are opened through `createDownloadLink`.
 */
export async function readPublicInternalFile(file: StoredFileRow): Promise<ReadableStream<Uint8Array> | null> {
  if (file.tier !== "public_internal") throw new Error("only directory-tier files are served by the app");
  return readObject(file.objectPath);
}

/**
 * A short-lived link to a directory-tier file for somebody who is not signed in — a brand kit's
 * logo on the public domain (FR-BRD-04). The owning module has already decided the public may have
 * it; this refuses anything above the directory tier whatever it was told.
 */
export async function createPublicDownloadLink(file: StoredFileRow, expiresInSeconds: number): Promise<string> {
  if (file.tier !== "public_internal") throw new Error("only directory-tier files are handed to the public");
  return createSignedDownloadUrl(file.objectPath, expiresInSeconds);
}

/** Hides the file at once; the bytes go `DELETED_FILE_GRACE_DAYS` later, with the cleanup job (DR-03). */
export async function softDeleteFile(fileId: string): Promise<StoredFileRow | undefined> {
  const [file] = await db()
    .update(schema.storedFile)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.storedFile.id, fileId), isNull(schema.storedFile.deletedAt)))
    .returning();
  return file;
}

/** How long a deleted file's bytes are kept before they are removed: room to notice a mistake, and no longer. */
export const DELETED_FILE_GRACE_DAYS = 7;
/** Deleted files removed from storage per run of the cleanup job. A backlog drains over the following mornings. */
const PURGE_BATCH = 200;
/** Storage calls in flight at once while removing. */
const PURGE_CONCURRENCY = 8;

/**
 * Removes these objects from storage and marks their rows, so they are never asked for again. An
 * object that is already gone counts as removed (`removeObject` takes a 404 as done). One that
 * storage refused keeps its row unmarked — the next run tries again — and the first such refusal is
 * returned for the caller to raise once everything that could be marked has been.
 */
async function removeBytes(files: readonly { id: string; objectPath: string }[], now: Date): Promise<{ removed: number; failure: unknown }> {
  const removed: string[] = [];
  let failure: unknown;
  for (let start = 0; start < files.length; start += PURGE_CONCURRENCY) {
    const outcomes = await Promise.allSettled(files.slice(start, start + PURGE_CONCURRENCY).map((file) => removeObject(file.objectPath).then(() => file.id)));
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") removed.push(outcome.value);
      else failure ??= outcome.reason;
    }
  }
  if (removed.length > 0) await db().update(schema.storedFile).set({ purgedAt: now }).where(inArray(schema.storedFile.id, removed));
  return { removed: removed.length, failure };
}

/**
 * What is deleted is deleted: the stored object of every file soft-deleted more than the grace
 * period ago is removed, oldest first, a batch per run. The row is kept (it is what the audit trail
 * points at) and marked `purged_at`, so the next run does not ask storage for it again.
 */
export async function purgeDeletedFiles(now: Date = new Date(), limit: number = PURGE_BATCH): Promise<{ purgedFiles: number }> {
  const cutoff = new Date(now.getTime() - DELETED_FILE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const due = await db()
    .select({ id: schema.storedFile.id, objectPath: schema.storedFile.objectPath })
    .from(schema.storedFile)
    .where(and(isNotNull(schema.storedFile.deletedAt), lt(schema.storedFile.deletedAt, cutoff), isNull(schema.storedFile.purgedAt)))
    .orderBy(asc(schema.storedFile.deletedAt), asc(schema.storedFile.id))
    .limit(limit);
  const { removed, failure } = await removeBytes(due, now);
  // After the marking, so one object storage will not give up does not hold back the rest.
  if (failure) throw failure;
  return { purgedFiles: removed };
}

/** What an erased file is called. A CV is named after its owner, so the name goes with the bytes. */
export const ERASED_FILE_NAME = "erased";

/**
 * Deletes files **for good, now**: hidden, renamed (the row stays, and a CV's name is its owner's),
 * and their bytes removed without waiting out the grace period. For an erasure — a candidate
 * anonymised by the retention job or at their own request (NFR-PRV-04) — where "it will be gone in
 * a week" is not an answer. Files already soft-deleted are included: their bytes go at once too.
 * Returns how many objects were removed.
 */
export async function eraseFiles(fileIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (fileIds.length === 0) return 0;
  await db()
    .update(schema.storedFile)
    .set({ deletedAt: now })
    .where(and(inArray(schema.storedFile.id, [...fileIds]), isNull(schema.storedFile.deletedAt)));
  await db()
    .update(schema.storedFile)
    .set({ fileName: ERASED_FILE_NAME })
    .where(inArray(schema.storedFile.id, [...fileIds]));
  const files = await db()
    .select({ id: schema.storedFile.id, objectPath: schema.storedFile.objectPath })
    .from(schema.storedFile)
    .where(and(inArray(schema.storedFile.id, [...fileIds]), isNull(schema.storedFile.purgedAt)));
  const { removed, failure } = await removeBytes(files, now);
  if (failure) throw failure;
  return removed;
}

/** Uploads that were allowed but never finished: remove whatever arrived, a day later. */
export async function purgeAbandonedUploads(now: Date = new Date()): Promise<{ abandonedUploads: number }> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const abandoned = await db()
    .select()
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.status, "pending"), lt(schema.storedFile.createdAt, cutoff)));
  for (const file of abandoned) {
    await removeObject(file.objectPath);
    await db().update(schema.storedFile).set({ status: "rejected" }).where(eq(schema.storedFile.id, file.id));
  }
  return { abandonedUploads: abandoned.length };
}
