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
import { acknowledgePage, countMyPendingAcks, getAckReport, getAckStatus, listMyAcknowledgements, listMyPendingAcks, remindPendingNow, sendAckReminders, sendReviewDueNotices, setAckRequirement } from "./acknowledgements";
import { doc, heading, paragraph } from "./engine/build";
import { createPage, loadPage, publishPage, saveDraft, setPageAccess, setPageMeta } from "./pages";
import { type KbViewer, viewerKeys } from "./policy";
import { decidePageReview, getPublishReview, submitPageForReview, syncReviewState, withdrawPageReview } from "./publishing";
import { listPopularPages, listRecentlyPublished, listRecentlyViewed, searchKb } from "./search";
import { createSpace } from "./spaces";
import { chunkStats, chunkUnchunkedPages, embedPendingChunks, retrieveKbChunks } from "./chunks";
import { importMarkdownPage, listTemplates, saveAsTemplate, setTemplateActive, templateContent } from "./templates";
import { kbTemplateSeedRows } from "./seed-templates";
import { validateDoc } from "./engine/doc";
import { snippetOf, toTsQuery } from "./engine/search";
import { recordView } from "./pages";
import { canViewPage } from "./policy";

type Who = "owner" | "hrGroup" | "hrSzm" | "editor" | "huy" | "khoi" | "ngo";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des", string>;
const viewers = {} as Record<Who, KbViewer>;
const spaces = {} as Record<"handbook" | "szmHr" | "tools", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const body = (title: string, text: string) => doc(heading(1, title), paragraph(text));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design" }).returning();
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
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType, primaryEntityId: entityId, orgUnitId: departmentId }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : { type: "entity", id: entityId } }] : [];
    if (role) await db().insert(schema.roleAssignment).values({ personId: row.id, role, scopeType: scope!, scopeId: scope === "entity" ? entityId : null, validFrom: "2024-01-01" });
    const principal: Principal = { personId: row.id, workforceType, grants };
    viewers[key] = { principal, personId: row.id, keys: viewerKeys(principal, { entityId, unitId: departmentId, unitPath: departmentId ? [departmentId] : [] }) };
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
    expect([await countMyPendingAcks(viewers.huy), await countMyPendingAcks(viewers.ngo)]).toEqual([1, 0]);
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
    const [newbie] = await db().insert(schema.person).values({ fullName: "Người mới", searchName: "nguoi moi", workEmail: "moi@suzu.group", status: "active", primaryEntityId: ids.szm, orgUnitId: ids.vid }).returning();
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

