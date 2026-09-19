"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { toCsv } from "@/modules/platform/export/csv";
import { acknowledgePage, getAckReport, remindPendingNow, setAckRequirement } from "./acknowledgements";
import { embedPendingChunks } from "./chunks";
import { embeddingDriver } from "./embeddings";
import { ACCESS_LEVELS, parseSubjectKey, SPACE_KEY, SPACE_KINDS } from "./enums";
import { beginPageUpload, completePageUpload, findPageFile, removePageFile } from "./files";
import { createPage, deletePage, type LoadedPage, loadPage, movePage, type PageRow, publishPage, restoreVersion, saveDraft, setPageAccess, setPageArchived, setPageMeta, unpublishPage } from "./pages";
import { canCreatePage, canEditPage, canManageSpace, canOrganisePages, canPublishDirectly, canViewPage, kbViewerOf } from "./policy";
import { decidePageReview, getPublishReview, submitPageForReview, withdrawPageReview } from "./publishing";
import { docxToMarkdown, importMarkdownPage, MAX_IMPORT_CHARS, saveAsTemplate, setTemplateActive, templateContent } from "./templates";
import { createSpace, loadSpace, setSpaceAccess, setSpaceArchived, type SpaceRow, updateSpace } from "./spaces";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
// The editor posts the document as an object; a plain form posts it as JSON text.
const content = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}, z.record(z.string(), z.unknown()));
const accessRows = z.array(z.object({ subjectKey: z.string().max(80).refine((key) => parseSubjectKey(key) !== null), level: z.enum(ACCESS_LEVELS) })).max(100).default([]);

const auditSpace = (space: Pick<SpaceRow, "id" | "entityId">) => ({ type: "kb_space", id: space.id, entityId: space.entityId });
const auditPage = (loaded: { page: Pick<PageRow, "id">; space: Pick<SpaceRow, "entityId"> }) => ({ type: "kb_page", id: loaded.page.id, entityId: loaded.space.entityId });
const spaceFactsForAudit = (space: SpaceRow) => ({ key: space.key, name: space.name, kind: space.kind, entityId: space.entityId, sortOrder: space.sortOrder, archivedAt: space.archivedAt });
// What the audit log keeps of a page: what happened to it, none of the prose.
const pageFactsForAudit = (page: PageRow) => ({ title: page.title, status: page.status, parentId: page.parentId, sortOrder: page.sortOrder, publishedVersionId: page.publishedVersionId, hasUnpublishedChanges: page.hasUnpublishedChanges, ownerPersonId: page.ownerPersonId, reviewBy: page.reviewBy });

/** With the local fake there is no network call to wait for: a freshly published page is ready for retrieval at once. The real driver is the job's business. */
async function embedAfterPublish() {
  if (!embeddingDriver().isFake) return;
  await embedPendingChunks(500).catch(() => undefined);
}

function refresh(spaceKey?: string, pageId?: string) {
  revalidatePath("/kb", "layout");
  if (spaceKey) revalidatePath(`/kb/spaces/${spaceKey}`);
  if (pageId) revalidatePath(`/kb/pages/${pageId}`, "layout");
}

// `authorize` and `run` of one call look at the same page: loaded once per (user, page).
const pageCache = new WeakMap<CurrentUser, Map<string, Promise<LoadedPage | null>>>();
function pageFor(user: CurrentUser, pageId: string): Promise<LoadedPage | null> {
  const cache = pageCache.get(user) ?? new Map<string, Promise<LoadedPage | null>>();
  pageCache.set(user, cache);
  if (!cache.has(pageId)) cache.set(pageId, loadPage(pageId));
  return cache.get(pageId)!;
}
async function must(user: CurrentUser, pageId: string): Promise<LoadedPage> {
  const loaded = await pageFor(user, pageId);
  if (!loaded) throw new ActionError("kb_page_not_found");
  return loaded;
}

// ── Spaces ──────────────────────────────────────────────────────────────────────────────────

const spaceFields = {
  name: z.string().trim().min(1).max(120),
  description: optional(z.string().trim().max(500)),
  icon: optional(z.string().trim().max(8)),
  kind: z.enum(SPACE_KINDS),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
};

