// What is deleted is deleted (DR-03), against a real Postgres (PGlite) and a bucket that can be
// looked into. `softDeleteFile` only hides a file; these are the tests that its bytes then leave
// storage — a grace period later with the cleanup job, or at once for an erasure — and that a row
// is asked about exactly once.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
// Only the network layer is replaced: a map for the bucket, a list of what was asked, and paths
// that storage refuses to remove.
const bucket = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>(), removals: [] as string[], refusing: new Set<string>() }));
vi.mock("./storage", () => ({
  putObject: async (objectPath: string, bytes: Uint8Array) => void bucket.objects.set(objectPath, bytes),
  currentBucket: () => "test-bucket",
  createSignedUploadUrl: async () => "https://example.invalid/upload",
  createSignedDownloadUrl: async () => "https://example.invalid/download",
  inspectObject: async () => null,
  finalizeObject: async () => {},
  readObject: async () => null,
  // Like the real one: an object that is not there is not an error.
  removeObject: async (objectPath: string) => {
    bucket.removals.push(objectPath);
    if (bucket.refusing.has(objectPath)) throw new Error("remove: 503 storage is having a moment");
    bucket.objects.delete(objectPath);
  },
}));

import { eq, inArray } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { filesCleanupJob } from "./jobs";
import { DELETED_FILE_GRACE_DAYS, ERASED_FILE_NAME, eraseFiles, findFile, purgeDeletedFiles, softDeleteFile, storeIncomingFile } from "./service";

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode("-1.7\nfake but honest")]);
const now = new Date("2026-10-05T03:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

let entityId: string;
const store = (fileName = "report.pdf") => storeIncomingFile({ ownerType: "note", ownerId: "n1", entityId, tier: "personal" }, { fileName, bytes: pdfBytes });
/** A stored file that was deleted `days` ago. */
async function deleted(days: number, fileName?: string) {
  const file = await store(fileName);
  await db()
    .update(schema.storedFile)
    .set({ deletedAt: daysAgo(days) })
    .where(eq(schema.storedFile.id, file.id));
  return file;
}
const row = async (fileId: string) => (await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, fileId)))[0];

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "T1", shortName: "T1", legalName: "T1" }).returning();
  entityId = entity.id;
});

beforeEach(async () => {
  await db().delete(schema.storedFile);
  bucket.objects.clear();
  bucket.removals.length = 0;
  bucket.refusing.clear();
});

