// Pages: the tree, the working copy, publishing, versions (FR-KB-01, 02, 04).
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { pageVisibleSql } from "./access-sql";
import { ackOnPublish } from "./acknowledgements";
import { rebuildChunks, removeChunks } from "./chunks";
import { type DiffLine, diffLines } from "./engine/diff";
import { type Doc, docToPlainText, EMPTY_DOC, validateDoc } from "./engine/doc";
import { type AccessRow, atLeast, type KbLevel, type KbViewer, type PageFacts, pageLevel, spaceLevel } from "./policy";
import { type LoadedSpace, loadSpace, replaceAccess } from "./spaces";

type Executor = Tx | ReturnType<typeof db>;
export type PageRow = typeof schema.kbPage.$inferSelect;
export type PageVersionRow = typeof schema.kbPageVersion.$inferSelect;
export type Actor = { personId: string };

export type LoadedPage = LoadedSpace & { page: PageRow; rootAccess: AccessRow[] | null; pageFacts: PageFacts };

export const pageFacts = (page: Pick<PageRow, "publishedVersionId" | "status" | "deletedAt">, rootAccess: readonly AccessRow[] | null): PageFacts => ({ readable: !!page.publishedVersionId && page.status !== "archived", deleted: !!page.deletedAt, rootAccess });

async function pageAccessRows(executor: Executor, pageId: string): Promise<AccessRow[]> {
  return executor.select({ subjectKey: schema.kbAccess.subjectKey, level: schema.kbAccess.level }).from(schema.kbAccess).where(eq(schema.kbAccess.pageId, pageId)).orderBy(asc(schema.kbAccess.createdAt));
}

/** A page with everything the policy asks about it. No authorization here: callers ask `levelOf`. */
export async function loadPage(pageId: string, executor: Executor = db()): Promise<LoadedPage | null> {
  const [page] = await executor.select().from(schema.kbPage).where(eq(schema.kbPage.id, pageId)).limit(1);
  if (!page) return null;
  const space = await loadSpace({ id: page.spaceId }, executor);
  if (!space) return null;
  const rootAccess = page.accessRootId ? await pageAccessRows(executor, page.accessRootId) : null;
  return { ...space, page, rootAccess, pageFacts: pageFacts(page, rootAccess) };
}

export const levelOf = (viewer: KbViewer, loaded: LoadedPage): KbLevel | null => pageLevel(viewer, loaded.facts, loaded.pageFacts);

function checkedDoc(content: unknown): Doc {
  const result = validateDoc(content);
  if (!result.ok) throw new ActionError("kb_content_invalid", { problem: result.problem, path: result.path });
  return result.doc;
}

const cleanTitle = (title: string): string => {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) throw new ActionError("kb_title_required");
  return clean;
};

// ── The tree ────────────────────────────────────────────────────────────────────────────────

export type TreeNode = { id: string; parentId: string | null; title: string; status: PageRow["status"]; published: boolean; hasUnpublishedChanges: boolean; restricted: boolean; sortOrder: number; depth: number };

/**
 * The pages of a space the viewer may open, in reading order, each with its depth. Filtered in
 * SQL. A page whose parent the viewer cannot see hangs from the top.
 */
export async function listTree(viewer: KbViewer, space: LoadedSpace): Promise<TreeNode[]> {
  const editor = atLeast(spaceLevel(viewer, space.facts), "edit");
  const rows = await db()
    .select({ id: schema.kbPage.id, parentId: schema.kbPage.parentId, title: schema.kbPage.title, publishedTitle: schema.kbPage.publishedTitle, status: schema.kbPage.status, publishedVersionId: schema.kbPage.publishedVersionId, hasUnpublishedChanges: schema.kbPage.hasUnpublishedChanges, accessRootId: schema.kbPage.accessRootId, sortOrder: schema.kbPage.sortOrder })
    .from(schema.kbPage)
    .innerJoin(schema.kbSpace, eq(schema.kbSpace.id, schema.kbPage.spaceId))
    .where(and(eq(schema.kbPage.spaceId, space.space.id), pageVisibleSql(viewer)))
    .orderBy(asc(schema.kbPage.sortOrder), asc(schema.kbPage.createdAt));
  const visible = new Set(rows.map((row) => row.id));
  const children = Map.groupBy(rows, (row) => (row.parentId && visible.has(row.parentId) ? row.parentId : ""));
  const ordered: TreeNode[] = [];
  const walk = (parentKey: string, depth: number) => {
    for (const row of children.get(parentKey) ?? []) {
      // Readers know a page by its published title; a draft title is the editors' business.
      ordered.push({ id: row.id, parentId: parentKey || null, title: editor ? row.title : (row.publishedTitle ?? row.title), status: row.status, published: !!row.publishedVersionId, hasUnpublishedChanges: row.hasUnpublishedChanges, restricted: row.accessRootId === row.id, sortOrder: row.sortOrder, depth });
      if (depth < 30) walk(row.id, depth + 1);
    }
  };
  walk("", 0);
  return ordered;
}