const createSpacePipeline = createAction({
  name: "kb.space.create",
  input: z.object({ key: z.string().trim().toLowerCase().regex(SPACE_KEY), entityId: optional(z.uuid()), ...spaceFields, access: accessRows }),
  authorize: (user, input) => canManageSpace(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const { access, ...values } = input;
    const space = await createSpace(values, user.person.id, access);
    refresh();
    return { data: { id: space.id, key: space.key }, audit: { resource: auditSpace(space), summary: space.name, after: { ...spaceFactsForAudit(space), access } } };
  },
});
export async function createSpaceAction(input: unknown) {
  return createSpacePipeline(input);
}

const managesSpace = async (user: CurrentUser, spaceId: string) => {
  const loaded = await loadSpace({ id: spaceId });
  return !!loaded && canManageSpace(user.principal, loaded.space);
};

const updateSpacePipeline = createAction({
  name: "kb.space.update",
  input: z.object({ spaceId: z.uuid(), ...spaceFields }),
  authorize: (user, input) => managesSpace(user, input.spaceId),
  run: async ({ input }) => {
    const { spaceId, ...values } = input;
    const { before, after } = await updateSpace(spaceId, values);
    refresh(after.key);
    return { data: { id: after.id }, audit: { resource: auditSpace(after), summary: after.name, before: spaceFactsForAudit(before), after: spaceFactsForAudit(after) } };
  },
});
export async function updateSpaceAction(input: unknown) {
  return updateSpacePipeline(input);
}

const archiveSpacePipeline = createAction({
  name: "kb.space.archive",
  input: z.object({ spaceId: z.uuid(), archived: checkbox }),
  authorize: (user, input) => managesSpace(user, input.spaceId),
  run: async ({ input }) => {
    const { before, after } = await setSpaceArchived(input.spaceId, input.archived);
    refresh(after.key);
    return { data: { id: after.id }, audit: { resource: auditSpace(after), summary: `${after.name}: ${input.archived ? "archived" : "restored"}`, before: spaceFactsForAudit(before), after: spaceFactsForAudit(after) } };
  },
});
export async function archiveSpaceAction(input: unknown) {
  return archiveSpacePipeline(input);
}

const spaceAccessPipeline = createAction({
  name: "kb.space.access",
  input: z.object({ spaceId: z.uuid(), access: accessRows }),
  authorize: (user, input) => managesSpace(user, input.spaceId),
  run: async ({ input }) => {
    const loaded = await loadSpace({ id: input.spaceId });
    if (!loaded) throw new ActionError("kb_space_not_found");
    const { before, after } = await setSpaceAccess(input.spaceId, input.access);
    refresh(loaded.space.key);
    return { data: { rows: after.length }, audit: { resource: auditSpace(loaded.space), summary: `${loaded.space.name}: access`, before: { access: before }, after: { access: after } } };
  },
});
export async function setSpaceAccessAction(input: unknown) {
  return spaceAccessPipeline(input);
}

// ── Pages ───────────────────────────────────────────────────────────────────────────────────

const title = z.string().trim().min(1).max(200);

const createPagePipeline = createAction({
  name: "kb.page.create",
  input: z.object({ spaceId: z.uuid(), parentId: optional(z.uuid()), title, content: content.optional(), templateId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const space = await loadSpace({ id: input.spaceId });
    if (!space) return false;
    const parent = input.parentId ? await pageFor(user, input.parentId) : null;
    if (input.parentId && (!parent || parent.page.spaceId !== input.spaceId)) return false;
    return canCreatePage(kbViewerOf(user), space.facts, parent?.pageFacts ?? null);
  },
  run: async ({ user, input }) => {
    const space = (await loadSpace({ id: input.spaceId }))!;
    const page = await createPage({ ...input, content: input.templateId ? await templateContent(input.templateId) : input.content }, { personId: user.person.id });
    refresh(space.space.key);
    return { data: { id: page.id }, audit: { resource: auditPage({ page, space: space.space }), summary: page.title, after: { ...pageFactsForAudit(page), templateId: input.templateId } } };
  },
});
export async function createPageAction(input: unknown) {
  return createPagePipeline(input);
}

const editsPage = async (user: CurrentUser, pageId: string) => {
  const loaded = await pageFor(user, pageId);
  return !!loaded && canEditPage(kbViewerOf(user), loaded.facts, loaded.pageFacts);
};
const organisesPage = async (user: CurrentUser, pageId: string) => {
  const loaded = await pageFor(user, pageId);
  return !!loaded && !loaded.page.deletedAt && canOrganisePages(kbViewerOf(user), loaded.facts);
};

const saveDraftPipeline = createAction({
  name: "kb.page.save",
  input: z.object({ pageId: z.uuid(), title, content }),
  authorize: (user, input) => editsPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await saveDraft(input.pageId, input, { personId: user.person.id });
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id, updatedAt: after.updatedAt.toISOString() }, audit: { resource: auditPage(loaded), summary: after.title, before: { title: before.title, characters: before.contentText.length }, after: { title: after.title, characters: after.contentText.length } } };
  },
});
export async function savePageDraftAction(input: unknown) {
  return saveDraftPipeline(input);
}