describe("the cleanup job", () => {
  it("removes the bytes of a file deleted longer ago than the grace period, and keeps the row", async () => {
    const old = await deleted(DELETED_FILE_GRACE_DAYS + 1);
    expect(bucket.objects.has(old.objectPath)).toBe(true);

    expect(await purgeDeletedFiles(now)).toEqual({ purgedFiles: 1 });
    expect(bucket.objects.has(old.objectPath)).toBe(false);
    const after = await row(old.id);
    expect(after.purgedAt).toEqual(now);
    // The row is the record that a file existed: still there, still named, still deleted.
    expect(after).toMatchObject({ fileName: "report.pdf", objectPath: old.objectPath });
    expect(after.deletedAt).not.toBeNull();
  });

  it("leaves a fresh deletion alone, and never touches a file nobody deleted", async () => {
    const fresh = await deleted(DELETED_FILE_GRACE_DAYS - 1);
    const live = await store();
    const justNow = await store();
    await softDeleteFile(justNow.id);

    expect(await purgeDeletedFiles(now)).toEqual({ purgedFiles: 0 });
    for (const file of [fresh, live, justNow]) expect(bucket.objects.has(file.objectPath)).toBe(true);
    expect(bucket.removals).toEqual([]);
    expect((await row(fresh.id)).purgedAt).toBeNull();
    expect(await findFile(live.id)).toBeDefined();
  });

  it("asks storage about a file once: a purged row is not retried", async () => {
    const old = await deleted(30);
    await purgeDeletedFiles(now);
    expect(await purgeDeletedFiles(now)).toEqual({ purgedFiles: 0 });
    expect(bucket.removals).toEqual([old.objectPath]);
  });

  it("takes an object that is already gone as removed", async () => {
    const old = await deleted(30);
    bucket.objects.delete(old.objectPath);
    expect(await purgeDeletedFiles(now)).toEqual({ purgedFiles: 1 });
    expect((await row(old.id)).purgedAt).not.toBeNull();
  });

  it("works through a backlog a batch at a time, oldest first", async () => {
    const oldest = await deleted(90);
    const older = await deleted(60);
    const newer = await deleted(30);
    expect(await purgeDeletedFiles(now, 2)).toEqual({ purgedFiles: 2 });
    expect((await row(oldest.id)).purgedAt).not.toBeNull();
    expect((await row(older.id)).purgedAt).not.toBeNull();
    expect((await row(newer.id)).purgedAt).toBeNull();
    expect(await purgeDeletedFiles(now, 2)).toEqual({ purgedFiles: 1 });
    expect(bucket.objects.size).toBe(0);
  });

  it("marks what it removed before it reports what storage refused, and tries that one again next time", async () => {
    const stuck = await deleted(90);
    const fine = await deleted(60);
    bucket.refusing.add(stuck.objectPath);

    await expect(purgeDeletedFiles(now)).rejects.toThrow("storage is having a moment");
    expect((await row(fine.id)).purgedAt).not.toBeNull();
    expect((await row(stuck.id)).purgedAt).toBeNull();
    expect(bucket.objects.has(stuck.objectPath)).toBe(true);

    bucket.refusing.clear();
    expect(await purgeDeletedFiles(now)).toEqual({ purgedFiles: 1 });
    expect(bucket.objects.size).toBe(0);
  });

  it("is what `files-cleanup` runs, beside the abandoned uploads", async () => {
    // The job reads the real clock, so this one is deleted relative to it.
    const old = await store();
    await db()
      .update(schema.storedFile)
      .set({ deletedAt: new Date(Date.now() - (DELETED_FILE_GRACE_DAYS + 3) * 24 * 60 * 60 * 1000) })
      .where(eq(schema.storedFile.id, old.id));
    const result = await filesCleanupJob.run({ today: todayInVietnam() });
    expect(result).toEqual({ abandonedUploads: 0, purgedFiles: 1 });
    expect(bucket.objects.has(old.objectPath)).toBe(false);
  });
});

describe("erasing files", () => {
  it("removes the bytes at once — live files and ones already deleted — and takes the name off the row", async () => {
    const live = await store("cv-nguyen-van-a.pdf");
    const alreadyDeleted = await deleted(1, "cv-nguyen-van-a-ban-2.pdf");
    const somebodyElses = await store("cv-tran-thi-b.pdf");

    expect(await eraseFiles([live.id, alreadyDeleted.id], now)).toBe(2);
    expect(bucket.objects.has(live.objectPath)).toBe(false);
    expect(bucket.objects.has(alreadyDeleted.objectPath)).toBe(false);
    expect(bucket.objects.has(somebodyElses.objectPath)).toBe(true);

    const rows = await db()
      .select()
      .from(schema.storedFile)
      .where(inArray(schema.storedFile.id, [live.id, alreadyDeleted.id]));
    for (const file of rows) {
      expect(file.fileName).toBe(ERASED_FILE_NAME);
      expect(file.deletedAt).not.toBeNull();
      expect(file.purgedAt).toEqual(now);
    }
    // The earlier deletion keeps its own date; the file nobody named is untouched.
    expect((await row(alreadyDeleted.id)).deletedAt).toEqual(daysAgo(1));
    expect(await row(somebodyElses.id)).toMatchObject({ fileName: "cv-tran-thi-b.pdf", deletedAt: null, purgedAt: null });
    // Nothing is left for the cleanup job to do.
    expect(await purgeDeletedFiles(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))).toEqual({ purgedFiles: 0 });
  });

  it("does nothing for an empty list, and nothing twice", async () => {
    expect(await eraseFiles([])).toBe(0);
    const file = await store();
    expect(await eraseFiles([file.id], now)).toBe(1);
    expect(await eraseFiles([file.id], now)).toBe(0);
    expect(bucket.removals).toEqual([file.objectPath]);
  });
});