/** From the top of the space down to the page's parent — only what is in the viewer's tree. */
export function breadcrumbOf(tree: readonly TreeNode[], pageId: string): TreeNode[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const trail: TreeNode[] = [];
  for (let cursor = byId.get(pageId)?.parentId ?? null; cursor && trail.length < 40; cursor = byId.get(cursor)?.parentId ?? null) {
    const node = byId.get(cursor);
    if (!node) break;
    trail.unshift(node);
  }
  return trail;
}

/**
 * Sets every page's `access_root_id` from the tree: the nearest page, itself or above, that has
 * rows of its own. Run after a restriction changes or a page moves. A space is a few hundred pages.
 */
async function recomputeAccessRoots(tx: Tx, spaceId: string): Promise<void> {
  const pages = await tx.select({ id: schema.kbPage.id, parentId: schema.kbPage.parentId, accessRootId: schema.kbPage.accessRootId }).from(schema.kbPage).where(eq(schema.kbPage.spaceId, spaceId));
  const restricted = new Set((await tx.selectDistinct({ pageId: schema.kbAccess.pageId }).from(schema.kbAccess).where(and(eq(schema.kbAccess.spaceId, spaceId), isNotNull(schema.kbAccess.pageId)))).map((row) => row.pageId!));
  const byId = new Map(pages.map((page) => [page.id, page]));
  const rootOf = (pageId: string): string | null => {
    const seen = new Set<string>();
    for (let cursor: string | null = pageId; cursor && !seen.has(cursor); cursor = byId.get(cursor)?.parentId ?? null) {
      if (restricted.has(cursor)) return cursor;
      seen.add(cursor);
    }
    return null;
  };
  for (const page of pages) {
    const root = rootOf(page.id);
    if (root !== page.accessRootId) await tx.update(schema.kbPage).set({ accessRootId: root }).where(eq(schema.kbPage.id, page.id));
  }
}

async function nextSortOrder(executor: Executor, spaceId: string, parentId: string | null): Promise<number> {
  const [row] = await executor.select({ last: max(schema.kbPage.sortOrder) }).from(schema.kbPage).where(and(eq(schema.kbPage.spaceId, spaceId), parentId ? eq(schema.kbPage.parentId, parentId) : isNull(schema.kbPage.parentId), isNull(schema.kbPage.deletedAt)));
  return (row?.last ?? -1) + 1;
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

export type NewPage = { spaceId: string; parentId: string | null; title: string; content?: unknown; ownerPersonId?: string | null };

export async function createPage(input: NewPage, actor: Actor, executor?: Tx): Promise<PageRow> {
  const content = checkedDoc(input.content ?? EMPTY_DOC);
  const run = async (tx: Tx) => {
    let accessRootId: string | null = null;
    if (input.parentId) {
      const [parent] = await tx.select().from(schema.kbPage).where(eq(schema.kbPage.id, input.parentId)).limit(1);
      if (!parent || parent.spaceId !== input.spaceId || parent.deletedAt) throw new ActionError("kb_parent_not_found");
      accessRootId = parent.accessRootId;
    }
    const [page] = await tx
      .insert(schema.kbPage)
      .values({ spaceId: input.spaceId, parentId: input.parentId, title: cleanTitle(input.title), content, contentText: docToPlainText(content), sortOrder: await nextSortOrder(tx, input.spaceId, input.parentId), accessRootId, ownerPersonId: input.ownerPersonId ?? actor.personId, createdByPersonId: actor.personId, updatedByPersonId: actor.personId })
      .returning();
    return page;
  };
  return executor ? run(executor) : db().transaction(run);
}

/** Saves the working copy. Readers notice nothing until it is published. */
export async function saveDraft(pageId: string, input: { title: string; content: unknown }, actor: Actor): Promise<{ before: PageRow; after: PageRow }> {
  const content = checkedDoc(input.content);
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    // What reviewers are reading must not change under them (the review flow sets this status).
    if (before.status === "in_review") throw new ActionError("kb_page_in_review");
    const [after] = await tx
      .update(schema.kbPage)
      .set({ title: cleanTitle(input.title), content, contentText: docToPlainText(content), hasUnpublishedChanges: true, updatedByPersonId: actor.personId, updatedAt: new Date() })
      .where(eq(schema.kbPage.id, pageId))
      .returning();
    return { before, after };
  });
}