const publishPipeline = createAction({
  name: "kb.page.publish",
  // With a title and content the working copy is saved first: "Publish" in the editor is one click.
  input: z.object({ pageId: z.uuid(), title: title.optional(), content: content.optional(), changeNote: optional(z.string().trim().max(300)), isMajor: checkbox }),
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    return !!loaded && canPublishDirectly(kbViewerOf(user), loaded.facts, loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const actor = { personId: user.person.id };
    if (input.title !== undefined && input.content !== undefined) await saveDraft(input.pageId, { title: input.title, content: input.content }, actor);
    const { page, version, before } = await publishPage(input.pageId, actor, { changeNote: input.changeNote, isMajor: input.isMajor });
    await embedAfterPublish();
    refresh(loaded.space.key, page.id);
    return { data: { id: page.id, versionNo: version.versionNo }, audit: { resource: auditPage(loaded), summary: `${page.title}: v${version.versionNo}`, before: pageFactsForAudit(before), after: { ...pageFactsForAudit(page), versionNo: version.versionNo, isMajor: version.isMajor, changeNote: version.changeNote } } };
  },
});
export async function publishPageAction(input: unknown) {
  return publishPipeline(input);
}

// ── Review before publishing (controlled spaces) ────────────────────────────────────────────

const submitReviewPipeline = createAction({
  name: "kb.page.submit_review",
  input: z.object({ pageId: z.uuid(), title: title.optional(), content: content.optional(), changeNote: optional(z.string().trim().max(300)), isMajor: checkbox }),
  // Any editor of the page, in a controlled space. Whoever may publish directly has no need to ask.
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    return !!loaded && loaded.space.kind === "controlled" && canEditPage(kbViewerOf(user), loaded.facts, loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const draft = input.title !== undefined && input.content !== undefined ? { title: input.title, content: input.content } : undefined;
    const { page, requestId, resubmitted } = await submitPageForReview(input.pageId, { personId: user.person.id }, { changeNote: input.changeNote, isMajor: input.isMajor, draft });
    refresh(loaded.space.key, page.id);
    revalidatePath("/approvals");
    return { data: { id: page.id, requestId }, audit: { resource: auditPage(loaded), summary: `${page.title}: ${resubmitted ? "resubmitted for review" : "submitted for review"}`, before: { status: loaded.page.status }, after: { status: page.status, requestId, isMajor: input.isMajor, changeNote: input.changeNote } } };
  },
});
export async function submitPageReviewAction(input: unknown) {
  return submitReviewPipeline(input);
}

