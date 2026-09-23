// Files on a page (FR-KB-02), kept by the platform files module. The browser uploads straight to
// private storage through a signed URL; a reader gets a one-minute link from /api/kb/files/<id>
// after the KB policy has said they may see the page the file belongs to.
import "server-only";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, listFilesOf, softDeleteFile, type StoredFileRow } from "../platform/files/service";
import { pageVisibleSql, spaceEditableSql } from "./access-sql";
import { type Doc, fileIdsOf } from "./engine/doc";
import { levelOf, type LoadedPage, loadPage } from "./pages";
import { atLeast, type KbViewer } from "./policy";

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

/**
 * Editors open every file of a page they edit. A reader opens only what the PUBLISHED version
 * shows: a file uploaded to a draft (or to a revision waiting for review) is not theirs to fetch
 * by guessing its address.
 */
export async function mayOpenPageFile(viewer: KbViewer, loaded: LoadedPage, fileId: string): Promise<boolean> {
  const level = levelOf(viewer, loaded);
  if (!level) return false;
  if (atLeast(level, "edit")) return true;
  return shownByPublishedVersion(loaded, fileId);
}

/** Does the page's published version show this file? What readers may open, and what a review guards. */
export async function shownByPublishedVersion(loaded: LoadedPage, fileId: string): Promise<boolean> {
  if (!loaded.page.publishedVersionId) return false;
  const [version] = await db().select({ content: schema.kbPageVersion.content }).from(schema.kbPageVersion).where(eq(schema.kbPageVersion.id, loaded.page.publishedVersionId)).limit(1);
  return !!version && fileIdsOf(version.content as Doc).includes(fileId.toLowerCase());
}

export type SpaceFileView = PageFileView & { pageId: string; pageTitle: string; uploadedByName: string | null };

/**
 * Every file in a space, in one list (FR-KB-15): a team finds an upload without remembering which
 * page it hangs on. Permission-filtered in SQL exactly as the page tree is — a file of a page the
 * viewer may not open is not in the list, and no separate sharing rule exists for files.
 *
 * And as the tree does, it shows a **reader** what readers see: the page by its published title,
 * and only the files the published version shows — the same rule `mayOpenPageFile` applies to the
 * download. A draft upload, or the working title of a revision under review, is the editors'
 * business. Who is an editor is the space's level, as in `listTree`.
 */
export async function listSpaceFiles(viewer: KbViewer, spaceId: string): Promise<SpaceFileView[]> {
  const uploader = alias(schema.person, "uploader");
  const published = alias(schema.kbPageVersion, "published_version");
  const editor = spaceEditableSql(viewer);
  // An attachment or image node anywhere in the published document naming this file — `fileIdsOf`
  // in SQL, compared as `mayOpenPageFile` compares: against the id's lower-case text.
  const shownWhenPublished = sql`jsonb_path_exists(${published.content}, '$.** ? (@.type == "attachment" || @.type == "image") ? (@.attrs.fileId == $id)', jsonb_build_object('id', ${schema.storedFile.id}::text))`;
  const rows = await db()
    .select({
      file: schema.storedFile,
      pageId: schema.kbPage.id,
      pageTitle: sql<string>`case when ${editor} then ${schema.kbPage.title} else coalesce(${schema.kbPage.publishedTitle}, ${schema.kbPage.title}) end`,
      uploadedByName: uploader.fullName,
    })
    .from(schema.storedFile)
    // `stored_file.owner_id` is text: it names rows of several kinds, so the join casts.
    .innerJoin(schema.kbPage, sql`${schema.kbPage.id}::text = ${schema.storedFile.ownerId}`)
    .innerJoin(schema.kbSpace, eq(schema.kbSpace.id, schema.kbPage.spaceId))
    .leftJoin(published, eq(published.id, schema.kbPage.publishedVersionId))
    .leftJoin(uploader, eq(uploader.id, schema.storedFile.uploadedByPersonId))
    .where(
      and(
        eq(schema.storedFile.ownerType, PAGE_FILE_OWNER),
        eq(schema.storedFile.status, "ready"),
        isNull(schema.storedFile.deletedAt),
        eq(schema.kbPage.spaceId, spaceId),
        pageVisibleSql(viewer),
        or(editor, and(isNotNull(published.id), shownWhenPublished)),
      ),
    )
    .orderBy(desc(schema.storedFile.createdAt));
  return rows.map(({ file, pageId, pageTitle, uploadedByName }) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, contentType: file.contentType, createdAt: file.createdAt, pageId, pageTitle, uploadedByName }));
}