export type PublishOptions = { changeNote?: string | null; isMajor?: boolean; /** The review that let it through (controlled spaces). */ approvalRequestId?: string | null; /** Whose revision it is, when the publisher is the approver. */ authorPersonId?: string | null };

/**
 * THE PUBLISH SEAM. Turns the working copy into version n + 1 and makes it what readers see and
 * search finds. It asks nobody's permission: the action decides who may call it —
 * `canPublishDirectly` today; in a controlled space the review flow calls it, inside its own
 * transaction, once the approval engine says "approved".
 */
export async function publishPage(pageId: string, actor: Actor, options: PublishOptions = {}, executor?: Tx): Promise<{ page: PageRow; version: PageVersionRow; before: PageRow }> {
  const run = async (tx: Tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    if (before.publishedVersionId && !before.hasUnpublishedChanges && before.status === "published") throw new ActionError("kb_nothing_to_publish");
    // A revision that waits for its reviewers is published by their answer, not around it.
    if (before.status === "in_review" && !options.approvalRequestId) throw new ActionError("kb_page_in_review");
    const content = checkedDoc(before.content);
    const [last] = await tx.select({ versionNo: max(schema.kbPageVersion.versionNo) }).from(schema.kbPageVersion).where(eq(schema.kbPageVersion.pageId, pageId));
    const [version] = await tx
      .insert(schema.kbPageVersion)
      .values({ pageId, versionNo: (last?.versionNo ?? 0) + 1, title: before.title, content, contentText: before.contentText, authorPersonId: options.authorPersonId ?? actor.personId, changeNote: options.changeNote?.trim() || null, isMajor: !!options.isMajor, approvalRequestId: options.approvalRequestId ?? null })
      .returning();
    const [page] = await tx
      .update(schema.kbPage)
      .set({ status: "published", publishedVersionId: version.id, publishedTitle: version.title, publishedAt: new Date(), hasUnpublishedChanges: false, searchTitle: toSearchKey(version.title), searchBody: toSearchKey(version.contentText), updatedAt: new Date() })
      .where(eq(schema.kbPage.id, pageId))
      .returning();
    // The assistant quotes what readers read: the passages follow the published version.
    await rebuildChunks(tx, page, version);
    // "Must read": the first publication, or a major revision, (re)starts the confirmation.
    return { page: await ackOnPublish(tx, page, version), version, before };
  };
  return executor ? run(executor) : db().transaction(run);
}

/** Takes a page away from readers (and from search) without losing its history. */
export async function unpublishPage(pageId: string): Promise<{ before: PageRow; after: PageRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    if (!before.publishedVersionId) throw new ActionError("kb_not_published");
    const [after] = await tx.update(schema.kbPage).set({ status: "draft", publishedVersionId: null, publishedTitle: null, publishedAt: null, hasUnpublishedChanges: true, searchTitle: "", searchBody: "", updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
    await removeChunks(tx, pageId);
    return { before, after };
  });
}

/** Archived: kept, with its history, but out of the readers' tree and search. */
export async function setPageArchived(pageId: string, archived: boolean): Promise<{ before: PageRow; after: PageRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    if (before.status === "in_review") throw new ActionError("kb_page_in_review");
    const status = archived ? "archived" : before.publishedVersionId ? "published" : "draft";
    const [after] = await tx.update(schema.kbPage).set({ status, updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
    if (archived) await removeChunks(tx, pageId);
    else if (after.publishedVersionId) {
      const [version] = await tx.select().from(schema.kbPageVersion).where(eq(schema.kbPageVersion.id, after.publishedVersionId)).limit(1);
      if (version) await rebuildChunks(tx, after, version);
    }
    return { before, after };
  });
}

/** Soft delete. A page with pages under it stays: move or delete those first. */
export async function deletePage(pageId: string): Promise<PageRow> {
  return db().transaction(async (tx) => {
    const [page] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!page) throw new ActionError("kb_page_not_found");
    if (page.status === "in_review") throw new ActionError("kb_page_in_review");
    const [children] = await tx.select({ n: count() }).from(schema.kbPage).where(and(eq(schema.kbPage.parentId, pageId), isNull(schema.kbPage.deletedAt)));
    if (children.n > 0) throw new ActionError("kb_page_has_children");
    await tx.delete(schema.kbAccess).where(eq(schema.kbAccess.pageId, pageId));
    await removeChunks(tx, pageId);
    const [deleted] = await tx.update(schema.kbPage).set({ deletedAt: new Date(), searchTitle: "", searchBody: "", accessRootId: null }).where(eq(schema.kbPage.id, pageId)).returning();
    return deleted;
  });
}