const decideReviewPipeline = createAction({
  name: "kb.page.review_decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: optional(z.string().trim().max(1000)) }),
  // Whose turn it is comes from the flow; the people asked hold `kb:manage` over the space (or are the owners).
  authorize: async (user, input) => !!(await getPublishReview({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome, page, version, payload } = await decidePageReview(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    if (outcome === "approved") await embedAfterPublish();
    refresh(undefined, payload.pageId);
    revalidatePath("/approvals");
    revalidatePath(`/approvals/kb-publish/${request.id}`);
    return { data: { outcome }, audit: { resource: { type: "kb_page", id: payload.pageId, entityId: request.entityId }, summary: `${input.decision}: ${payload.title}`, before: { status: before.status }, after: { status: request.status, requestId: request.id, pageStatus: page?.status ?? null, versionNo: version?.versionNo ?? null } } };
  },
});
export async function decidePageReviewAction(input: unknown) {
  return decideReviewPipeline(input);
}

const withdrawReviewPipeline = createAction({
  name: "kb.page.review_withdraw",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => {
    const view = await getPublishReview({ personId: user.person.id, principal: user.principal }, input.requestId);
    return !!view && view.isRequester && (view.request.status === "pending" || view.request.status === "returned");
  },
  run: async ({ user, input }) => {
    const { request, before, payload } = await withdrawPageReview(user.person.id, input.requestId);
    refresh(undefined, payload.pageId);
    revalidatePath("/approvals");
    revalidatePath(`/approvals/kb-publish/${request.id}`);
    return { data: { id: request.id }, audit: { resource: { type: "kb_page", id: payload.pageId, entityId: request.entityId }, summary: `withdrawn: ${payload.title}`, before: { status: before.status }, after: { status: request.status, requestId: request.id } } };
  },
});
export async function withdrawPageReviewAction(input: unknown) {
  return withdrawReviewPipeline(input);
}

const unpublishPipeline = createAction({
  name: "kb.page.unpublish",
  input: z.object({ pageId: z.uuid() }),
  // Taking a page away from readers is as weighty as giving it to them.
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    return !!loaded && canPublishDirectly(kbViewerOf(user), loaded.facts, loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await unpublishPage(input.pageId);
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id }, audit: { resource: auditPage(loaded), summary: `${after.title}: unpublished`, before: pageFactsForAudit(before), after: pageFactsForAudit(after) } };
  },
});
export async function unpublishPageAction(input: unknown) {
  return unpublishPipeline(input);
}

const archivePagePipeline = createAction({
  name: "kb.page.archive",
  input: z.object({ pageId: z.uuid(), archived: checkbox }),
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    // In a controlled space archiving hides a policy from its readers: the managers' call.
    return !!loaded && (loaded.pageFacts.readable || loaded.page.status === "archived" ? canPublishDirectly(kbViewerOf(user), loaded.facts, loaded.pageFacts) : canEditPage(kbViewerOf(user), loaded.facts, loaded.pageFacts));
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await setPageArchived(input.pageId, input.archived);
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id }, audit: { resource: auditPage(loaded), summary: `${after.title}: ${after.status}`, before: pageFactsForAudit(before), after: pageFactsForAudit(after) } };
  },
});
export async function archivePageAction(input: unknown) {
  return archivePagePipeline(input);
}

const deletePagePipeline = createAction({
  name: "kb.page.delete",
  input: z.object({ pageId: z.uuid() }),
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    if (!loaded) return false;
    // A page readers have seen goes the way it came; a draft is its editors' to throw away.
    return loaded.page.publishedVersionId ? canPublishDirectly(kbViewerOf(user), loaded.facts, loaded.pageFacts) && canOrganisePages(kbViewerOf(user), loaded.facts) : canEditPage(kbViewerOf(user), loaded.facts, loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const page = await deletePage(input.pageId);
    refresh(loaded.space.key, page.id);
    return { data: { spaceKey: loaded.space.key }, audit: { resource: auditPage(loaded), summary: `${page.title}: deleted`, before: pageFactsForAudit(loaded.page) } };
  },
});
export async function deletePageAction(input: unknown) {
  return deletePagePipeline(input);
}

const movePagePipeline = createAction({
  name: "kb.page.move",
  input: z.object({ pageId: z.uuid(), parentId: optional(z.uuid()), /** 1 = first among its new siblings; blank = last. */ position: optional(z.coerce.number().int().min(1).max(10_000)) }),
  authorize: (user, input) => organisesPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await movePage(input.pageId, { parentId: input.parentId, position: input.position === null ? null : input.position - 1 });
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id }, audit: { resource: auditPage(loaded), summary: `${after.title}: moved`, before: { parentId: before.parentId, sortOrder: before.sortOrder, accessRootId: before.accessRootId }, after: { parentId: after.parentId, sortOrder: after.sortOrder, accessRootId: after.accessRootId } } };
  },
});
export async function movePageAction(input: unknown) {
  return movePagePipeline(input);
}

const pageAccessPipeline = createAction({
  name: "kb.page.access",
  input: z.object({ pageId: z.uuid(), access: accessRows }),
  authorize: (user, input) => organisesPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await setPageAccess(input.pageId, input.access);
    refresh(loaded.space.key, loaded.page.id);
    return { data: { rows: after.length }, audit: { resource: auditPage(loaded), summary: `${loaded.page.title}: access`, before: { access: before }, after: { access: after } } };
  },
});
export async function setPageAccessAction(input: unknown) {
  return pageAccessPipeline(input);
}