describe("search", () => {
  const made = {} as Record<"leave" | "training" | "secret" | "draft" | "szm" | "archived", string>;
  const titles = async (who: Who, query: string, spaceId?: string) => (await searchKb(viewers[who], { query, spaceId })).hits.map((hit) => hit.title);

  beforeAll(async () => {
    const hr = { personId: ids.hrGroup };
    const make = async (spaceId: string, title: string, text: string, parentId: string | null = null, publish = true) => {
      const page = await createPage({ spaceId, parentId, title, content: body(title, text) }, hr);
      if (publish) await publishPage(page.id, hr);
      return page.id;
    };
    made.leave = await make(spaces.handbook, "Nghỉ phép năm", "Mỗi nhân viên có 12 ngày nghỉ phép năm hưởng nguyên lương. Đăng ký nghỉ phép trên SuZu One trước ít nhất ba ngày làm việc.");
    made.training = await make(spaces.handbook, "Đào tạo và phát triển", "Công ty hỗ trợ chi phí đào tạo cho khoá học liên quan đến công việc.", made.leave);
    made.secret = await make(spaces.handbook, "Khung nghỉ phép của quản lý", "Quản lý cấp cao có thêm ngày nghỉ phép thâm niên.");
    await setPageAccess(made.secret, [{ subjectKey: `person:${ids.hrSzm}`, level: "view" }]);
    made.draft = await make(spaces.handbook, "Nghỉ phép không lương (nháp)", "Bản nháp về nghỉ phép không lương.", null, false);
    made.szm = await make(spaces.szmHr, "Nghỉ phép bù tại SZM", "Quy định nghỉ phép bù riêng của SuZu Media.");
    made.archived = await make(spaces.tools, "Nghỉ phép: mẹo cũ", "Trang cũ về nghỉ phép.");
    const { setPageArchived } = await import("./pages");
    await setPageArchived(made.archived, true);
  });

  it("builds the query and the snippet without losing the accents", () => {
    expect(toTsQuery("  Nghỉ PHÉP  năm ")).toBe("nghi & phep & nam:*");
    expect(toTsQuery("đào tạo")).toBe("dao & tao:*");
    expect(toTsQuery("!!! & | ( ) :*")).toBeNull();
    expect(toTsQuery("a' OR 1=1 --")).toBe("a & or & 1:*");
    expect(snippetOf("Mỗi nhân viên có 12 ngày nghỉ phép năm hưởng nguyên lương.", "nghi phep", { before: 2, after: 4 })).toEqual({ text: "… 12 ngày nghỉ phép năm hưởng …", matched: true });
    expect(snippetOf("Không có gì.", "xyz").matched).toBe(false);
  });

  it("finds accented text from unaccented words, by prefix, title first", async () => {
    expect((await titles("hrGroup", "nghi phep"))[0]).toBe("Nghỉ phép năm");
    expect(await titles("huy", "dao tao")).toEqual(["Đào tạo và phát triển"]);
    expect(await titles("huy", "ĐÀO TẠO")).toEqual(["Đào tạo và phát triển"]);
    expect(await titles("huy", "thuong nien")).toEqual([]);
    expect(await titles("huy", "nghi ph")).toContain("Nghỉ phép năm");
    const [hit] = (await searchKb(viewers.huy, { query: "dao tao" })).hits;
    expect(hit).toMatchObject({ spaceKey: "handbook", path: ["Nghỉ phép năm"] });
    expect(hit.snippet).toContain("đào tạo");
    expect((await searchKb(viewers.huy, { query: "" })).total).toBe(0);
  });

  it("shows each hit's path only as far up as the viewer may see", async () => {
    const hr = { personId: ids.hrGroup };
    const publish = async (title: string, parentId: string, text: string) => {
      const page = await createPage({ spaceId: spaces.handbook, parentId, title, content: body(title, text) }, hr);
      await publishPage(page.id, hr);
      return page.id;
    };
    // Two levels below an open page: the whole chain, top first.
    await publish("Phụ lục kiểm toán nội bộ", made.training, "Phụ lục kiểm toán nội bộ hằng năm.");
    const [deep] = (await searchKb(viewers.huy, { query: "kiem toan" })).hits;
    expect(deep.path).toEqual(["Nghỉ phép năm", "Đào tạo và phát triển"]);
    // Under a page the reader may not open: the path stops there.
    const child = await publish("Bảo mật lương thưởng", made.secret, "Quy trình bảo mật dữ liệu lương thưởng.");
    await setPageAccess(child, [
      { subjectKey: `person:${ids.huy}`, level: "view" },
      { subjectKey: `person:${ids.hrSzm}`, level: "view" },
    ]);
    const pathFor = async (who: Who) => (await searchKb(viewers[who], { query: "bao mat luong" })).hits.find((hit) => hit.pageId === child)?.path;
    expect(await pathFor("huy")).toEqual([]);
    expect(await pathFor("hrSzm")).toEqual(["Khung nghỉ phép của quản lý"]);
  });

  it("filters by permission in SQL: no drafts, restricted subtrees, other entities' spaces or archived pages — and agrees with the policy", async () => {
    expect((await titles("huy", "nghi phep")).sort()).toEqual(["Nghỉ phép bù tại SZM", "Nghỉ phép năm"]);
    expect((await titles("khoi", "nghi phep")).sort()).toEqual(["Nghỉ phép năm"]);
    expect((await titles("hrSzm", "nghi phep")).sort()).toEqual(["Khung nghỉ phép của quản lý", "Nghỉ phép bù tại SZM", "Nghỉ phép năm"]);
    expect(await titles("ngo", "nghi phep")).toEqual([]);
    // Editors search what readers read: a draft is not in the index.
    expect(await titles("hrGroup", "khong luong")).toEqual([]);
    expect(await titles("huy", "nghi phep", spaces.szmHr)).toEqual(["Nghỉ phép bù tại SZM"]);

    for (const who of ["owner", "hrSzm", "huy", "khoi", "ngo"] as const) {
      const result = await searchKb(viewers[who], { query: "nghi phep", limit: 50 });
      let expected = 0;
      for (const pageId of Object.values(made)) {
        const loaded = (await loadPage(pageId))!;
        const readable = loaded.pageFacts.readable && canViewPage(viewers[who], loaded.facts, loaded.pageFacts) && pageId !== made.training;
        if (readable) expected++;
      }
      expect([who, result.total]).toEqual([who, expected]);
      expect(result.hits).toHaveLength(expected);
    }
  });

  it("lists recent, popular and newly published pages through the same filter", async () => {
    const { todayInVietnam } = await import("@/lib/dates");
    await recordView(made.leave, ids.huy, todayInVietnam());
    await recordView(made.leave, ids.khoi, todayInVietnam());
    await recordView(made.secret, ids.hrSzm, todayInVietnam());
    await recordView(made.szm, ids.huy, todayInVietnam());
    expect((await listRecentlyViewed(viewers.huy)).map((page) => page.title).sort()).toEqual(["Nghỉ phép bù tại SZM", "Nghỉ phép năm"]);
    expect((await listPopularPages(viewers.khoi)).map((page) => [page.title, page.views])).toEqual([["Nghỉ phép năm", 2]]);
    expect((await listPopularPages(viewers.hrSzm)).map((page) => page.title)).toContain("Khung nghỉ phép của quản lý");
    const fresh = (await listRecentlyPublished(viewers.khoi, { limit: 50 })).map((page) => page.title);
    expect(fresh).toContain("Nghỉ phép năm");
    expect(fresh).not.toContain("Khung nghỉ phép của quản lý");
    expect(fresh).not.toContain("Nghỉ phép bù tại SZM");
    // After the reader loses access, the page leaves their "recently viewed".
    await setPageAccess(made.leave, [{ subjectKey: `person:${ids.khoi}`, level: "view" }]);
    expect(await listRecentlyViewed(viewers.huy)).toHaveLength(1);
    await setPageAccess(made.leave, []);
  });
});

