// Delivery (FR-PJM-50..57) against a real Postgres (PGlite): a two-stage chain (internal, then the
// client) from hand-in to the client's approval, with a round of each kind; the single-step review
// untouched where no chain applies; frozen versions; the publish gate; delivery records; results
// imported from a CSV; the reminders run twice; and the facts the register reads.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { parseTable } from "../platform/import/engine/table";
import { removeTaskFile } from "./attachments";
import { saveReviewChain } from "./chains";
import { listDeliveriesByTask, recordDelivery } from "./deliveries";
import { deliveryFactsByTask, revisionRoundsByTask } from "./delivery-facts";
import { addPin, listTaskPins } from "./pins";
import { createProject, setProjectMember } from "./projects";
import { cancelPublish, listCalendarPublishes, listPublishesByTask, listResultsByTask, markPublished, planPublish, recordResult, sendPublishReminders } from "./publish";
import { commitResultRows, resolveResultRows, resultColumns } from "./results-import";
import { decideReview, decideStage, listDeliverables, listReviewsWaitingFor, recordClientDecision, sendReviewOverdueReminders, submitDeliverable } from "./reviews";
import { createWorkTask, loadTask, updateWorkTask } from "./tasks";
import { createTeam, listStates, saveClient, setTeamMember } from "./teams";
import { viewerOfPerson } from "./viewer";

type Key = "long" | "tam" | "huy" | "bao" | "an" | "khoi";
const ids = {} as Record<Key | "szm" | "video" | "social" | "project" | "client" | "edit" | "internal" | "clientReview" | "published" | "socialEdit" | "chain", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const noticesOf = async (key: Key, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));
const evidence = (url = "https://mail.google.com/mail/u/0/#inbox/abc") => ({ channel: "email", decidedByName: "Chị Mai (Vinamilk)", decidedOn: "2026-09-22", evidenceFileId: null, evidenceUrl: url });
const stateOf = async (taskId: string) => (await loadTask(taskId))!.work.stateId;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "bao", "an", "khoi"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Video: the content workflow, led by Long. Social: a simple workflow with a "Published" state, led by Khôi.
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  const social = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", { published: "Đã đăng" }, ids.khoi);
  Object.assign(ids, { video: video.id, social: social.id });
  for (const key of ["tam", "huy", "bao"] as const) await setTeamMember(video.id, ids[key], "member");
  await setTeamMember(social.id, ids.huy, "member");
  const client = await saveClient(null, { code: "VNM", name: "Vinamilk", kind: "client", parentId: null, entityId: szm.id, note: null, isActive: true });
  ids.client = client.after.id;
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  await setProjectMember(ids.project, ids.an, "account_manager");
  const byOrder = (await listStates([video.id])).sort((a, b) => a.sortOrder - b.sortOrder);
  // backlog, brief, ideation, script, design, edit, internal review, client review, scheduled, published, reported, cancelled
  Object.assign(ids, { edit: byOrder[5].id, internal: byOrder[6].id, clientReview: byOrder[7].id });
  const socialStates = (await listStates([social.id])).sort((a, b) => a.sortOrder - b.sortOrder);
  ids.published = socialStates.find((state) => state.name === "Đã đăng")!.id;
  ids.socialEdit = socialStates[5].id;
});

describe("the single-step review where no chain applies (FR-WRK-08, unchanged)", () => {
  it("hands in to the project lead, who decides as before — no stage, no decision rows", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Teaser 15s", stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
    const { deliverable, reviewerPersonId } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/teaser-v1", note: null }, actor("huy"));
    expect([reviewerPersonId, deliverable.chainId, deliverable.stageReviewerPersonId]).toEqual([ids.tam, null, null]);
    expect((await loadTask(task.id))!.work).toMatchObject({ reviewStatus: "submitted", reviewerPersonId: ids.tam, stateId: ids.internal });
    expect((await listReviewsWaitingFor(ids.tam)).find((row) => row.taskId === task.id)).toMatchObject({ version: 1, stageName: null, isClient: false });
    await decideReview(task.id, "changes_requested", "Cắt ngắn đoạn mở", actor("tam"));
    await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/teaser-v2", note: null }, actor("huy"));
    await decideReview(task.id, "approved", null, actor("tam"));
    expect((await listDeliverables(task.id)).map((row) => [row.version, row.decision, row.decisions.length])).toEqual([
      [2, "approved", 0],
      [1, "changes_requested", 0],
    ]);
    expect((await loadTask(task.id))!.work).toMatchObject({ reviewStatus: "approved", revisionRounds: 1, stateId: ids.clientReview });
    expect((await revisionRoundsByTask([task.id])).get(task.id)).toEqual({ internal: 1, client: 0 });
  });
});

