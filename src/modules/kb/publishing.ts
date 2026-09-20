// Review before publishing (FR-KB-04): in a controlled space an editor's revision goes to the
// space's KB managers through the approval engine. While it waits the working copy is frozen
// (`saveDraft` refuses a page that is `in_review`), so what reviewers read is what gets published.
// Approved → `publishPage` in the same transaction. Rejected, returned or withdrawn → the page is
// the editor's again; after a return the next submission goes round on the same request.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestView, resubmitRequest, submitRequest, withdrawRequest } from "../platform/approvals/service";
import { can, type Principal } from "../platform/rbac/policy";
import { type DiffLine, diffLines } from "./engine/diff";
import type { Doc } from "./engine/doc";
import { type PageRow, type PageVersionRow, publishPage, saveDraft } from "./pages";

export type PublishReviewPayload = { pageId: string; spaceId: string; title: string; changeNote: string | null; isMajor: boolean };

export const kbPublishRequest = defineRequestType({
  type: "kb_publish",
  // The KB managers whose grant covers the space's entity; the engine falls back to the owners.
  flow: { steps: [{ key: "review", mode: "any", approvers: [{ rule: "permission", permission: "kb:manage" }] }] },
  // Reviewing means reading the revision: never from the inbox with a tick.
  bulkApprovable: () => false,
  // Group-wide KB managers follow every review; an entity's managers are asked, so they are parties anyway.
  canView: (viewer) => can(viewer, "kb:manage", {}),
});

const restingStatus = (page: Pick<PageRow, "publishedVersionId">): PageRow["status"] => (page.publishedVersionId ? "published" : "draft");
const summaryOf = (title: string, changeNote: string | null, isMajor: boolean) => `${title}${isMajor ? " (thay đổi lớn)" : ""}${changeNote ? ` — ${changeNote}` : ""}`.slice(0, 300);

export type SubmitReviewInput = { changeNote: string | null; isMajor: boolean; /** Saved first, so "Submit for review" in the editor is one click. */ draft?: { title: string; content: unknown } };

export async function submitPageForReview(pageId: string, actor: { personId: string }, input: SubmitReviewInput): Promise<{ page: PageRow; requestId: string; resubmitted: boolean }> {
  if (input.draft) await saveDraft(pageId, input.draft, actor);
  return db().transaction(async (tx) => {
    const [page] = await tx.select().from(schema.kbPage).where(and(eq(schema.kbPage.id, pageId), isNull(schema.kbPage.deletedAt))).limit(1).for("update");
    if (!page) throw new ActionError("kb_page_not_found");
    if (page.status === "in_review") throw new ActionError("kb_page_in_review");
    if (page.status === "archived") throw new ActionError("kb_page_archived");
    if (page.publishedVersionId && !page.hasUnpublishedChanges) throw new ActionError("kb_nothing_to_publish");
    const [space] = await tx.select().from(schema.kbSpace).where(eq(schema.kbSpace.id, page.spaceId)).limit(1);
    const payload: PublishReviewPayload = { pageId, spaceId: page.spaceId, title: page.title, changeNote: input.changeNote?.trim() || null, isMajor: input.isMajor };
    const summary = summaryOf(page.title, payload.changeNote, payload.isMajor);

    // After "return for changes" the same person sends the same request round again.
    const [returned] = page.reviewRequestId ? await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, page.reviewRequestId), eq(schema.approvalRequest.status, "returned"), eq(schema.approvalRequest.requesterPersonId, actor.personId))).limit(1) : [];
    let requestId: string;
    if (returned) {
      await resubmitRequest(tx, kbPublishRequest, returned.id, actor.personId, { summary, payload });
      requestId = returned.id;
    } else {
      const { request, outcome } = await submitRequest(tx, kbPublishRequest, { entityId: space?.entityId ?? null, requesterPersonId: actor.personId, subjectPersonId: null, subjectType: "kb_page", subjectId: pageId, summary, payload, link: (id) => `/approvals/kb-publish/${id}`, target: { entityId: space?.entityId ?? null } });
      // A flow configured with no step that applies approves at once: publish now.
      if (outcome === "approved") {
        const published = await publishPage(pageId, actor, { changeNote: payload.changeNote, isMajor: payload.isMajor, approvalRequestId: request.id }, tx);
        return { page: published.page, requestId: request.id, resubmitted: false };
      }
      requestId = request.id;
    }
    const [after] = await tx.update(schema.kbPage).set({ status: "in_review", reviewRequestId: requestId, updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
    return { page: after, requestId, resubmitted: !!returned };
  });
}

export async function decidePageReview(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, kbPublishRequest, requestId, actorPersonId, decision);
    const payload = request.payload as PublishReviewPayload;
    let version: PageVersionRow | null = null;
    let page: PageRow | null = null;
    if (outcome === "approved") {
      ({ page, version } = await publishPage(payload.pageId, { personId: actorPersonId }, { changeNote: payload.changeNote, isMajor: payload.isMajor, approvalRequestId: request.id, authorPersonId: request.requesterPersonId }, tx));
      await tx.update(schema.kbPage).set({ reviewRequestId: null }).where(eq(schema.kbPage.id, payload.pageId));
    } else if (outcome === "rejected" || outcome === "returned") {
      page = await releasePage(tx, payload.pageId, request.id, outcome === "returned");
    }
    return { request, before, outcome, page, version, payload };
  });
}