const pageMetaPipeline = createAction({
  name: "kb.page.meta",
  input: z.object({ pageId: z.uuid(), ownerPersonId: optional(z.uuid()), reviewBy: optional(z.iso.date()) }),
  authorize: (user, input) => editsPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await setPageMeta(input.pageId, { ownerPersonId: input.ownerPersonId, reviewBy: input.reviewBy });
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id }, audit: { resource: auditPage(loaded), summary: `${after.title}: owner / review date`, before: pageFactsForAudit(before), after: pageFactsForAudit(after) } };
  },
});
export async function setPageMetaAction(input: unknown) {
  return pageMetaPipeline(input);
}

const restorePipeline = createAction({
  name: "kb.page.restore_version",
  input: z.object({ pageId: z.uuid(), versionNo: z.coerce.number().int().min(1) }),
  authorize: (user, input) => editsPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after } = await restoreVersion(input.pageId, input.versionNo, { personId: user.person.id });
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id }, audit: { resource: auditPage(loaded), summary: `${after.title}: v${input.versionNo} restored to the working copy`, before: { title: before.title }, after: { title: after.title, restoredVersionNo: input.versionNo } } };
  },
});
export async function restoreVersionAction(input: unknown) {
  return restorePipeline(input);
}

// ── Files (platform files module; signed-URL upload) ────────────────────────────────────────

const actorOf = (user: CurrentUser) => ({ personId: user.person.id, email: user.email });

const beginUploadPipeline = createAction({
  name: "kb.page.file_begin",
  input: z.object({ pageId: z.uuid(), fileName: z.string().min(1).max(300), sizeBytes: z.coerce.number().int().min(1) }),
  authorize: (user, input) => editsPage(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const upload = await beginPageUpload(loaded, input, actorOf(user));
    return { data: upload, audit: { resource: auditPage(loaded), summary: input.fileName, after: { fileId: upload.fileId, fileName: input.fileName, sizeBytes: input.sizeBytes } } };
  },
});
export async function beginPageUploadAction(input: unknown) {
  return beginUploadPipeline(input);
}

const completeUploadPipeline = createAction({
  name: "kb.page.file_complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findPageFile(input.fileId, { pending: true });
    return !!found && found.file.uploadedByPersonId === user.person.id && canEditPage(kbViewerOf(user), found.loaded.facts, found.loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const found = await findPageFile(input.fileId, { pending: true });
    if (!found) throw new ActionError("file_not_found");
    const file = await completePageUpload(input.fileId, actorOf(user));
    return { data: { fileId: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, contentType: file.contentType }, audit: { resource: auditPage(found.loaded), summary: file.fileName, after: { fileId: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes } } };
  },
});
export async function completePageUploadAction(input: unknown) {
  return completeUploadPipeline(input);
}

const removeFilePipeline = createAction({
  name: "kb.page.file_remove",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findPageFile(input.fileId);
    return !!found && canEditPage(kbViewerOf(user), found.loaded.facts, found.loaded.pageFacts);
  },
  run: async ({ input }) => {
    const found = await findPageFile(input.fileId);
    if (!found) throw new ActionError("file_not_found");
    const file = await removePageFile(input.fileId);
    refresh(found.loaded.space.key, found.loaded.page.id);
    return { data: { fileId: file.id }, audit: { resource: auditPage(found.loaded), summary: `${file.fileName}: removed`, before: { fileId: file.id, fileName: file.fileName } } };
  },
});
export async function removePageFileAction(input: unknown) {
  return removeFilePipeline(input);
}

// ── Policy acknowledgement (FR-KB-05) ───────────────────────────────────────────────────────

const managesPageSpace = async (user: CurrentUser, pageId: string) => {
  const loaded = await pageFor(user, pageId);
  return !!loaded && !loaded.page.deletedAt && canManageSpace(user.principal, loaded.space);
};