describe("templates and imports", () => {
  it("seeds nine valid templates, offers only the active ones, and keeps a page as a new one", async () => {
    const rows = kbTemplateSeedRows();
    // The last three are the starters of a project's document space (FR-PJM-31), with "meeting_notes".
    expect(rows.map((row) => row.key)).toEqual(["sop", "policy", "meeting_notes", "campaign_post_mortem", "client_playbook", "onboarding_guide", "project_brief", "video_script", "shot_list"]);
    for (const row of rows) expect([row.key, validateDoc(row.content).ok]).toEqual([row.key, true]);
    await db().insert(schema.kbTemplate).values(rows);
    const [sop] = await listTemplates();
    expect(sop).toMatchObject({ key: "sop", isSystem: true });
    expect((await templateContent(sop.id)).content[0]).toMatchObject({ type: "heading" });
    await setTemplateActive(sop.id, false);
    expect(await fails(templateContent(sop.id))).toBe("kb_template_not_found");
    expect((await listTemplates()).map((row) => row.key)).not.toContain("sop");
    expect((await listTemplates({ includeInactive: true })).map((row) => row.key)).toContain("sop");
    const own = await saveAsTemplate({ name: "Mẫu báo cáo tuần", description: null, content: body("x", "y") }, { personId: ids.hrGroup });
    const again = await saveAsTemplate({ name: "Mẫu báo cáo tuần", description: null, content: body("x", "y") }, { personId: ids.hrGroup });
    expect([own.key, again.key]).toEqual(["mau_bao_cao_tuan", "mau_bao_cao_tuan_2"]);
    expect(await fails(saveAsTemplate({ name: "Hỏng", description: null, content: { type: "doc", content: [{ type: "script" }] } }, { personId: ids.hrGroup }))).toBe("kb_content_invalid");
  });

  it("imports Markdown as a draft: title from the heading, the file name, or what was typed", async () => {
    const actor = { personId: ids.hrGroup };
    const fromHeading = await importMarkdownPage({ spaceId: spaces.tools, parentId: null, markdown: "# Hướng dẫn VPN\n\nCài **WireGuard**.", fileName: "vpn.md" }, actor);
    expect(fromHeading).toMatchObject({ titleFrom: "heading", page: { title: "Hướng dẫn VPN", status: "draft", publishedVersionId: null } });
    expect(fromHeading.page.contentText).toContain("WireGuard");
    expect((await importMarkdownPage({ spaceId: spaces.tools, parentId: null, markdown: "Không có tiêu đề.", fileName: "quy_trinh-mua-sam.md" }, actor)).page.title).toBe("quy trinh mua sam");
    expect((await importMarkdownPage({ spaceId: spaces.tools, parentId: fromHeading.page.id, markdown: "# A", title: "Tên tự đặt" }, actor)).page).toMatchObject({ title: "Tên tự đặt", parentId: fromHeading.page.id });
    expect(await fails(importMarkdownPage({ spaceId: spaces.tools, parentId: null, markdown: "   " }, actor))).toBe("kb_import_empty");
  });
});