/** Moves a page (with everything under it) to another parent of the same space, or reorders it: `position` is its index among the new siblings. */
export async function movePage(pageId: string, target: { parentId: string | null; position: number | null }): Promise<{ before: PageRow; after: PageRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    const pages = await tx.select({ id: schema.kbPage.id, parentId: schema.kbPage.parentId, sortOrder: schema.kbPage.sortOrder, createdAt: schema.kbPage.createdAt }).from(schema.kbPage).where(and(eq(schema.kbPage.spaceId, before.spaceId), isNull(schema.kbPage.deletedAt)));
    const byId = new Map(pages.map((page) => [page.id, page]));
    if (target.parentId) {
      if (!byId.has(target.parentId)) throw new ActionError("kb_parent_not_found");
      // Not under itself: walk up from the new parent.
      const seen = new Set<string>();
      for (let cursor: string | null = target.parentId; cursor && !seen.has(cursor); cursor = byId.get(cursor)?.parentId ?? null) {
        if (cursor === pageId) throw new ActionError("kb_move_into_itself");
        seen.add(cursor);
      }
    }
    const siblings = pages.filter((page) => page.id !== pageId && (page.parentId ?? null) === target.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
    const index = target.position === null ? siblings.length : Math.max(0, Math.min(target.position, siblings.length));
    const order = [...siblings.slice(0, index).map((page) => page.id), pageId, ...siblings.slice(index).map((page) => page.id)];
    for (const [sortOrder, id] of order.entries()) {
      const current = byId.get(id)!;
      if (id === pageId) await tx.update(schema.kbPage).set({ parentId: target.parentId, sortOrder, updatedAt: new Date() }).where(eq(schema.kbPage.id, id));
      else if (current.sortOrder !== sortOrder) await tx.update(schema.kbPage).set({ sortOrder }).where(eq(schema.kbPage.id, id));
    }
    await recomputeAccessRoots(tx, before.spaceId);
    const [after] = await tx.select().from(schema.kbPage).where(eq(schema.kbPage.id, pageId)).limit(1);
    return { before, after };
  });
}

/** The page's own access rows: with any, the page and everything under it is for the people they name (plus the space's editors). None = follow the space again. */
export async function setPageAccess(pageId: string, rows: readonly AccessRow[]): Promise<{ before: AccessRow[]; after: AccessRow[]; page: PageRow }> {
  return db().transaction(async (tx) => {
    const [page] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!page) throw new ActionError("kb_page_not_found");
    const before = await pageAccessRows(tx, pageId);
    const after = await replaceAccess(tx, page.spaceId, pageId, rows);
    await recomputeAccessRoots(tx, page.spaceId);
    return { before, after, page };
  });
}

export const listPageAccess = (pageId: string): Promise<AccessRow[]> => pageAccessRows(db(), pageId);