/** The page is the editor's again. `keepRequest`: a returned request is resubmitted, not replaced. */
async function releasePage(tx: Tx, pageId: string, requestId: string, keepRequest: boolean): Promise<PageRow | null> {
  const [page] = await tx.select().from(schema.kbPage).where(eq(schema.kbPage.id, pageId)).limit(1).for("update");
  if (!page || page.reviewRequestId !== requestId) return page ?? null;
  const [after] = await tx.update(schema.kbPage).set({ status: page.status === "in_review" ? restingStatus(page) : page.status, reviewRequestId: keepRequest ? requestId : null, updatedAt: new Date() }).where(eq(schema.kbPage.id, pageId)).returning();
  return after;
}

export async function withdrawPageReview(actorPersonId: string, requestId: string) {
  return db().transaction(async (tx) => {
    const { request, before } = await withdrawRequest(tx, requestId, actorPersonId);
    if (request.type !== kbPublishRequest.type) throw new ActionError("approval_not_found");
    const payload = request.payload as PublishReviewPayload;
    const page = await releasePage(tx, payload.pageId, request.id, false);
    return { request, before, page, payload };
  });
}

/**
 * The engine's own "withdraw" knows nothing of pages: a page whose request is no longer pending
 * (or returned) is released the next time someone opens it.
 */
export async function syncReviewState(page: Pick<PageRow, "id" | "status" | "reviewRequestId">): Promise<boolean> {
  if (!page.reviewRequestId && page.status !== "in_review") return false;
  return db().transaction(async (tx) => {
    const [request] = page.reviewRequestId ? await tx.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, page.reviewRequestId)).limit(1) : [];
    if (request?.status === "pending" || (request?.status === "returned" && page.status !== "in_review")) return false;
    const [current] = await tx.select().from(schema.kbPage).where(eq(schema.kbPage.id, page.id)).limit(1).for("update");
    if (!current) return false;
    await tx.update(schema.kbPage).set({ status: current.status === "in_review" ? restingStatus(current) : current.status, reviewRequestId: request?.status === "returned" ? current.reviewRequestId : null }).where(eq(schema.kbPage.id, page.id));
    return true;
  });
}

export type PublishReviewView = RequestView & { payload: PublishReviewPayload; page: PageRow | null; spaceName: string | null; spaceKey: string | null; /** What is being reviewed: the frozen working copy while pending, else the version it became. */ submitted: { title: string; content: Doc } | null; diff: { fromVersionNo: number | null; lines: DiffLine[] } | null };

export async function getPublishReview(viewer: { personId: string; principal: Principal }, requestId: string): Promise<PublishReviewView | null> {
  const view = await getRequest(viewer, kbPublishRequest, requestId);
  if (!view) return null;
  const payload = view.request.payload as PublishReviewPayload;
  const [row] = await db().select({ page: schema.kbPage, spaceName: schema.kbSpace.name, spaceKey: schema.kbSpace.key }).from(schema.kbPage).innerJoin(schema.kbSpace, eq(schema.kbSpace.id, schema.kbPage.spaceId)).where(eq(schema.kbPage.id, payload.pageId)).limit(1);
  const page = row?.page ?? null;
  let submitted: PublishReviewView["submitted"] = null;
  let diff: PublishReviewView["diff"] = null;
  if (page && (view.request.status === "pending" || view.request.status === "returned") && page.reviewRequestId === view.request.id) {
    submitted = { title: page.title, content: page.content as Doc };
    const [published] = page.publishedVersionId ? await db().select().from(schema.kbPageVersion).where(eq(schema.kbPageVersion.id, page.publishedVersionId)).limit(1) : [];
    diff = { fromVersionNo: published?.versionNo ?? null, lines: diffLines(published?.contentText ?? "", page.contentText) };
  } else if (page && view.request.status === "approved") {
    const [version] = await db().select().from(schema.kbPageVersion).where(and(eq(schema.kbPageVersion.pageId, page.id), eq(schema.kbPageVersion.approvalRequestId, view.request.id))).limit(1);
    if (version) {
      submitted = { title: version.title, content: version.content as Doc };
      const [previous] = await db().select().from(schema.kbPageVersion).where(and(eq(schema.kbPageVersion.pageId, page.id), eq(schema.kbPageVersion.versionNo, version.versionNo - 1))).limit(1);
      diff = { fromVersionNo: previous?.versionNo ?? null, lines: diffLines(previous?.contentText ?? "", version.contentText) };
    }
  }
  return { ...view, payload, page, spaceName: row?.spaceName ?? null, spaceKey: row?.spaceKey ?? null, submitted, diff };
}
