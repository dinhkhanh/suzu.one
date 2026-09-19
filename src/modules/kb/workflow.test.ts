// Week-2 use-cases against a real Postgres (PGlite): review before publishing, acknowledgement,
// search, chunks and retrieval. People hold real role rows here: the approval engine reads them.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { doc, heading, paragraph } from "./engine/build";
import { createPage, loadPage, publishPage, saveDraft } from "./pages";
import { type KbViewer, viewerKeys } from "./policy";
import { decidePageReview, getPublishReview, submitPageForReview, syncReviewState, withdrawPageReview } from "./publishing";
import { createSpace } from "./spaces";

type Who = "owner" | "hrGroup" | "hrSzm" | "editor" | "huy" | "khoi" | "ngo";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des", string>;
const viewers = {} as Record<Who, KbViewer>;
const spaces = {} as Record<"handbook" | "szmHr" | "tools", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const body = (title: string, text: string) => doc(heading(1, title), paragraph(text));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.department).values({ code: "DES", name: "Design" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id });

  const people: [Who, string, string, Grant["role"] | null, "group" | "entity" | null, "employee" | "collaborator"][] = [
    ["owner", szm.id, vid.id, "owner", "group", "employee"],
    ["hrGroup", szm.id, vid.id, "hr_admin", "group", "employee"],
    ["hrSzm", szm.id, vid.id, "hr_staff", "entity", "employee"],
    ["editor", szm.id, vid.id, null, null, "employee"],
    ["huy", szm.id, vid.id, null, null, "employee"],
    ["khoi", szc.id, des.id, null, null, "employee"],
    ["ngo", szm.id, vid.id, null, null, "collaborator"],
  ];
  for (const [key, entityId, departmentId, role, scope, workforceType] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType, primaryEntityId: entityId, departmentId }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : { type: "entity", id: entityId } }] : [];
    if (role) await db().insert(schema.roleAssignment).values({ personId: row.id, role, scopeType: scope!, scopeId: scope === "entity" ? entityId : null, validFrom: "2024-01-01" });
    const principal: Principal = { personId: row.id, workforceType, grants };
    viewers[key] = { principal, personId: row.id, keys: viewerKeys(principal, { entityId, departmentId, teamId: null }) };
  }

  const make = async (key: string, over: { entityId?: string | null; kind?: "open" | "controlled" }, access: { subjectKey: string; level: "view" | "edit" }[]) =>
    (await createSpace({ key, name: key, description: null, icon: null, entityId: over.entityId ?? null, kind: over.kind ?? "open", sortOrder: 0 }, ids.owner, access)).id;
  spaces.handbook = await make("handbook", { kind: "controlled" }, [{ subjectKey: "all", level: "view" }, { subjectKey: `person:${ids.editor}`, level: "edit" }]);
  spaces.szmHr = await make("szm-hr", { entityId: szm.id, kind: "controlled" }, [{ subjectKey: `entity:${szm.id}`, level: "view" }, { subjectKey: `person:${ids.editor}`, level: "edit" }]);
  spaces.tools = await make("tools", {}, [{ subjectKey: "all", level: "edit" }]);
});

