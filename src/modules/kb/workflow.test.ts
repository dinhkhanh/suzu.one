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
import { acknowledgePage, getAckReport, getAckStatus, listMyAcknowledgements, listMyPendingAcks, remindPendingNow, sendAckReminders, sendReviewDueNotices, setAckRequirement } from "./acknowledgements";
import { doc, heading, paragraph } from "./engine/build";
import { createPage, loadPage, publishPage, saveDraft, setPageAccess, setPageMeta } from "./pages";
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

describe("policy acknowledgement", () => {
  const notices = async (kind: string, personId?: string) => (await db().select().from(schema.notification).where(eq(schema.notification.kind, kind))).filter((row) => !personId || row.recipientPersonId === personId).length;
  let policy = "";

  it("asks the audience when switched on — staff by 'all', a collaborator only by name — and never someone who cannot open the page", async () => {
    const page = await createPage({ spaceId: spaces.handbook, parentId: null, title: "Bảo mật thông tin", content: body("Bảo mật thông tin", "Không chia sẻ mật khẩu.") }, { personId: ids.hrGroup });
    policy = page.id;
    expect(await fails(setAckRequirement(policy, { required: true, dueDays: 14, audience: [] }))).toBe("kb_ack_audience_required");
    expect(await fails(setAckRequirement(policy, { required: true, dueDays: 14, audience: ["role:hr_staff"] }))).toBe("kb_subject_unknown");

    // Not published yet: nothing to confirm, nobody is told.
    const early = await setAckRequirement(policy, { required: true, dueDays: 14, audience: ["all", `person:${ids.ngo}`] });
    expect(early).toMatchObject({ notified: 0, after: { ackRequired: true, ackVersionId: null } });
    const { page: published, version } = await publishPage(policy, { personId: ids.hrGroup });
    expect(published.ackVersionId).toBe(version.id);
    // Six staff; the collaborator is named but cannot open the handbook, so is not nagged.
    expect(await notices("kb.ack_requested")).toBe(6);
    expect(await notices("kb.ack_requested", ids.ngo)).toBe(0);

    expect((await listMyPendingAcks(viewers.huy)).map((row) => row.pageId)).toEqual([policy]);
    expect(await listMyPendingAcks(viewers.ngo)).toEqual([]);
    const report = await getAckReport(published);
    expect(report).toMatchObject({ versionNo: 1, total: 7, done: 0 });
    expect(report.byEntity).toEqual([{ name: "Creative", total: 1, done: 0 }, { name: "Media", total: 6, done: 0 }]);
  });

  it("confirms once, only for the audience, and reports it", async () => {
    const first = await acknowledgePage(policy, ids.huy);
    const again = await acknowledgePage(policy, ids.huy);
    expect(first.already).toBe(false);
    expect(again).toMatchObject({ already: true, acknowledgedAt: first.acknowledgedAt });
    const loaded = (await loadPage(policy))!.page;
    expect(await getAckStatus(loaded, ids.huy)).toMatchObject({ inAudience: true, versionNo: 1, overdue: false });
    expect((await getAckStatus(loaded, ids.huy)).acknowledgedAt).not.toBeNull();
    expect(await listMyPendingAcks(viewers.huy)).toEqual([]);
    expect((await listMyAcknowledgements(ids.huy))[0]).toMatchObject({ pageId: policy, versionNo: 1, current: true });

    await setAckRequirement(policy, { required: true, dueDays: 14, audience: [`entity:${ids.szm}`] });
    expect(await fails(acknowledgePage(policy, ids.khoi))).toBe("kb_ack_not_in_audience");
    expect((await getAckReport((await loadPage(policy))!.page)).total).toBe(5);
    await setAckRequirement(policy, { required: true, dueDays: 14, audience: ["all"] });
    // A confirmation is evidence: the database keeps it as it is.
    await expect(db().delete(schema.kbAcknowledgement)).rejects.toThrow();
    await expect(db().update(schema.kbAcknowledgement).set({ acknowledgedAt: new Date() })).rejects.toThrow();
  });

  it("reminds every three days, once a day at most, with the overdue wording after the due date", async () => {
    const today = (await import("@/lib/dates")).todayInVietnam();
    const { addDays } = await import("@/lib/dates");
    expect(await sendAckReminders(today)).toMatchObject({ requested: 0, reminded: 0 });
    expect(await sendAckReminders(addDays(today, 2))).toMatchObject({ reminded: 0 });
    // Five staff still pending (huy confirmed).
    expect(await sendAckReminders(addDays(today, 3))).toMatchObject({ reminded: 5 });
    expect(await sendAckReminders(addDays(today, 3))).toMatchObject({ reminded: 0 });
    expect(await remindPendingNow(policy, addDays(today, 3))).toMatchObject({ reminded: 0, pending: 5 });
    expect(await remindPendingNow(policy, addDays(today, 4))).toMatchObject({ reminded: 5, pending: 5 });

    await sendAckReminders(addDays(today, 20));
    const overdue = await db().select().from(schema.kbAckReminder).where(eq(schema.kbAckReminder.kind, "overdue"));
    expect(overdue).toHaveLength(5);
    const [last] = (await db().select().from(schema.notification).where(eq(schema.notification.kind, "kb.ack_reminder"))).slice(-1);
    expect(last.params).toMatchObject({ overdue: "yes" });

    // Someone who joins later owes it from their first day, and is told by the job.
    const [newbie] = await db().insert(schema.person).values({ fullName: "Người mới", searchName: "nguoi moi", workEmail: "moi@suzu.group", status: "active", primaryEntityId: ids.szm, departmentId: ids.vid }).returning();
    expect(await sendAckReminders(addDays(today, 20))).toMatchObject({ requested: 1, reminded: 0 });
    expect(await notices("kb.ack_requested", newbie.id)).toBe(1);
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, newbie.id));
  });

  it("asks everyone again after a major revision, and nobody after a minor one", async () => {
    await saveDraft(policy, { title: "Bảo mật thông tin", content: body("Bảo mật thông tin", "Sửa lỗi chính tả.") }, { personId: ids.hrGroup });
    const minor = await publishPage(policy, { personId: ids.hrGroup }, { isMajor: false });
    expect(minor.page.ackVersionId).not.toBe(minor.version.id);
    expect(await listMyPendingAcks(viewers.huy)).toEqual([]);

    await saveDraft(policy, { title: "Bảo mật thông tin", content: body("Bảo mật thông tin", "Bắt buộc xác thực hai lớp.") }, { personId: ids.hrGroup });
    const before = await notices("kb.ack_requested");
    const major = await publishPage(policy, { personId: ids.hrGroup }, { isMajor: true });
    expect(major.page.ackVersionId).toBe(major.version.id);
    expect(await notices("kb.ack_requested")).toBe(before + 6);
    expect((await listMyPendingAcks(viewers.huy)).map((row) => row.versionNo)).toEqual([3]);
    expect((await listMyAcknowledgements(ids.huy))[0]).toMatchObject({ versionNo: 1, current: false });
  });

  it("leaves out of 'my pending' a page in a subtree the person cannot open", async () => {
    await setPageAccess(policy, [{ subjectKey: `person:${ids.khoi}`, level: "view" }]);
    expect(await listMyPendingAcks(viewers.huy)).toEqual([]);
    expect((await listMyPendingAcks(viewers.khoi)).map((row) => row.pageId)).toEqual([policy]);
    await setPageAccess(policy, []);
  });

  it("tells a page's owner once that its review date has passed, and again after a new date", async () => {
    const today = (await import("@/lib/dates")).todayInVietnam();
    await setPageMeta(policy, { ownerPersonId: ids.hrSzm, reviewBy: today });
    expect(await sendReviewDueNotices(today)).toEqual({ notified: 1 });
    expect(await sendReviewDueNotices(today)).toEqual({ notified: 0 });
    await setPageMeta(policy, { ownerPersonId: ids.hrSzm, reviewBy: "2020-01-01" });
    expect(await sendReviewDueNotices(today)).toEqual({ notified: 1 });
    expect(await notices("kb.review_due", ids.hrSzm)).toBe(2);
  });
});