const ackSettingsPipeline = createAction({
  name: "kb.page.ack_settings",
  input: z.object({ pageId: z.uuid(), required: checkbox, dueDays: z.coerce.number().int().min(1).max(365).default(14), audience: z.array(z.string().max(80).refine((key) => parseSubjectKey(key) !== null)).max(100).default([]) }),
  // Who must read what is the space's managers' call, not an editor's.
  authorize: (user, input) => managesPageSpace(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { before, after, audienceBefore, audience, notified } = await setAckRequirement(input.pageId, input);
    refresh(loaded.space.key, after.id);
    return { data: { id: after.id, notified }, audit: { resource: auditPage(loaded), summary: `${after.title}: must read ${after.ackRequired ? "on" : "off"}`, before: { ackRequired: before.ackRequired, ackDueDays: before.ackDueDays, audience: audienceBefore }, after: { ackRequired: after.ackRequired, ackDueDays: after.ackDueDays, ackVersionId: after.ackVersionId, audience, notified } } };
  },
});
export async function setAckRequirementAction(input: unknown) {
  return ackSettingsPipeline(input);
}

const acknowledgePipeline = createAction({
  name: "kb.page.acknowledge",
  input: z.object({ pageId: z.uuid() }),
  // Reading comes first: someone who cannot open the page cannot confirm it. Whether they are in the audience is the use-case's question.
  authorize: async (user, input) => {
    const loaded = await pageFor(user, input.pageId);
    return !!loaded && canViewPage(kbViewerOf(user), loaded.facts, loaded.pageFacts);
  },
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { versionId, acknowledgedAt, already } = await acknowledgePage(input.pageId, user.person.id);
    refresh(loaded.space.key, input.pageId);
    revalidatePath("/home");
    return { data: { acknowledgedAt: acknowledgedAt.toISOString(), already }, audit: { resource: auditPage(loaded), summary: `${loaded.page.publishedTitle ?? loaded.page.title}: acknowledged${already ? " (again)" : ""}`, after: { versionId, personId: user.person.id, acknowledgedAt: acknowledgedAt.toISOString() } } };
  },
});
export async function acknowledgePageAction(input: unknown) {
  return acknowledgePipeline(input);
}

const remindAckPipeline = createAction({
  name: "kb.page.ack_remind",
  input: z.object({ pageId: z.uuid() }),
  authorize: (user, input) => managesPageSpace(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const { reminded, pending } = await remindPendingNow(input.pageId);
    refresh(loaded.space.key, input.pageId);
    return { data: { reminded, pending }, audit: { resource: auditPage(loaded), summary: `${loaded.page.title}: reminded ${reminded} of ${pending} pending`, after: { reminded, pending } } };
  },
});
export async function remindAckAction(input: unknown) {
  return remindAckPipeline(input);
}

const exportAckPipeline = createAction({
  name: "kb.page.ack_export",
  input: z.object({ pageId: z.uuid() }),
  authorize: (user, input) => managesPageSpace(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const report = await getAckReport(loaded.page);
    const date = (value: Date | null) => (value ? value.toISOString().slice(0, 16).replace("T", " ") : "");
    const csv = toCsv(
      [
        { header: "Họ tên", value: (row) => row.fullName },
        { header: "Pháp nhân", value: (row) => row.entityName },
        { header: "Phòng ban", value: (row) => row.departmentName },
        { header: "Đã xác nhận (UTC)", value: (row) => date(row.acknowledgedAt) },
        { header: "Hạn", value: (row) => row.dueOn },
        { header: "Quá hạn", value: (row) => (row.overdue ? "x" : "") },
        { header: "Số lần nhắc", value: (row) => row.notices },
      ],
      report.rows,
    );
    return { data: { fileName: `xac-nhan-${loaded.page.id.slice(0, 8)}.csv`, csv, rowCount: report.rows.length }, audit: { resource: auditPage(loaded), summary: `${loaded.page.title}: acknowledgement export, ${report.rows.length} rows`, after: { rows: report.rows.length, versionNo: report.versionNo } } };
  },
});
export async function exportAckReportAction(input: unknown) {
  return exportAckPipeline(input);
}

// ── Templates and imports (FR-KB-09, 10) ────────────────────────────────────────────────────

const mayCreateIn = async (user: CurrentUser, spaceId: string, parentId: string | null) => {
  const space = await loadSpace({ id: spaceId });
  if (!space || space.space.archivedAt) return false;
  const parent = parentId ? await pageFor(user, parentId) : null;
  if (parentId && (!parent || parent.page.spaceId !== spaceId)) return false;
  return canCreatePage(kbViewerOf(user), space.facts, parent?.pageFacts ?? null);
};