describe("a review chain: team lead, then the client (FR-PJM-50, 51)", () => {
  let taskId: string;

  it("is kept by the team and refuses a client stage that is not last", async () => {
    expect(await fails(saveReviewChain({ teamId: ids.video, projectId: null }, null, { name: "Sai", contentFormat: null, isActive: true, stages: [{ name: "Khách", reviewer: "client", dueHours: 48 }, { name: "Lead", reviewer: "team_lead", dueHours: 24 }] }, ids.long))).toBe("chain_client_not_last");
    const { after } = await saveReviewChain({ teamId: ids.video, projectId: null }, null, { name: "Video: lead → khách", contentFormat: "tvc", isActive: true, stages: [{ name: "Trưởng nhóm duyệt", reviewer: "team_lead", dueHours: 24 }, { name: "Khách duyệt", reviewer: "client", dueHours: 72 }] }, ids.long);
    ids.chain = after.id;
    expect(after.stages.map((stage) => stage.key)).toHaveLength(2);
  });

  it("enters stage 0 on hand-in, waiting on the team lead; the single-step decision is refused", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "TVC 30s", stateId: ids.edit, assigneePersonId: ids.huy, contentFormat: "tvc" }, ids.long);
    taskId = task.id;
    const { deliverable, reviewerPersonId } = await submitDeliverable(taskId, { kind: "link", url: "https://drive.google.com/tvc-v1", note: null }, actor("huy"));
    expect(deliverable).toMatchObject({ chainId: ids.chain, stageIndex: 0, stageReviewerPersonId: ids.long });
    expect(reviewerPersonId).toBe(ids.long);
    expect(deliverable.stageDueAt!.getTime() - deliverable.submittedAt.getTime()).toBe(24 * 3_600_000);
    // The task's own reviewer is not overwritten by a stage.
    expect((await loadTask(taskId))!.work).toMatchObject({ reviewerPersonId: null, reviewStatus: "submitted", stateId: ids.internal });
    expect((await listReviewsWaitingFor(ids.long)).find((row) => row.taskId === taskId)).toMatchObject({ stageName: "Trưởng nhóm duyệt", isClient: false });
    expect((await noticesOf("long", "tasks.review_requested")).filter((notice) => notice.link === `/work/tasks/${taskId}`)).toHaveLength(1);
    expect(await fails(decideReview(taskId, "approved", null, actor("long")))).toBe("review_in_chain");
    expect(await fails(decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("huy")))).toBe("review_own_work");
    expect(await fails(decideStage(taskId, { decision: "approved_with_changes", comment: null, client: null }, actor("long")))).toBe("review_comment_required");
  });

  it("approved with changes moves on to the client stage, waiting on the account manager", async () => {
    const { outcome, deliverable } = await decideStage(taskId, { decision: "approved_with_changes", comment: "Chỉnh màu logo ở cảnh cuối", client: null }, actor("long"));
    expect(outcome).toBe("next");
    expect(deliverable).toMatchObject({ stageIndex: 1, stageReviewerPersonId: ids.an, decision: "pending" });
    expect(await stateOf(taskId)).toBe(ids.clientReview);
    expect((await listReviewsWaitingFor(ids.an)).find((row) => row.taskId === taskId)).toMatchObject({ stageName: "Khách duyệt", isClient: true });
    expect((await listReviewsWaitingFor(ids.long)).some((row) => row.taskId === taskId)).toBe(false);
    expect(await fails(decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("an")))).toBe("client_evidence_required");
    expect(await fails(decideStage(taskId, { decision: "approved", comment: null, client: { ...evidence(), evidenceUrl: null } }, actor("an")))).toBe("client_evidence_required");
  });

  it("the client's changes send it back to work as a client round", async () => {
    const { outcome } = await decideStage(taskId, { decision: "changes_required", comment: "Khách muốn đổi nhạc nền", client: evidence() }, actor("an"));
    expect(outcome).toBe("changes");
    expect((await loadTask(taskId))!.work).toMatchObject({ reviewStatus: "changes_requested", revisionRounds: 1, stateId: ids.edit });
    expect((await revisionRoundsByTask([taskId])).get(taskId)).toEqual({ internal: 0, client: 1 });
    expect((await noticesOf("huy", "tasks.client_decision"))[0].params).toMatchObject({ actor: "an", task: "VID-2 TVC 30s" });
    expect(await noticesOf("tam", "tasks.client_decision")).toHaveLength(1);
  });

  it("an internal round, then approval by the lead and the client — which freezes the version", async () => {
    await submitDeliverable(taskId, { kind: "link", url: "https://drive.google.com/tvc-v2", note: null }, actor("huy"));
    await decideStage(taskId, { decision: "changes_required", comment: "Âm thanh bị rè", client: null }, actor("long"));
    await submitDeliverable(taskId, { kind: "link", url: "https://drive.google.com/tvc-v3", note: null }, actor("huy"));
    await decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("long"));
    const { outcome, deliverable } = await decideStage(taskId, { decision: "approved", comment: null, client: evidence() }, actor("an"));
    expect(outcome).toBe("approved");
    expect(deliverable).toMatchObject({ version: 3, decision: "approved" });
    expect(deliverable.frozenAt).not.toBeNull();
    expect((await loadTask(taskId))!.work).toMatchObject({ reviewStatus: "approved", revisionRounds: 2 });
    expect((await revisionRoundsByTask([taskId])).get(taskId)).toEqual({ internal: 1, client: 1 });
    const [v3] = await listDeliverables(taskId);
    expect(v3.decisions.map((row) => [row.stageName, row.decision, row.isClient])).toEqual([
      ["Trưởng nhóm duyệt", "approved", false],
      ["Khách duyệt", "approved", true],
    ]);
    expect(v3.decisions[1].client).toMatchObject({ channel: "email", decidedByName: "Chị Mai (Vinamilk)", evidenceUrl: "https://mail.google.com/mail/u/0/#inbox/abc" });
  });

  it("a frozen version cannot change; a new hand-in is version 4", async () => {
    const [v3] = await listDeliverables(taskId);
    expect(await fails(recordClientDecision(v3.id, { decision: "changes_required", comment: "Đổi slogan", client: evidence() }, actor("an")))).toBe("deliverable_frozen");
    const { deliverable } = await submitDeliverable(taskId, { kind: "link", url: "https://drive.google.com/tvc-v4", note: "Đổi slogan theo khách" }, actor("huy"));
    expect(deliverable.version).toBe(4);
    const [v4, frozen] = await listDeliverables(taskId);
    expect([v4.version, v4.frozenAt, frozen.version, frozen.decision]).toEqual([4, null, 3, "approved"]);
    expect(frozen.frozenAt).not.toBeNull();
  });

  it("the frozen version's file cannot be removed, nor the evidence of a client decision", async () => {
    const file = async (name: string) => (await db().insert(schema.storedFile).values({ bucket: "b", objectPath: `work_task/${taskId}/${name}`, fileName: name, contentType: "image/png", sizeBytes: 10, ownerType: "work_task", ownerId: taskId, tier: "public_internal", status: "ready", uploadedByPersonId: ids.huy }).returning())[0];
    const shot = await file("zalo.png");
    // v4 is still in the chain's first stage; the lead approves, the client approves with a screenshot.
    await decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("long"));
    await decideStage(taskId, { decision: "approved", comment: null, client: { ...evidence(), channel: "zalo", evidenceUrl: null, evidenceFileId: shot.id } }, actor("an"));
    expect(await fails(removeTaskFile(shot.id, ids.huy))).toBe("client_evidence_locked");
    const cut = await file("final.png");
    await submitDeliverable(taskId, { kind: "file", fileId: cut.id, note: null }, actor("huy"));
    await decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("long"));
    await decideStage(taskId, { decision: "approved", comment: null, client: evidence() }, actor("an"));
    expect(await fails(removeTaskFile(cut.id, ids.huy))).toBe("deliverable_frozen");
  });
});

