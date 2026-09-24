// Talks to a real Supabase Storage (the local stack). Skipped unless pointed at one:
//   SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SECRET_KEY=... pnpm vitest run tests/storage.integration.test.ts
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("./helpers/db"));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
vi.mock("@/lib/env", () => ({
  env: () => ({ SUPABASE_URL: process.env.SUPABASE_URL, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET: "suzu-test" }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, listFilesOf, softDeleteFile } from "@/modules/platform/files/service";
import { inspectObject } from "@/modules/platform/files/storage";
import { migrateTestDb } from "./helpers/db";

const configured = !!process.env.SUPABASE_URL && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const pdf = new TextEncoder().encode("%PDF-1.7\nHợp đồng lao động\n%%EOF");
const owner = { ownerType: "test_document", ownerId: "doc-1", entityId: null, tier: "restricted" as const };
let actor: { personId: string; email: string };

const put = (url: string, body: Uint8Array, contentType: string) => fetch(url, { method: "PUT", body: Buffer.from(body), headers: { "content-type": contentType } });

describe.skipIf(!configured)("file storage against Supabase", () => {
  beforeAll(async () => {
    await migrateTestDb();
    const [person] = await db().insert(schema.person).values({ fullName: "Uploader", searchName: "uploader", workEmail: "up@suzu.vn", status: "active" }).returning();
    actor = { personId: person.id, email: "up@suzu.vn" };
  });

  it("uploads through a signed URL, confirms, and hands out a working one-minute download link", async () => {
    const { fileId, uploadUrl, contentType } = await beginUpload(owner, { fileName: "Hợp đồng.pdf", sizeBytes: pdf.length }, actor);
    await expect(completeUpload(fileId, actor)).rejects.toThrow("file_not_uploaded");
    expect((await put(uploadUrl, pdf, contentType)).ok).toBe(true);

    const ready = await completeUpload(fileId, actor);
    expect(ready).toMatchObject({ status: "ready", sizeBytes: pdf.length, scanStatus: "not_scanned" });
    expect((await listFilesOf("test_document", "doc-1")).map((file) => file.id)).toEqual([fileId]);

    const link = await createDownloadLink(ready, actor);
    const download = await fetch(link);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    // Opening a restricted file leaves a trace.
    expect((await db().select().from(schema.auditLog)).map((row) => row.action)).toContain("file.read");

    // The object is private: without the signature there is nothing to fetch.
    expect((await fetch(link.split("?")[0])).ok).toBe(false);

    await softDeleteFile(fileId);
    expect(await findFile(fileId)).toBeUndefined();
  });

  it("removes bytes that are not what the name promised", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const { fileId, uploadUrl, contentType } = await beginUpload(owner, { fileName: "invoice.pdf", sizeBytes: exe.length }, actor);
    expect((await put(uploadUrl, exe, contentType)).ok).toBe(true);
    await expect(completeUpload(fileId, actor)).rejects.toThrow("file_content_mismatch");

    const [row] = await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, fileId));
    expect(row.status).toBe("rejected");
    expect(await inspectObject(row.objectPath)).toBeNull();
  });

  it("lets only the uploader confirm, and refuses disallowed types before touching storage", async () => {
    const { fileId } = await beginUpload(owner, { fileName: "a.png", sizeBytes: 10 }, actor);
    await expect(completeUpload(fileId, { personId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("file_not_found");
    await expect(beginUpload(owner, { fileName: "run.exe", sizeBytes: 10 }, actor)).rejects.toThrow("file_type_not_allowed");
  });
});