describe("chunks and retrieval", () => {
  const chunksOf = (pageId: string) => db().select().from(schema.kbPageChunk).where(eq(schema.kbPageChunk.pageId, pageId)).orderBy(schema.kbPageChunk.chunkIndex);
  let expenses = "";

  it("rebuilds the chunks with every publish, keeps the vector of a passage that did not change, and drops them with the page", async () => {
    const hr = { personId: ids.hrGroup };
    const v1 = doc(heading(1, "Tạm ứng"), paragraph("Lập đề nghị tạm ứng trước chuyến công tác."), heading(1, "Hoàn ứng"), paragraph("Nộp chứng từ trong 5 ngày làm việc."));
    const page = await createPage({ spaceId: spaces.tools, parentId: null, title: "Công tác phí", content: v1 }, hr);
    expenses = page.id;
    expect(await chunksOf(page.id)).toHaveLength(0);
    const first = await publishPage(page.id, hr);
    const cut = await chunksOf(page.id);
    expect(cut.map((chunk) => [chunk.headingPath, chunk.versionId === first.version.id, chunk.embedding])).toEqual([["Công tác phí › Tạm ứng", true, null], ["Công tác phí › Hoàn ứng", true, null]]);

    expect(await embedPendingChunks()).toMatchObject({ model: "fake-hash-256", remaining: 0 });
    expect(await embedPendingChunks()).toMatchObject({ embedded: 0 });
    const embedded = await chunksOf(page.id);
    expect(embedded.every((chunk) => chunk.embedding?.length === 256 && chunk.embeddingModel === "fake-hash-256")).toBe(true);

    await saveDraft(page.id, { title: "Công tác phí", content: doc(heading(1, "Tạm ứng"), paragraph("Lập đề nghị tạm ứng trước chuyến công tác."), heading(1, "Hoàn ứng"), paragraph("Nộp chứng từ trong 7 ngày làm việc.")) }, hr);
    const second = await publishPage(page.id, hr);
    const recut = await chunksOf(page.id);
    expect(recut.map((chunk) => [chunk.versionId === second.version.id, chunk.embedding !== null])).toEqual([[true, true], [true, false]]);
    expect(recut[0].embeddedAt).toEqual(embedded[0].embeddedAt);
    await embedPendingChunks();

    const { setPageArchived, unpublishPage } = await import("./pages");
    await setPageArchived(page.id, true);
    expect(await chunksOf(page.id)).toHaveLength(0);
    await setPageArchived(page.id, false);
    expect(await chunksOf(page.id)).toHaveLength(2);
    await unpublishPage(page.id);
    expect(await chunksOf(page.id)).toHaveLength(0);
    await publishPage(page.id, hr);
    // A page whose chunks went missing is cut again by the job.
    await db().delete(schema.kbPageChunk).where(eq(schema.kbPageChunk.pageId, page.id));
    expect((await chunkUnchunkedPages()).pages).toBeGreaterThanOrEqual(1);
    expect(await chunksOf(page.id)).toHaveLength(2);
    await embedPendingChunks();
    const stats = await chunkStats();
    expect(stats.embedded).toBe(stats.chunks);
  });

  it("retrieves the closest passages of pages the viewer may read — filtered in SQL, never after", async () => {
    await chunkUnchunkedPages();
    await embedPendingChunks();
    const ask = async (who: Who, query: string, limit = 5) => (await retrieveKbChunks(viewers[who], { query, limit })).map((chunk) => chunk.pageTitle);
    const [best] = await retrieveKbChunks(viewers.huy, { query: "nộp chứng từ hoàn ứng trong mấy ngày?", limit: 3 });
    expect(best).toMatchObject({ pageId: expenses, pageTitle: "Công tác phí", headingPath: "Công tác phí › Hoàn ứng", spaceKey: "tools" });
    expect(best.score).toBeGreaterThan(0.2);

    // The managers' restricted page: its reader gets it, a plain employee and another entity's never do.
    expect(await ask("hrSzm", "ngày nghỉ phép thâm niên của quản lý cấp cao")).toContain("Khung nghỉ phép của quản lý");
    expect(await ask("huy", "ngày nghỉ phép thâm niên của quản lý cấp cao", 50)).not.toContain("Khung nghỉ phép của quản lý");
    expect(await ask("khoi", "quy định nghỉ phép bù của SuZu Media", 50)).not.toContain("Nghỉ phép bù tại SZM");
    expect(await ask("huy", "quy định nghỉ phép bù của SuZu Media")).toContain("Nghỉ phép bù tại SZM");
    expect(await ask("ngo", "nghỉ phép", 50)).toEqual([]);
    // Drafts and archived pages have no passages at all.
    expect(await ask("owner", "nghỉ phép không lương bản nháp", 50)).not.toContain("Nghỉ phép không lương (nháp)");
    expect(await ask("owner", "mẹo cũ", 50)).not.toContain("Nghỉ phép: mẹo cũ");
    expect(await retrieveKbChunks(viewers.huy, { query: "  ?? " })).toEqual([]);
  });
});