describe("a client decision outside a chain (FR-PJM-51)", () => {
  it("freezes an internally approved version; changes on it send it back as a client round", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Key visual", stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
    await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/kv-v1", note: null }, actor("huy"));
    await decideReview(task.id, "approved", null, actor("tam"));
    const [v1] = await listDeliverables(task.id);
    expect(await fails(recordClientDecision(v1.id, { decision: "changes_required", comment: "Đổi màu nền", client: { ...evidence(), evidenceUrl: null } }, actor("an")))).toBe("client_evidence_required");
    const sentBack = await recordClientDecision(v1.id, { decision: "changes_required", comment: "Đổi màu nền", client: evidence() }, actor("an"));
    expect(sentBack.outcome).toBe("changes");
    expect((await revisionRoundsByTask([task.id])).get(task.id)).toEqual({ internal: 0, client: 1 });
    await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/kv-v2", note: null }, actor("huy"));
    await decideReview(task.id, "approved", null, actor("tam"));
    const [v2] = await listDeliverables(task.id);
    const approved = await recordClientDecision(v2.id, { decision: "approved", comment: null, client: evidence() }, actor("an"));
    expect([approved.outcome, !!approved.deliverable.frozenAt]).toEqual(["recorded", true]);
    expect(await fails(recordClientDecision(v2.id, { decision: "approved", comment: null, client: evidence() }, actor("an")))).toBe("deliverable_frozen");
  });
});