const importMarkdownPipeline = createAction({
  name: "kb.page.import_markdown",
  input: z.object({ spaceId: z.uuid(), parentId: optional(z.uuid()), title: optional(z.string().trim().max(200)), markdown: z.string().min(1).max(MAX_IMPORT_CHARS), fileName: optional(z.string().trim().max(200)) }),
  authorize: (user, input) => mayCreateIn(user, input.spaceId, input.parentId),
  run: async ({ user, input }) => {
    const space = (await loadSpace({ id: input.spaceId }))!;
    const { page, titleFrom } = await importMarkdownPage(input, { personId: user.person.id });
    refresh(space.space.key);
    return { data: { id: page.id }, audit: { resource: auditPage({ page, space: space.space }), summary: `${page.title}: imported from Markdown`, after: { ...pageFactsForAudit(page), source: "markdown", fileName: input.fileName, titleFrom, characters: page.contentText.length } } };
  },
});
export async function importMarkdownAction(input: unknown) {
  return importMarkdownPipeline(input);
}

const DOCX_MAX_BYTES = 3_500_000;
const docxForm = z.instanceof(FormData).transform((form, context) => {
  const file = form.get("file");
  const fields = z.object({ spaceId: z.uuid(), parentId: optional(z.uuid()), title: optional(z.string().trim().max(200)) }).safeParse(Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")));
  if (!(file instanceof File) || !fields.success) {
    context.addIssue({ code: "custom", message: "invalid", path: [file instanceof File ? "fields" : "file"] });
    return z.NEVER;
  }
  return { file, ...fields.data };
});

const importDocxPipeline = createAction({
  name: "kb.page.import_docx",
  input: docxForm,
  authorize: (user, input) => mayCreateIn(user, input.spaceId, input.parentId),
  run: async ({ user, input }) => {
    const { file } = input;
    if (!/\.docx$/i.test(file.name)) throw new ActionError("file_type_not_allowed");
    if (file.size === 0) throw new ActionError("file_empty");
    if (file.size > DOCX_MAX_BYTES) throw new ActionError("file_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A .docx is a zip: a renamed something-else stops here.
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw new ActionError("file_content_mismatch");
    const markdown = await docxToMarkdown(bytes);
    const space = (await loadSpace({ id: input.spaceId }))!;
    const { page, titleFrom } = await importMarkdownPage({ spaceId: input.spaceId, parentId: input.parentId, title: input.title, markdown, fileName: file.name }, { personId: user.person.id });
    refresh(space.space.key);
    return { data: { id: page.id }, audit: { resource: auditPage({ page, space: space.space }), summary: `${page.title}: imported from Word`, after: { ...pageFactsForAudit(page), source: "docx", fileName: file.name, titleFrom, characters: page.contentText.length } } };
  },
});
export async function importDocxAction(input: unknown) {
  return importDocxPipeline(input);
}

const saveTemplatePipeline = createAction({
  name: "kb.template.create",
  input: z.object({ pageId: z.uuid(), name: z.string().trim().min(1).max(120), description: optional(z.string().trim().max(300)) }),
  // Templates are offered to everybody who writes: keeping them is the KB managers' job.
  authorize: (user, input) => managesPageSpace(user, input.pageId),
  run: async ({ user, input }) => {
    const loaded = await must(user, input.pageId);
    const template = await saveAsTemplate({ name: input.name, description: input.description, content: loaded.page.content }, { personId: user.person.id });
    return { data: { id: template.id }, audit: { resource: { type: "kb_template", id: template.id, entityId: null }, summary: template.name, after: { key: template.key, name: template.name, fromPageId: loaded.page.id } } };
  },
});
export async function savePageAsTemplateAction(input: unknown) {
  return saveTemplatePipeline(input);
}

const templateActivePipeline = createAction({
  name: "kb.template.set_active",
  input: z.object({ templateId: z.uuid(), isActive: z.boolean() }),
  authorize: (user) => canManageSpace(user.principal, { entityId: null }),
  run: async ({ input }) => {
    const { before, after } = await setTemplateActive(input.templateId, input.isActive);
    return { data: { id: after.id }, audit: { resource: { type: "kb_template", id: after.id, entityId: null }, summary: `${after.name}: ${after.isActive ? "on" : "off"}`, before: { isActive: before.isActive }, after: { isActive: after.isActive } } };
  },
});
export async function setTemplateActiveAction(input: unknown) {
  return templateActivePipeline(input);
}