export async function setPageMeta(pageId: string, values: { ownerPersonId: string | null; reviewBy: IsoDate | null }): Promise<{ before: PageRow; after: PageRow }> {
  const [before] = await db().select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1);
  if (!before) throw new ActionError("kb_page_not_found");
  // A new review date is a new promise: the owner is reminded again when it passes.
  const [after] = await db().update(schema.kbPage).set({ ...values, ...(values.reviewBy !== before.reviewBy ? { reviewRemindedOn: null } : {}), updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
  return { before, after };
}

// ── Versions ────────────────────────────────────────────────────────────────────────────────

export type VersionListRow = { id: string; versionNo: number; title: string; changeNote: string | null; isMajor: boolean; authorPersonId: string | null; authorName: string | null; createdAt: Date; current: boolean };

export async function listVersions(page: Pick<PageRow, "id" | "publishedVersionId">): Promise<VersionListRow[]> {
  const rows = await db()
    .select({ id: schema.kbPageVersion.id, versionNo: schema.kbPageVersion.versionNo, title: schema.kbPageVersion.title, changeNote: schema.kbPageVersion.changeNote, isMajor: schema.kbPageVersion.isMajor, authorPersonId: schema.kbPageVersion.authorPersonId, authorName: schema.person.fullName, createdAt: schema.kbPageVersion.createdAt })
    .from(schema.kbPageVersion)
    .leftJoin(schema.person, eq(schema.person.id, schema.kbPageVersion.authorPersonId))
    .where(eq(schema.kbPageVersion.pageId, page.id))
    .orderBy(desc(schema.kbPageVersion.versionNo));
  return rows.map((row) => ({ ...row, current: row.id === page.publishedVersionId }));
}

export async function getVersion(pageId: string, where: { versionNo: number } | { id: string }, executor: Executor = db()): Promise<PageVersionRow | null> {
  const [row] = await executor.select().from(schema.kbPageVersion).where(and(eq(schema.kbPageVersion.pageId, pageId), "id" in where ? eq(schema.kbPageVersion.id, where.id) : eq(schema.kbPageVersion.versionNo, where.versionNo))).limit(1);
  return row ?? null;
}

export type VersionComparison = { from: { versionNo: number; title: string }; to: { versionNo: number | null; title: string }; lines: DiffLine[] };

/** What changed between two versions; `toNo` null = the working copy (editors only — the caller checks). */
export async function compareVersions(page: PageRow, fromNo: number, toNo: number | null): Promise<VersionComparison | null> {
  const from = await getVersion(page.id, { versionNo: fromNo });
  const to = toNo === null ? { versionNo: null, title: page.title, contentText: page.contentText } : await getVersion(page.id, { versionNo: toNo });
  if (!from || !to) return null;
  return { from: { versionNo: from.versionNo, title: from.title }, to: { versionNo: to.versionNo, title: to.title }, lines: diffLines(from.contentText, to.contentText) };
}

/** Copies a version back into the working copy. History is never rewritten: publishing it makes a new version. */
export async function restoreVersion(pageId: string, versionNo: number, actor: Actor): Promise<{ before: PageRow; after: PageRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    if (before.status === "in_review") throw new ActionError("kb_page_in_review");
    const version = await getVersion(pageId, { versionNo }, tx);
    if (!version) throw new ActionError("kb_version_not_found");
    const [after] = await tx.update(schema.kbPage).set({ title: version.title, content: version.content, contentText: version.contentText, hasUnpublishedChanges: true, updatedByPersonId: actor.personId, updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
    return { before, after };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type ReadingView = { title: string; content: Doc; showing: "published" | "draft"; version: { versionNo: number; createdAt: Date; authorName: string | null } | null };

/** What the reading view shows: the published version — or the working copy for an editor who asks for it, or when nothing is published yet. */
export async function getReadingView(loaded: LoadedPage, level: KbLevel, wantDraft: boolean): Promise<ReadingView> {
  const { page } = loaded;
  const draft = (): ReadingView => ({ title: page.title, content: page.content as Doc, showing: "draft", version: null });
  if (atLeast(level, "edit") && (wantDraft || !page.publishedVersionId)) return draft();
  const [row] = page.publishedVersionId
    ? await db()
        .select({ version: schema.kbPageVersion, authorName: schema.person.fullName })
        .from(schema.kbPageVersion)
        .leftJoin(schema.person, eq(schema.person.id, schema.kbPageVersion.authorPersonId))
        .where(eq(schema.kbPageVersion.id, page.publishedVersionId))
        .limit(1)
    : [];
  if (!row) return draft();
  return { title: row.version.title, content: row.version.content as Doc, showing: "published", version: { versionNo: row.version.versionNo, createdAt: row.version.createdAt, authorName: row.authorName } };
}

/** One row per reader, page and day (recent and popular pages). */
export async function recordView(pageId: string, personId: string, today: IsoDate): Promise<void> {
  await db()
    .insert(schema.kbPageView)
    .values({ pageId, personId, viewedOn: today })
    .onConflictDoUpdate({ target: [schema.kbPageView.pageId, schema.kbPageView.personId, schema.kbPageView.viewedOn], set: { viewedAt: sql`now()` } });
}

/** Parents a page may be moved under, as the editor sees the tree: not itself, nothing below it. */
export function moveTargets(tree: readonly TreeNode[], pageId: string): TreeNode[] {
  const below = new Set([pageId]);
  // The tree is in reading order: a node's descendants follow it.
  for (const node of tree) if (node.parentId && below.has(node.parentId)) below.add(node.id);
  return tree.filter((node) => !below.has(node.id));
}

export async function pagesExist(pageIds: readonly string[]): Promise<Set<string>> {
  const rows = pageIds.length ? await db().select({ id: schema.kbPage.id }).from(schema.kbPage).where(and(inArray(schema.kbPage.id, [...pageIds]), isNull(schema.kbPage.deletedAt))) : [];
  return new Set(rows.map((row) => row.id));
}