describe("pins on a version (FR-PJM-52)", () => {
  it("pin a point of an image, refuse one outside it or on a link", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Banner", stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
    const [file] = await db().insert(schema.storedFile).values({ bucket: "b", objectPath: `work_task/${task.id}/banner.png`, fileName: "banner.png", contentType: "image/png", sizeBytes: 10, ownerType: "work_task", ownerId: task.id, tier: "public_internal", status: "ready", uploadedByPersonId: ids.huy }).returning();
    const { deliverable } = await submitDeliverable(task.id, { kind: "file", fileId: file.id, note: null }, actor("huy"));
    await addPin(deliverable.id, { x: 0.25, y: 0.75, timecodeMs: null, body: "Logo bị lệch" }, actor("tam"));
    expect(await fails(addPin(deliverable.id, { x: 1.5, y: 0.5, timecodeMs: null, body: "?" }, actor("tam")))).toBe("pin_position_invalid");
    expect(await fails(addPin(deliverable.id, { x: null, y: null, timecodeMs: 1000, body: "?" }, actor("tam")))).toBe("pin_position_invalid");
    expect((await listTaskPins(task.id)).map((pin) => [pin.x, pin.y, pin.body, pin.authorName])).toEqual([[0.25, 0.75, "Logo bị lệch", "tam"]]);
    const { deliverable: link } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/banner", note: null }, actor("huy"));
    expect(await fails(addPin(link.id, { x: 0.5, y: 0.5, timecodeMs: null, body: "?" }, actor("tam")))).toBe("pin_not_media");
  });
});