describe("files of a page", () => {
  it("lets a reader fetch only what the published version shows; editors fetch the draft's files too", async () => {
    const { mayOpenPageFile } = await import("./files");
    const shown = "11111111-1111-4111-8111-111111111111";
    const drafted = "22222222-2222-4222-8222-222222222222";
    const attachment = (fileId: string) => ({ type: "attachment", attrs: { fileId, fileName: "bieu-mau.pdf", sizeBytes: 10 } });
    const page = await createPage({ spaceId: spaces.handbook, parentId: null, title: "Biểu mẫu", content: doc(paragraph("Tải biểu mẫu:"), attachment(shown)) }, { personId: ids.hrGroup });
    const loadedDraft = (await loadPage(page.id))!;
    expect(await mayOpenPageFile(viewers.huy, loadedDraft, shown)).toBe(false);
    await publishPage(page.id, { personId: ids.hrGroup });
    await saveDraft(page.id, { title: "Biểu mẫu", content: doc(paragraph("Bản mới:"), attachment(shown), attachment(drafted)) }, { personId: ids.editor });
    const loaded = (await loadPage(page.id))!;
    expect([await mayOpenPageFile(viewers.huy, loaded, shown), await mayOpenPageFile(viewers.huy, loaded, drafted)]).toEqual([true, false]);
    expect([await mayOpenPageFile(viewers.editor, loaded, drafted), await mayOpenPageFile(viewers.hrGroup, loaded, drafted)]).toEqual([true, true]);
    expect(await mayOpenPageFile(viewers.ngo, loaded, shown)).toBe(false);
  });
});