describe("review before publishing", () => {
  const asViewer = (who: Who) => ({ personId: ids[who], principal: viewers[who].principal });

  it("asks the KB managers whose grant covers the space, freezes the working copy and publishes on approval", async () => {
    const page = await createPage({ spaceId: spaces.szmHr, parentId: null, title: "Nội quy SZM", content: body("Nội quy SZM", "Bản đầu tiên.") }, { personId: ids.editor });
    const { requestId, page: waiting } = await submitPageForReview(page.id, { personId: ids.editor }, { changeNote: "Bản đầu", isMajor: true });
    expect(waiting.status).toBe("in_review");
    const assignees = await db().select({ id: schema.approvalAssignee.approverPersonId }).from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, requestId));
    // The entity's HR staff and the group's HR admin; the owners only when there is nobody else.
    expect(assignees.map((row) => row.id).sort()).toEqual([ids.hrGroup, ids.hrSzm].sort());

    expect(await fails(saveDraft(page.id, { title: "x", content: body("x", "y") }, { personId: ids.editor }))).toBe("kb_page_in_review");
    expect(await fails(publishPage(page.id, { personId: ids.hrSzm }))).toBe("kb_page_in_review");
    expect(await fails(submitPageForReview(page.id, { personId: ids.editor }, { changeNote: null, isMajor: false }))).toBe("kb_page_in_review");
    // Its requester cannot answer it; someone who is not asked cannot either.
    expect(await fails(decidePageReview(ids.editor, requestId, { action: "approve", comment: null }))).toBe("approval_own_request");
    expect(await fails(decidePageReview(ids.huy, requestId, { action: "approve", comment: null }))).toBe("approval_not_assignee");

    const review = await getPublishReview(asViewer("hrSzm"), requestId);
    expect(review?.canDecide).toBe(true);
    expect(review?.diff?.fromVersionNo).toBeNull();
    expect(review?.diff?.lines.some((line) => line.type === "added" && line.text.includes("Bản đầu tiên"))).toBe(true);
    expect(await getPublishReview(asViewer("huy"), requestId)).toBeNull();

    const { outcome, version } = await decidePageReview(ids.hrSzm, requestId, { action: "approve", comment: null });
    expect(outcome).toBe("approved");
    // The revision is its author's, whoever let it through.
    expect(version).toMatchObject({ versionNo: 1, isMajor: true, authorPersonId: ids.editor, approvalRequestId: requestId, changeNote: "Bản đầu" });
    const after = (await loadPage(page.id))!.page;
    expect(after).toMatchObject({ status: "published", reviewRequestId: null, hasUnpublishedChanges: false });
  });

  it("gives the page back on a return, resubmits on the same request, and on a rejection keeps what was published", async () => {
    const page = await createPage({ spaceId: spaces.handbook, parentId: null, title: "Quy tắc ứng xử", content: body("Quy tắc ứng xử", "Bản 1.") }, { personId: ids.hrGroup });
    await publishPage(page.id, { personId: ids.hrGroup });
    await saveDraft(page.id, { title: "Quy tắc ứng xử", content: body("Quy tắc ứng xử", "Bản 2 còn thiếu.") }, { personId: ids.editor });
    const first = await submitPageForReview(page.id, { personId: ids.editor }, { changeNote: "Bổ sung", isMajor: false });
    // A group space: the group's HR admin, not the entity's HR staff.
    const assignees = await db().select({ id: schema.approvalAssignee.approverPersonId }).from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, first.requestId));
    expect(assignees.map((row) => row.id)).toEqual([ids.hrGroup]);

    expect(await fails(decidePageReview(ids.hrGroup, first.requestId, { action: "return", comment: null }))).toBe("approval_comment_required");
    await decidePageReview(ids.hrGroup, first.requestId, { action: "return", comment: "Thiếu mục 3" });
    expect((await loadPage(page.id))!.page).toMatchObject({ status: "published", reviewRequestId: first.requestId, hasUnpublishedChanges: true });

    const second = await submitPageForReview(page.id, { personId: ids.editor }, { changeNote: "Đủ mục 3", isMajor: false, draft: { title: "Quy tắc ứng xử", content: body("Quy tắc ứng xử", "Bản 2 đầy đủ.") } });
    expect(second).toMatchObject({ requestId: first.requestId, resubmitted: true });
    const review = await getPublishReview(asViewer("hrGroup"), first.requestId);
    expect(review?.diff?.fromVersionNo).toBe(1);
    expect(review?.payload.changeNote).toBe("Đủ mục 3");

    await decidePageReview(ids.hrGroup, first.requestId, { action: "reject", comment: "Chưa phù hợp" });
    const rejected = (await loadPage(page.id))!.page;
    expect(rejected).toMatchObject({ status: "published", reviewRequestId: null, hasUnpublishedChanges: true });
    const [published] = await db().select().from(schema.kbPageVersion).where(eq(schema.kbPageVersion.id, rejected.publishedVersionId!));
    expect(published.contentText).toContain("Bản 1.");
  });

  it("releases the page when the requester withdraws — through the KB or through the engine's own withdraw", async () => {
    const page = await createPage({ spaceId: spaces.handbook, parentId: null, title: "Làm việc từ xa", content: body("Làm việc từ xa", "Nháp.") }, { personId: ids.editor });
    const { requestId } = await submitPageForReview(page.id, { personId: ids.editor }, { changeNote: null, isMajor: false });
    expect(await fails(withdrawPageReview(ids.huy, requestId))).toBe("approval_not_requester");
    await withdrawPageReview(ids.editor, requestId);
    expect((await loadPage(page.id))!.page).toMatchObject({ status: "draft", reviewRequestId: null });

    const again = await submitPageForReview(page.id, { personId: ids.editor }, { changeNote: null, isMajor: false });
    expect(again.requestId).not.toBe(requestId);
    const { withdrawRequest } = await import("../platform/approvals/service");
    await db().transaction((tx) => withdrawRequest(tx, again.requestId, ids.editor));
    const stale = (await loadPage(page.id))!.page;
    expect(stale.status).toBe("in_review");
    expect(await syncReviewState(stale)).toBe(true);
    expect((await loadPage(page.id))!.page).toMatchObject({ status: "draft", reviewRequestId: null });
  });
});