describe("the publish log (FR-PJM-54)", () => {
  let taskId: string;
  it("refuses the Published state until a post is out with its https URL", async () => {
    const { task } = await createWorkTask({ teamId: ids.social, title: "Post 20/10", stateId: ids.socialEdit, assigneePersonId: ids.huy, channel: "facebook", dueDate: "2026-10-20" }, ids.khoi);
    taskId = task.id;
    expect(await fails(updateWorkTask(taskId, { stateId: ids.published }, ids.huy))).toBe("publish_required");
    const publish = await planPublish(taskId, { platform: "facebook", page: "Vinamilk Fanpage", plannedAt: new Date("2026-10-20T12:00:00Z") }, actor("huy"));
    expect(await fails(updateWorkTask(taskId, { stateId: ids.published }, ids.huy))).toBe("publish_required");
    expect(await fails(markPublished(publish.id, { url: "http://facebook.com/post/1", publishedAt: new Date(), boosted: false, adAccount: null }, actor("huy")))).toBe("publish_url_required");
    expect(await fails(markPublished(publish.id, { url: "https://facebook.com/vinamilk/posts/1", publishedAt: new Date(), boosted: true, adAccount: null }, actor("huy")))).toBe("publish_ad_account_required");
    await markPublished(publish.id, { url: "https://facebook.com/vinamilk/posts/1", publishedAt: new Date("2026-10-20T12:05:00Z"), boosted: true, adAccount: "VNM Ads 01" }, actor("huy"));
    await updateWorkTask(taskId, { stateId: ids.published }, ids.huy);
    expect(await stateOf(taskId)).toBe(ids.published);
    expect(await fails(cancelPublish(publish.id, actor("huy")))).toBe("publish_not_planned");
    const [row] = await listPublishesByTask([taskId]);
    expect(row).toMatchObject({ status: "published", boosted: true, adAccount: "VNM Ads 01", publishedByName: "huy" });
  });

  it("shows on the calendar of those who may see the task", async () => {
    const huy = (await viewerOfPerson(db(), ids.huy))!;
    const bao = (await viewerOfPerson(db(), ids.bao))!;
    expect((await listCalendarPublishes(huy, { from: "2026-10-01", to: "2026-10-31" })).map((row) => [row.key, row.status])).toEqual([["SOC-1", "published"]]);
    expect(await listCalendarPublishes(huy, { from: "2026-11-01", to: "2026-11-30" })).toEqual([]);
    // Bao is not in Social; the team's backlog is team-visible.
    expect(await listCalendarPublishes(bao, { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });

  it("records results by hand and from a CSV, a date read again replacing the first reading", async () => {
    const [publish] = await listPublishesByTask([taskId]);
    await recordResult(publish.id, { recordedOn: "2026-10-21", reach: 1000, views: 400 }, actor("huy"));
    const table = [
      ["Link bài đăng", "Mã công việc", "Ngày", "Tiếp cận", "Lượt xem", "Tương tác", "Chi phí (VND)"],
      ["https://facebook.com/vinamilk/posts/1/", "", "21/10/2026", "1.200", "450", "", ""],
      ["", "SOC-1", "22/10/2026", "3.000", "900", "120", "1.500.000"],
      ["https://facebook.com/other/posts/9", "", "22/10/2026", "5", "", "", ""],
      ["", "", "23/10/2026", "5", "", "", ""],
    ];
    const { rows } = parseTable(table, resultColumns);
    const user = { person: { id: ids.huy, primaryEntityId: ids.szm }, principal: { personId: ids.huy, workforceType: "employee" as const, grants: [] } };
    const { problems } = await resolveResultRows(rows, user);
    expect(problems.map((problem) => [problem.row, problem.code])).toEqual([
      [4, "post_not_found"],
      [5, "post_reference_required"],
    ]);
    // Somebody who may not change the task finds no post at all.
    const outsider = { person: { id: ids.bao, primaryEntityId: ids.szm }, principal: { personId: ids.bao, workforceType: "employee" as const, grants: [] } };
    expect((await resolveResultRows(rows.slice(0, 2), outsider)).problems.map((problem) => problem.code)).toEqual(["post_not_found", "post_not_found"]);
    const counts = await db().transaction((tx) => commitResultRows(rows.slice(0, 2), tx as never, user));
    expect(counts).toEqual({ saved: 1, updated: 1 });
    const results = await listResultsByTask([taskId]);
    expect(results.map((row) => [row.recordedOn, row.metrics, row.source])).toEqual([
      ["2026-10-21", { reach: 1200, views: 450 }, "csv"],
      ["2026-10-22", { reach: 3000, views: 900, engagement: 120, spendVnd: 1_500_000 }, "csv"],
    ]);
    expect((await listPublishesByTask([taskId]))[0].latest).toEqual({ reach: 3000, views: 900, engagement: 120, spendVnd: 1_500_000 });
  });

  it("reminds of today's posts and the missed ones once, however often the job runs", async () => {
    const { task } = await createWorkTask({ teamId: ids.social, title: "Story sáng", stateId: ids.socialEdit, assigneePersonId: ids.huy, channel: "instagram" }, ids.khoi);
    const now = new Date("2026-09-22T00:30:00Z"); // 07:30 in Vietnam
    await planPublish(task.id, { platform: "instagram", page: null, plannedAt: new Date("2026-09-22T12:00:00Z") }, actor("huy"));
    await planPublish(task.id, { platform: "facebook", page: null, plannedAt: new Date("2026-09-21T12:00:00Z") }, actor("huy"));
    expect(await sendPublishReminders(now)).toEqual({ due: 1, missed: 1 });
    expect(await sendPublishReminders(now)).toEqual({ due: 0, missed: 0 });
    expect((await noticesOf("huy", "tasks.publish_due"))[0].params).toMatchObject({ time: "19:00" });
    expect(await noticesOf("huy", "tasks.publish_missed")).toHaveLength(1);
    // The next morning, yesterday's post is missed; the one missed before is not told again.
    expect(await sendPublishReminders(new Date("2026-09-23T00:30:00Z"))).toEqual({ due: 0, missed: 1 });
  });
});

describe("delivery records and the register's facts (FR-PJM-53)", () => {
  it("warns about a version that is not approved, then records; the facts say what happened", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Cut-down 6s", stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
    const { deliverable } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/cut-v1", note: null }, actor("huy"));
    const input = { deliverableId: deliverable.id, deliveredOn: "2026-09-22", recipient: "Chị Mai", links: ["https://drive.google.com/final"], note: null, confirmUnapproved: false };
    expect(await fails(recordDelivery(task.id, input, actor("an")))).toBe("delivery_version_unapproved");
    expect(await fails(recordDelivery(task.id, { ...input, deliverableId: null, links: [] }, actor("an")))).toBe("delivery_needs_content");
    await recordDelivery(task.id, { ...input, confirmUnapproved: true }, actor("an"));
    expect((await listDeliveriesByTask([task.id])).map((row) => [row.version, row.recipient, row.deliveredByName, row.links])).toEqual([[1, "Chị Mai", "an", ["https://drive.google.com/final"]]]);

    const [chained] = await db().select({ taskId: schema.workDeliverable.taskId }).from(schema.workDeliverable).where(eq(schema.workDeliverable.chainId, ids.chain)).limit(1);
    const [social] = await db().select({ taskId: schema.workPublish.taskId }).from(schema.workPublish).where(eq(schema.workPublish.status, "published")).limit(1);
    const facts = await deliveryFactsByTask([task.id, chained.taskId, social.taskId]);
    expect(facts.get(task.id)).toEqual({ clientApproved: false, delivered: true, published: false, lastClientDecision: null });
    expect(facts.get(chained.taskId)).toMatchObject({ clientApproved: true, delivered: false, published: false, lastClientDecision: { decision: "approved", channel: "email", decidedByName: "Chị Mai (Vinamilk)", decidedOn: "2026-09-22" } });
    expect(facts.get(social.taskId)).toMatchObject({ clientApproved: false, published: true });
  });
});

describe("overdue chain stages", () => {
  it("remind the stage's reviewer once per stage", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "TVC 15s", stateId: ids.edit, assigneePersonId: ids.huy, contentFormat: "tvc" }, ids.long);
    await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/tvc15", note: null }, actor("huy"));
    const before = (await noticesOf("long", "tasks.review_requested")).length;
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect((await sendReviewOverdueReminders(later)).overdueReviews).toBeGreaterThanOrEqual(1);
    expect(await sendReviewOverdueReminders(later)).toEqual({ overdueReviews: 0 });
    // A notice of its own, naming the stage — not the review request again.
    expect((await noticesOf("long", "tasks.review_requested")).length).toBe(before);
    const overdue = (await noticesOf("long", "tasks.review_overdue")).filter((notice) => notice.link === `/work/tasks/${task.id}`);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].params).toMatchObject({ task: expect.stringContaining("TVC 15s"), stage: expect.any(String) });
    expect((overdue[0].params as { stage: string }).stage).not.toBe("");
  });
});
