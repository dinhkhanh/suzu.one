// Files on a page (FR-KB-02), kept by the platform files module. The browser uploads straight to
// private storage through a signed URL; a reader gets a one-minute link from /api/kb/files/<id>
// after the KB policy has said they may see the page the file belongs to.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, listFilesOf, softDeleteFile, type StoredFileRow } from "../platform/files/service";
import { type LoadedPage, loadPage } from "./pages";

export const PAGE_FILE_OWNER = "kb_page";
type Actor = { personId: string; email?: string | null };

export type PageFileView = { id: string; fileName: string; sizeBytes: number; contentType: string; createdAt: Date };

export async function listPageFiles(pageId: string): Promise<PageFileView[]> {
  return (await listFilesOf(PAGE_FILE_OWNER, pageId)).map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, contentType: file.contentType, createdAt: file.createdAt }));
}

/** Page files carry no personal data by themselves: the KB policy, not a sensitivity tier, decides who opens them. */
export const beginPageUpload = (loaded: LoadedPage, file: { fileName: string; sizeBytes: number }, actor: Actor) => beginUpload({ ownerType: PAGE_FILE_OWNER, ownerId: loaded.page.id, entityId: loaded.space.entityId, tier: "public_internal" }, file, actor);

/** A page file with its page; `pending` looks at an upload that is still to be confirmed. */
export async function findPageFile(fileId: string, options: { pending?: boolean } = {}): Promise<{ file: StoredFileRow; loaded: LoadedPage } | undefined> {
  const file = options.pending ? (await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "pending"))).limit(1))[0] : await findFile(fileId);
  if (!file || file.ownerType !== PAGE_FILE_OWNER) return undefined;
  const loaded = await loadPage(file.ownerId);
  return loaded ? { file, loaded } : undefined;
}

export const completePageUpload = (fileId: string, actor: Actor): Promise<StoredFileRow> => completeUpload(fileId, actor);

export const pageFileLink = (file: StoredFileRow, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }) => createDownloadLink(file, actor, request);

export async function removePageFile(fileId: string): Promise<StoredFileRow> {
  const file = await softDeleteFile(fileId);
  if (!file) throw new ActionError("file_not_found");
  return file;
}
