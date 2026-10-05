// The client's expiring review link (D24, FR-PJM-51a) against a real Postgres (PGlite), and the
// public page around it.
//
// What is worth testing here is not that a link can be made but everything that must happen around
// it: that opening one counts a view and shows one version and nothing else, that the client's
// answer becomes the *same* record the account manager's own recording writes — freezing the
// version, counting the round, telling the team — that a link takes exactly one answer, that a
// closed link of any kind says the same thing, that a private project keeps its name, that a
// script walking the token space runs out of allowance — and that the file behind the page is
// behind the token too: signed afresh for as long as the link is open, and not a request longer.
//
// And what R14 promises of a public surface: that a view is a person looking (a chat app drawing
// the link's card is not counted, audited or shown the work), that a real view is in the audit log
// once an hour, that every closed link says "closed" however hard it is hammered, that the links
// still out there can be seen and revoked project by project, and that the nightly sweep takes
// back the ones that have outlived their reason.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));
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
// Only the signer is replaced: what is asked of a link before anything is signed runs for real.
const storage = { signed: [] as string[], down: false };
vi.mock("@/modules/platform/files/storage", () => ({
  currentBucket: () => "test-bucket",
  createSignedDownloadUrl: async (objectPath: string, expiresInSeconds: number) => {
    if (storage.down) throw new Error("storage is down");
    storage.signed.push(objectPath);
    return `https://storage.invalid/${objectPath}?expires=${expiresInSeconds}&n=${storage.signed.length}`;
  },
}));

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { PREVIEW_LIMITS, PREVIEW_MEDIA_LINK_SECONDS, previewVisitorKey } from "./engine/preview";
import { saveReviewChain } from "./chains";
import { claimLink, createPreviewLink, decideOnPreviewLink, listPreviewLinks, listProjectPreviewLinks, openPreviewFile, openPreviewLink, purgePreviewHits, releaseClaim, revokePreviewLink, sweepPreviewLinks } from "./preview";
import { canManagePreviewLinks, canRevokePreviewLink, canSeeProjectPreviewLinks } from "./preview-policy";
import { createProject, findProject, projectFacts, setProjectMember } from "./projects";
import { decideReview, decideStage, listDeliverables, submitDeliverable } from "./reviews";
import { createWorkTask, loadTask } from "./tasks";
import { createTeam, listStates, saveClient, setTeamMember } from "./teams";
import { viewerOfPerson } from "./viewer";
import { workflow } from "../../../tests/helpers/workflows";

type Key = "long" | "tam" | "huy" | "an" | "khoi";
const ids = {} as Record<Key | "szm" | "video" | "project" | "secret" | "client" | "edit", string>;
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const viewer = async (key: Key) => (await viewerOfPerson(db(), ids[key]))!;
/** A fresh visitor per test, so one test's requests never spend another's allowance. */
const visitor = (name: string) => ({ ipHash: `visitor-${name}`, userAgent: "a phone" });
const noticesOf = async (key: Key, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));
/** The views of a task's links as the audit log holds them, oldest first. */
const viewAuditsOf = async (taskId: string) => db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "work.preview.view"), eq(schema.auditLog.resourceId, taskId))).orderBy(schema.auditLog.id);
/** An audit row as text, to look for what must not be in it (its id is a bigint, which JSON will not print). */
const printed = (row: { id: bigint }) => JSON.stringify({ ...row, id: String(row.id) });

/** A task with one version handed in, ready to be sent to the client. */
async function taskWithVersion(title: string, projectId = ids.project) {
  const { task } = await createWorkTask({ teamId: ids.video, projectId, title, stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
  const { deliverable } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/v1", note: null }, actor("huy"));
  return { taskId: task.id, deliverableId: deliverable.id };
}

/** A task whose one version is a file in storage, as an upload would have left it. */
async function taskWithFile(title: string, fileName: string) {
  const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title, stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
  const extension = fileName.split(".").pop();
  const [file] = await db().insert(schema.storedFile).values({ bucket: "test-bucket", objectPath: `work_task/2026/${task.id}.${extension}`, fileName, contentType: "application/octet-stream", sizeBytes: 10, ownerType: "work_task", ownerId: task.id, entityId: ids.szm, tier: "public_internal", status: "ready", uploadedByPersonId: ids.huy }).returning();
  const { deliverable } = await submitDeliverable(task.id, { kind: "file", fileId: file.id, note: null }, actor("huy"));
  return { taskId: task.id, deliverableId: deliverable.id, fileId: file.id, objectPath: file.objectPath };
}

const linkOn = async (taskId: string, over: Partial<Parameters<typeof createPreviewLink>[0]> = {}) =>
  createPreviewLink({ taskId, deliverableId: null, label: "Chị Mai – Vinamilk", message: "Chị xem giúp em bản dựng.", allowDecision: true, days: 14, ...over }, ids.an);

/** Version 1 unless a test says otherwise: the page puts the version it showed in the form. */
const decide = (token: string, over: Partial<Parameters<typeof decideOnPreviewLink>[0]> = {}, from = "client") =>
  decideOnPreviewLink({ token, website: "", version: "1", decision: "approved", decidedByName: "Chị Mai", comment: "", ...over }, visitor(from));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "an", "khoi"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("content"), ids.long);
  ids.video = video.id;
  for (const key of ["tam", "huy"] as const) await setTeamMember(video.id, ids[key], "member");
  const client = await saveClient(null, { code: "VNM", name: "Vinamilk", kind: "client", parentId: null, entityId: szm.id, note: null, isActive: true });
  ids.client = client.after.id;
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  await setProjectMember(ids.project, ids.an, "account_manager");
  // A private project of the same team (FR-WRK-18), with the same account manager on it.
  ids.secret = (await createProject({ teamId: video.id, name: "Thương vụ M&A", description: null, clientId: ids.client, status: "active", visibility: "private", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  await setProjectMember(ids.secret, ids.an, "account_manager");
  await setProjectMember(ids.secret, ids.huy, "member");
  const byOrder = (await listStates([video.id])).sort((a, b) => a.sortOrder - b.sortOrder);
  ids.edit = byOrder[5].id;
});

describe("who may hand a client a link", () => {
  it("is whoever may record what the client decided, and nobody else", async () => {
    const { taskId } = await taskWithVersion("Ai được tạo link");
    const task = (await loadTask(taskId))!.facts;
    const client = { accountManagerPersonId: null };
    // The project's account manager and the people who run the project.
    expect(canManagePreviewLinks(await viewer("an"), task, client)).toBe(true);
    expect(canManagePreviewLinks(await viewer("tam"), task, client)).toBe(true);
    // A member doing the work does not speak for the client, and a stranger is a stranger.
    expect(canManagePreviewLinks(await viewer("huy"), task, client)).toBe(false);
    expect(canManagePreviewLinks(await viewer("khoi"), task, client)).toBe(false);
    // Revoking is wider: whoever may moderate the task can stop a link that went to the wrong person.
    expect(canRevokePreviewLink(await viewer("long"), task, client)).toBe(true);
    expect(canRevokePreviewLink(await viewer("khoi"), task, client)).toBe(false);
  });
});

describe("the link itself", () => {
  it("is shown once and stored only as a hash", async () => {
    const { taskId } = await taskWithVersion("Token chỉ hiện một lần");
    const { link, token, path } = await linkOn(taskId);
    expect(path).toBe(`/preview/${token}`);
    expect(link.tokenHash).not.toContain(token);
    // Nothing in the row, anywhere, contains the token.
    expect(JSON.stringify(link)).not.toContain(token);
  });

  it("refuses a version of another task, and a task with nothing handed in", async () => {
    const one = await taskWithVersion("Phiên bản của người khác");
    const other = await taskWithVersion("Công việc khác");
    await expect(linkOn(one.taskId, { deliverableId: other.deliverableId })).rejects.toThrow("deliverable_not_found");
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Chưa nộp gì", stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
    await expect(linkOn(task.id)).rejects.toThrow("preview_no_version");
  });
});

describe("opening a link", () => {
  it("counts the view and shows one version — and nothing else of the company", async () => {
    const { taskId } = await taskWithVersion("Bản dựng teaser");
    const { link, token } = await linkOn(taskId);

    const first = await openPreviewLink(token, visitor("open-1"));
    expect(first.ok).toBe(true);
    const page = first.ok ? first.page : null;
    expect(page).toMatchObject({ clientName: "Vinamilk", projectName: "TVC Tết", title: "Bản dựng teaser", version: 1, kind: "link", url: "https://drive.google.com/v1", senderName: "an", allowDecision: true });
    // The page carries no identifier of any kind: not the task, the project, the client or the link.
    const printed = JSON.stringify(page);
    for (const id of [taskId, link.id, ids.project, ids.client, ids.an, ids.huy]) expect(printed).not.toContain(id);
    expect(Object.keys(page!).sort()).toEqual(["allowDecision", "clientName", "expiresAt", "fileIsImage", "fileIsVideo", "fileName", "kind", "message", "projectName", "recipientLabel", "senderName", "title", "url", "version"]);

    await openPreviewLink(token, visitor("open-1"));
    const [after] = await listPreviewLinks(taskId);
    expect(after).toMatchObject({ state: "viewed", viewCount: 2 });
    expect(after.lastViewedAt).not.toBeNull();
  });

  it("says the same thing for a token nobody issued, an expired link and a revoked one", async () => {
    const { taskId } = await taskWithVersion("Mọi cách đóng đều giống nhau");
    const expired = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));
    const revoked = await linkOn(taskId);
    await revokePreviewLink(revoked.link.id, ids.long);

    const answers = [await openPreviewLink("Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", visitor("probe")), await openPreviewLink(expired.token, visitor("probe")), await openPreviewLink(revoked.token, visitor("probe"))];
    expect(answers).toEqual([{ ok: false, reason: "closed" }, { ok: false, reason: "closed" }, { ok: false, reason: "closed" }]);
    // A revoked link is never counted as viewed, so the state stays readable inside the company.
    expect((await listPreviewLinks(taskId)).map((row) => row.state).sort()).toEqual(["expired", "revoked"]);
  });

  it("keeps a private project's name to itself and still shows the version", async () => {
    const { taskId } = await taskWithVersion("Bản dựng nội bộ", ids.secret);
    const { token } = await linkOn(taskId);
    const outcome = await openPreviewLink(token, visitor("private"));
    expect(outcome.ok && outcome.page).toMatchObject({ projectName: null, clientName: "Vinamilk", version: 1 });
  });
});

describe("the client's decision", () => {
  it("approves: the same record as the account manager's own, frozen version, team told, link closed", async () => {
    const { taskId } = await taskWithVersion("Khách duyệt");
    const { link, token } = await linkOn(taskId);
    await openPreviewLink(token, visitor("approve"));

    const result = await decide(token, { decidedByName: "Chị Mai (Vinamilk)", comment: "Đẹp lắm em" }, "approve");
    expect(result).toEqual({ ok: true, data: { recorded: true } });

    const [version] = await listDeliverables(taskId);
    expect(version.decision).toBe("approved");
    expect(version.frozenAt).not.toBeNull();
    const clientDecision = version.decisions.find((row) => row.isClient)!;
    expect(clientDecision).toMatchObject({ decision: "approved", isClient: true, comment: "Đẹp lắm em" });
    expect(clientDecision.client).toMatchObject({ channel: "preview_link", decidedByName: "Chị Mai (Vinamilk)" });
    // The evidence points at the link's own record inside the app, and carries no token.
    expect(clientDecision.client!.evidenceUrl).toBe(`https://suzu.one/work/tasks/${taskId}?preview=${link.id}`);
    expect(clientDecision.client!.evidenceUrl).not.toContain(token);
    // The people doing the work hear it, exactly as when it is recorded by hand — and so does the
    // account manager who sent the link, who is the one person waiting for the answer.
    expect(await noticesOf("huy", "tasks.client_decision")).toHaveLength(1);
    const toSender = await noticesOf("an", "tasks.preview_decided");
    expect(toSender).toHaveLength(1);
    expect(toSender[0].params).toMatchObject({ name: "Chị Mai (Vinamilk)" });

    // One decision per link: it is closed, it knows which record it produced, and it takes no more.
    const [row] = await listPreviewLinks(taskId);
    expect(row.state).toBe("decided");
    expect(row.decision).toMatchObject({ decision: "approved", decidedByName: "Chị Mai (Vinamilk)" });
    expect(await openPreviewLink(token, visitor("approve"))).toEqual({ ok: false, reason: "closed" });
    expect(await decide(token, {}, "approve")).toMatchObject({ ok: false, message: "preview_link_closed" });
  });

  it("requests changes: a round is counted, the work comes back, the link is spent", async () => {
    const { taskId } = await taskWithVersion("Khách yêu cầu sửa");
    const { token } = await linkOn(taskId);
    const before = (await loadTask(taskId))!.work.revisionRounds;

    expect(await decide(token, { decision: "changes_required", comment: "Đổi nhạc nền" }, "changes")).toEqual({ ok: true, data: { recorded: true } });
    const work = (await loadTask(taskId))!.work;
    expect(work.reviewStatus).toBe("changes_requested");
    expect(work.revisionRounds).toBe(before + 1);
    const [version] = await listDeliverables(taskId);
    expect(version.decision).toBe("changes_requested");
    // Asking for changes does not freeze anything: the next version is the point.
    expect(version.frozenAt).toBeNull();
    expect((await listPreviewLinks(taskId))[0].state).toBe("decided");
  });

  it("refuses an answer with no comment, and does not spend the link doing it", async () => {
    const { taskId } = await taskWithVersion("Thiếu ý kiến");
    const { token } = await linkOn(taskId);
    expect(await decide(token, { decision: "changes_required", comment: "" }, "comment")).toMatchObject({ ok: false, message: "preview_comment_required" });
    expect((await listPreviewLinks(taskId))[0].state).toBe("active");
    // The client corrects it and the same link works.
    expect(await decide(token, { decision: "changes_required", comment: "Đổi nhạc" }, "comment")).toEqual({ ok: true, data: { recorded: true } });
  });

  it("takes nothing from a view-only, a revoked or an expired link", async () => {
    const { taskId } = await taskWithVersion("Chỉ xem");
    const viewOnly = await linkOn(taskId, { allowDecision: false });
    const revoked = await linkOn(taskId);
    await revokePreviewLink(revoked.link.id, ids.long);
    const expired = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));

    // A view-only link shows the work and offers nothing; posting to it anyway is refused.
    const page = await openPreviewLink(viewOnly.token, visitor("view-only"));
    expect(page.ok && page.page.allowDecision).toBe(false);
    for (const token of [viewOnly.token, revoked.token, expired.token]) {
      expect(await decide(token, {}, "view-only")).toMatchObject({ ok: false, message: "preview_link_closed" });
    }
    expect((await listDeliverables(taskId))[0].decisions).toHaveLength(0);
  });

  it("takes no answer the client did not choose (PJM-05)", async () => {
    const { taskId } = await taskWithVersion("Không chọn gì");
    const { token } = await linkOn(taskId);
    // The page preselects nothing, so a form sent past the browser's own check arrives with no
    // decision in it. Nothing is recorded, and the link is not spent on it.
    for (const decision of ["", "approve", "on"]) {
      expect(await decide(token, { decision }, "no-choice")).toEqual({ ok: false, error: "invalid" });
    }
    expect((await listDeliverables(taskId))[0]).toMatchObject({ decision: "pending", frozenAt: null, decisions: [] });
    expect((await listPreviewLinks(taskId))[0].state).toBe("active");
    // Chosen, the same link takes it.
    expect(await decide(token, { decision: "approved" }, "no-choice")).toEqual({ ok: true, data: { recorded: true } });
  });

  it("drops what a machine sends, and tells it nothing", async () => {
    const { taskId } = await taskWithVersion("Bẫy máy");
    const { token } = await linkOn(taskId);
    // The honeypot answer is the success answer: a bot told it was caught tries again differently.
    expect(await decideOnPreviewLink({ token, website: "https://buy-now.example", version: "1", decision: "approved", decidedByName: "bot", comment: "" }, visitor("bot"))).toEqual({ ok: true, data: { recorded: true } });
    expect((await listDeliverables(taskId))[0].decisions).toHaveLength(0);
    expect((await listPreviewLinks(taskId))[0].state).toBe("active");
  });
});

describe("the version a link is for (FR-PJM-51a)", () => {
  it("is fixed when the link is made, so a later version never becomes what the client sees", async () => {
    const { taskId } = await taskWithVersion("Chốt phiên bản lúc tạo link");
    // The internal reviewer passes v1; the account manager then makes a link for "whichever is current".
    await decideReview(taskId, "approved", null, actor("tam"));
    const { link, token } = await linkOn(taskId);
    expect(link.deliverableId).not.toBeNull();

    // Work carries on and v2 is handed in days later. The client is still looking at what was sent.
    await submitDeliverable(taskId, { kind: "link", url: "https://drive.google.com/v2", note: null }, actor("huy"));
    const outcome = await openPreviewLink(token, visitor("pinned"));
    expect(outcome.ok && outcome.page).toMatchObject({ version: 1, url: "https://drive.google.com/v1" });
    expect((await listPreviewLinks(taskId))[0].version).toBe(1);
  });

  it("has to have cleared internal review: a version waiting at a chain's own stage cannot be sent", async () => {
    const projectId = (await createProject({ teamId: ids.video, name: "KV mùa hè", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
    await setProjectMember(projectId, ids.an, "account_manager");
    await saveReviewChain(
      { teamId: ids.video, projectId },
      null,
      { name: "Nội bộ rồi tới khách", contentFormat: null, stages: [{ name: "Trưởng nhóm duyệt", reviewer: `person:${ids.tam}`, dueHours: null }, { name: "Khách duyệt", reviewer: "client", dueHours: null }], isActive: true },
      ids.long,
    );
    const { taskId } = await taskWithVersion("Chưa qua duyệt nội bộ", projectId);

    // The chain says a lead looks at it first, so there is nothing to hand the client yet.
    await expect(linkOn(taskId)).rejects.toThrow("preview_version_not_ready");
    await decideStage(taskId, { decision: "approved", comment: null, client: null }, actor("tam"));
    const { token } = await linkOn(taskId);
    expect((await openPreviewLink(token, visitor("chain"))).ok).toBe(true);
  });

  it("closes the link when the company takes the version back", async () => {
    const { taskId, deliverableId } = await taskWithVersion("Rút lại bản dựng");
    const { token } = await linkOn(taskId);
    await db().update(schema.workDeliverable).set({ decision: "changes_requested" }).where(eq(schema.workDeliverable.id, deliverableId));
    expect(await openPreviewLink(token, visitor("withdrawn"))).toEqual({ ok: false, reason: "closed" });
    expect(await decide(token, {}, "withdrawn")).toMatchObject({ ok: false, message: "preview_link_closed" });
  });

  it("takes an answer only about the version the client was looking at", async () => {
    const { taskId } = await taskWithVersion("Trả lời nhầm phiên bản");
    const { token } = await linkOn(taskId);
    // A tab open since before the work moved on posts the version it showed, and is told plainly.
    expect(await decide(token, { version: "2" }, "stale")).toMatchObject({ ok: false, message: "preview_version_changed" });
    // Refusing it does not spend the link: the client reloads and answers about what they now see.
    expect((await listPreviewLinks(taskId))[0].state).toBe("active");
    expect(await decide(token, { version: "1" }, "stale")).toEqual({ ok: true, data: { recorded: true } });
  });
});

describe("the file behind a link (PJM-06)", () => {
  const closed = { ok: false, reason: "closed" };

  it("is never a storage URL on the page: the page names the file and says whether it is a picture", async () => {
    const picture = await taskWithFile("Key visual", "kv-tet.png");
    const { token } = await linkOn(picture.taskId);
    const before = storage.signed.length;
    const outcome = await openPreviewLink(token, visitor("file-page"));
    expect(outcome.ok && outcome.page).toMatchObject({ kind: "file", url: null, fileName: "kv-tet.png", fileIsImage: true });
    // Nothing was signed to render the page, and nothing of storage — or the file's id — is on it.
    expect(storage.signed).toHaveLength(before);
    const printed = JSON.stringify(outcome);
    for (const secret of ["storage.invalid", picture.fileId, picture.objectPath]) expect(printed).not.toContain(secret);

    // A cut is a file too, and not something an <img> can show.
    const cut = await taskWithFile("Bản dựng", "teaser-v1.mp4");
    const video = await openPreviewLink((await linkOn(cut.taskId)).token, visitor("file-page"));
    expect(video.ok && video.page).toMatchObject({ kind: "file", url: null, fileName: "teaser-v1.mp4", fileIsImage: false, fileIsVideo: true });
  });

  it("is signed afresh each time it is asked for, for as long as the link is open — and is not a view", async () => {
    const { taskId, objectPath } = await taskWithFile("Mở tệp nhiều lần", "poster.jpg");
    const { token } = await linkOn(taskId);
    const first = await openPreviewFile(token, visitor("file-open"));
    const second = await openPreviewFile(token, visitor("file-open"));
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    // A minute each, and each its own: the page's address never goes stale, the signed one always does.
    expect(first.ok && first.url).toContain(`${objectPath}?expires=60`);
    expect(first.ok && second.ok && first.url !== second.url).toBe(true);
    // Fetching the file is part of looking at the page: the link has still not been "viewed".
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "active", viewCount: 0, lastViewedAt: null });
    await openPreviewLink(token, visitor("file-open"));
    await openPreviewFile(token, visitor("file-open"));
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "viewed", viewCount: 1 });
  });

  it("is refused, the same way and with nothing signed, on a token nobody issued and on a link that expired, was revoked or was decided", async () => {
    const { taskId } = await taskWithFile("Mọi cách đóng đều giống nhau, cả với tệp", "storyboard.pdf");
    const expired = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));
    const revoked = await linkOn(taskId);
    const decided = await linkOn(taskId);
    // Each opened while it could be…
    for (const link of [revoked, decided]) expect((await openPreviewFile(link.token, visitor("file-closed"))).ok).toBe(true);
    await revokePreviewLink(revoked.link.id, ids.long);
    expect(await decide(decided.token, { decision: "changes_required", comment: "Đổi khung 3" }, "file-closed")).toEqual({ ok: true, data: { recorded: true } });

    // …and none of them after. A URL signed earlier lives out its minute; no new one is made.
    const before = storage.signed.length;
    for (const token of ["Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", "not a token at all", expired.token, revoked.token, decided.token]) {
      expect(await openPreviewFile(token, visitor("file-closed")), token).toEqual(closed);
    }
    expect(storage.signed).toHaveLength(before);
  });

  it("closes with the page when the company takes the version back", async () => {
    const { taskId, deliverableId } = await taskWithFile("Rút lại tệp", "banner.png");
    const { token } = await linkOn(taskId);
    expect((await openPreviewFile(token, visitor("file-withdrawn"))).ok).toBe(true);
    await db().update(schema.workDeliverable).set({ decision: "changes_requested" }).where(eq(schema.workDeliverable.id, deliverableId));
    expect(await openPreviewFile(token, visitor("file-withdrawn"))).toEqual(closed);
  });

  it("has nothing to give for a version that is a link, or a file that is gone", async () => {
    const link = await taskWithVersion("Phiên bản là đường dẫn");
    expect(await openPreviewFile((await linkOn(link.taskId)).token, visitor("file-none"))).toEqual({ ok: false, reason: "no_file" });

    const gone = await taskWithFile("Tệp đã xoá", "old-cut.mp4");
    const { token } = await linkOn(gone.taskId);
    await db().update(schema.storedFile).set({ deletedAt: new Date() }).where(eq(schema.storedFile.id, gone.fileId));
    expect(await openPreviewFile(token, visitor("file-none"))).toEqual({ ok: false, reason: "no_file" });
    // The page still opens, and says the file cannot be had instead of linking to nothing.
    const page = await openPreviewLink(token, visitor("file-none"));
    expect(page.ok && page.page).toMatchObject({ kind: "file", url: null, fileName: null, fileIsImage: false });
  });

  it("says so, and does not throw, when storage cannot sign", async () => {
    const { taskId } = await taskWithFile("Kho tệp lỗi", "poster.png");
    const { token } = await linkOn(taskId);
    storage.down = true;
    try {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await openPreviewFile(token, visitor("file-down"))).toEqual({ ok: false, reason: "unavailable" });
      expect(logged.mock.calls[0]?.[0]).toContain("work.preview.file_url_failed");
      logged.mockRestore();
      // The page does not depend on storage at all any more.
      expect((await openPreviewLink(token, visitor("file-down"))).ok).toBe(true);
    } finally {
      storage.down = false;
    }
  });

  it("has an allowance of its own: hammering the file is refused, and does not spend the page's", async () => {
    const { taskId } = await taskWithFile("Gọi tệp liên tục", "kv.png");
    const { token } = await linkOn(taskId);
    const hammer = visitor("file-hammer");
    expect(await openPreviewFile(token, hammer)).toMatchObject({ ok: true });
    // The allowance is sized for a video scrubbed through — hundreds — so the counter is moved to
    // one short of it rather than asked that many times: the last allowed fetch, then the refusal.
    await db()
      .update(schema.workPreviewHit)
      .set({ hits: PREVIEW_LIMITS.file.max - 1 })
      .where(and(eq(schema.workPreviewHit.bucket, "file"), eq(schema.workPreviewHit.keyHash, previewVisitorKey(hammer.ipHash, new Date()))));
    expect(await openPreviewFile(token, hammer)).toMatchObject({ ok: true });
    expect(await openPreviewFile(token, hammer)).toEqual({ ok: false, reason: "rate_limited" });
    // The same visitor can still open the page: looking at the work is counted apart from opening it.
    expect((await openPreviewLink(token, hammer)).ok).toBe(true);
    // And a token of the wrong shape writes nothing, here as on the page.
    const before = (await db().select().from(schema.workPreviewHit)).length;
    expect(await openPreviewFile("not a token at all", hammer)).toEqual(closed);
    expect(await db().select().from(schema.workPreviewHit)).toHaveLength(before);
  });
});

describe("the claim a decision takes on a link", () => {
  it("is refused on a link that ran out while the request was reading", async () => {
    const { taskId } = await taskWithVersion("Hết hạn giữa chừng");
    const { link } = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, link.id));
    expect(await claimLink(link.id, new Date())).toBe(false);
  });

  it("is given back only by the request that made it", async () => {
    const { taskId } = await taskWithVersion("Chỉ nhả claim của mình");
    const { link } = await linkOn(taskId);
    const mine = new Date();
    expect(await claimLink(link.id, mine)).toBe(true);
    // The first request's release is still in flight when a second one's claim lands.
    const theirs = new Date(mine.getTime() + 1000);
    await db().update(schema.workPreviewLink).set({ decidedAt: theirs }).where(eq(schema.workPreviewLink.id, link.id));
    await releaseClaim(link.id, mine);
    const [row] = await db().select().from(schema.workPreviewLink).where(eq(schema.workPreviewLink.id, link.id));
    expect(row.decidedAt).toEqual(theirs);
  });
});

describe("what this page keeps about the client (PDPL, NFR-PRV-02)", () => {
  it("writes nothing at all for a token that is not even the right shape", async () => {
    const before = (await db().select().from(schema.workPreviewHit)).length;
    expect(await openPreviewLink("not a token at all", visitor("junk"))).toEqual({ ok: false, reason: "closed" });
    expect(await db().select().from(schema.workPreviewHit)).toHaveLength(before);
  });

  it("keys the counter and the audit row on a fingerprint that changes daily, and keeps no user agent", async () => {
    const { taskId } = await taskWithVersion("Dấu vết một chiều");
    const { token } = await linkOn(taskId);
    const who = visitor("pdpl");
    await openPreviewLink(token, who);
    expect(await decideOnPreviewLink({ token, website: "", version: "1", decision: "approved", decidedByName: "Chị Mai", comment: "" }, who)).toEqual({ ok: true, data: { recorded: true } });

    const today = previewVisitorKey(who.ipHash, new Date());
    expect(today).not.toBe(who.ipHash);
    // Tomorrow's key for the same connection is a different key: nothing kept here joins across days.
    expect(previewVisitorKey(who.ipHash, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))).not.toBe(today);

    const audit = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, "work.preview.decide")).orderBy(desc(schema.auditLog.id));
    expect({ ipAddress: audit[0].ipAddress, userAgent: audit[0].userAgent }).toEqual({ ipAddress: today, userAgent: null });
    // No decision ever recorded here carries the key the rest of the product keys a visitor on.
    expect(audit.every((row) => row.ipAddress !== who.ipHash)).toBe(true);
    // Neither the long-lived row nor the counter holds the key the rest of the product uses.
    expect(await db().select().from(schema.workPreviewHit).where(eq(schema.workPreviewHit.keyHash, who.ipHash))).toHaveLength(0);
  });
});

describe("abuse resistance", () => {
  it("refuses a visitor who walks the token space, and sweeps its counters afterwards", async () => {
    const walker = visitor("walker");
    const answers = [];
    for (let attempt = 0; attempt < PREVIEW_LIMITS.view.max + 1; attempt++) {
      answers.push(await openPreviewLink("Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", walker));
    }
    expect(answers[PREVIEW_LIMITS.view.max - 1]).toEqual({ ok: false, reason: "closed" });
    expect(answers[PREVIEW_LIMITS.view.max]).toEqual({ ok: false, reason: "rate_limited" });
    // Unknown tokens cost one row per visitor, not one per token: the table cannot be filled by
    // invention. The row is keyed by the day's key, never by anything that outlives the day.
    const rows = await db().select().from(schema.workPreviewHit).where(eq(schema.workPreviewHit.keyHash, previewVisitorKey(walker.ipHash, new Date())));
    expect(rows).toHaveLength(1);
    expect(await purgePreviewHits(new Date(Date.now() + 60_000))).toBeGreaterThan(0);
  });
});

describe("who is asking: a person, or a machine on a person's behalf (R14)", () => {
  /** Zalo's own browser on a phone — where a client in Vietnam opens most links, and a person reading. */
  const ZALO_IN_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/531 ZaloTheme/light ZaloLanguage/vn";
  /** What fetches a link the moment it is pasted into a chat; the whole table is in `engine/preview.test.ts`. */
  const FETCHERS = ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Mozilla/5.0 (compatible; Zalo/1.0; +https://zalo.me)", "TelegramBot (like TwitterBot)", null];

  it("neither counts nor audits a chat app's fetch, and never gives it the work", async () => {
    const { taskId } = await taskWithFile("Dán link vào Zalo", "teaser-zalo.mp4");
    const { token } = await linkOn(taskId);
    const hits = async () => (await db().select().from(schema.workPreviewHit)).length;
    const [hitsBefore, auditBefore, signedBefore] = [await hits(), (await viewAuditsOf(taskId)).length, storage.signed.length];

    for (const userAgent of FETCHERS) {
      const bot = { ipHash: "visitor-unfurl", userAgent };
      expect(await openPreviewLink(token, bot), String(userAgent)).toEqual({ ok: false, reason: "not_a_view" });
      expect(await openPreviewFile(token, bot), String(userAgent)).toEqual({ ok: false, reason: "not_a_view" });
      // The same answer for a token nobody issued and for one that is not even a token: the link is never looked up.
      expect(await openPreviewLink("Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", bot)).toEqual({ ok: false, reason: "not_a_view" });
      expect(await openPreviewLink("not a token at all", bot)).toEqual({ ok: false, reason: "not_a_view" });
    }

    // Not viewed, not counted against anybody, not in the audit log, and nothing signed.
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "active", viewCount: 0, lastViewedAt: null });
    expect(await hits()).toBe(hitsBefore);
    expect(await viewAuditsOf(taskId)).toHaveLength(auditBefore);
    expect(storage.signed).toHaveLength(signedBefore);

    // The client then opens it from the same chat, in Zalo's own browser: that is the first view.
    expect((await openPreviewLink(token, { ipHash: "visitor-unfurl", userAgent: ZALO_IN_APP })).ok).toBe(true);
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "viewed", viewCount: 1 });
  });
});

describe("the audit trail of a link (R14)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("audits a view once an hour per visitor per link, and counts every one", async () => {
    // Twenty past some hour, so nothing below straddles the top of one by accident.
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 20 * 60_000;
    vi.setSystemTime(start);

    const { taskId, deliverableId } = await taskWithVersion("Nhật ký lượt xem");
    const { link, token } = await linkOn(taskId);
    const mai = visitor("audit-mai");

    await openPreviewLink(token, mai);
    await openPreviewLink(token, mai);
    await openPreviewLink(token, mai);
    // Three reloads are three on the counter and one line in the log.
    expect((await listPreviewLinks(taskId))[0].viewCount).toBe(3);
    const [entry, ...rest] = await viewAuditsOf(taskId);
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ action: "work.preview.view", resourceType: "task:work", resourceId: taskId, entityId: ids.szm, actorPersonId: null, actorUserId: null, userAgent: null });
    expect(entry.after).toEqual({ linkId: link.id, deliverableId, version: 1 });
    // The visitor is the day's key — never the token, the pipeline's own key or a user agent.
    expect(entry.ipAddress).toBe(previewVisitorKey(mai.ipHash, new Date()));
    expect(printed(entry)).not.toContain(token);
    expect(printed(entry)).not.toContain(mai.ipHash);

    // Somebody else on the same link is another line; the same person on another link is too.
    await openPreviewLink(token, visitor("audit-colleague"));
    expect(await viewAuditsOf(taskId)).toHaveLength(2);
    const second = await linkOn(taskId);
    await openPreviewLink(second.token, mai);
    expect(await viewAuditsOf(taskId)).toHaveLength(3);

    // An hour on, the same visitor on the same link is audited again.
    vi.setSystemTime(start + 61 * 60_000);
    await openPreviewLink(token, mai);
    await openPreviewLink(token, mai);
    expect(await viewAuditsOf(taskId)).toHaveLength(4);
    expect((await listPreviewLinks(taskId)).find((row) => row.id === link.id)!.viewCount).toBe(6);
  });

  it("does not audit a closed link's page, and does not audit the file as a second view", async () => {
    const { taskId } = await taskWithFile("Tệp không phải lượt xem", "kv-audit.png");
    const { link, token } = await linkOn(taskId);
    const who = visitor("audit-file");
    await openPreviewFile(token, who);
    // Fetching the file writes no view, and a directory-tier file writes no `file.read` either.
    expect(await viewAuditsOf(taskId)).toHaveLength(0);
    await openPreviewLink(token, who);
    await openPreviewFile(token, who);
    expect(await viewAuditsOf(taskId)).toHaveLength(1);
    expect(await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "file.read"), eq(schema.auditLog.resourceId, taskId)))).toHaveLength(0);

    await revokePreviewLink(link.id, ids.long);
    expect(await openPreviewLink(token, visitor("audit-late"))).toEqual({ ok: false, reason: "closed" });
    expect(await viewAuditsOf(taskId)).toHaveLength(1);
  });

  it("names the link and the visitor — not the account manager — when a restricted file is opened through it", async () => {
    const { taskId, fileId } = await taskWithFile("Tệp hạn chế qua link", "contract-scan.pdf");
    await db().update(schema.storedFile).set({ tier: "restricted" }).where(eq(schema.storedFile.id, fileId));
    const { link, token } = await linkOn(taskId);
    const who = visitor("audit-restricted");
    expect((await openPreviewFile(token, who)).ok).toBe(true);

    const reads = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "file.read"), eq(schema.auditLog.resourceId, taskId)));
    // Still audited, exactly as inside the company — and it does not say the sender opened it.
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ actorPersonId: null, resourceType: "work_task", summary: "contract-scan.pdf", ipAddress: previewVisitorKey(who.ipHash, new Date()), userAgent: null });
    expect(reads[0].after).toEqual({ via: "work_preview_link", id: link.id });
    expect(printed(reads[0])).not.toContain(ids.an);
  });
});

describe("closed beats busy", () => {
  /** Spends a link's whole allowance for this hour — and the next, should the hour turn mid-test. */
  const exhaust = async (bucket: "token_view" | "token_file" | "token_decide", tokenHash: string) => {
    const window = PREVIEW_LIMITS[bucket].windowSeconds * 1000;
    const start = Math.floor(Date.now() / window) * window;
    await db().insert(schema.workPreviewHit).values([start, start + window].map((at) => ({ bucket, keyHash: tokenHash, windowStart: new Date(at), hits: PREVIEW_LIMITS[bucket].max, lastAt: new Date() })));
  };

  it("says busy of a hammered link only while it is open: expired, revoked, decided or taken back, it is closed", async () => {
    const { taskId, deliverableId } = await taskWithFile("Đóng thì nói đóng", "kv-closed.png");
    const links = { open: await linkOn(taskId), expired: await linkOn(taskId), revoked: await linkOn(taskId), decided: await linkOn(taskId), withdrawn: await linkOn(taskId) };
    for (const { link } of Object.values(links)) for (const bucket of ["token_view", "token_file", "token_decide"] as const) await exhaust(bucket, link.tokenHash);

    // An open link that is being hammered is busy, on the page, the file and the answer alike.
    expect(await openPreviewLink(links.open.token, visitor("busy-1"))).toEqual({ ok: false, reason: "rate_limited" });
    expect(await openPreviewFile(links.open.token, visitor("busy-1"))).toEqual({ ok: false, reason: "rate_limited" });
    expect(await decide(links.open.token, {}, "busy-1")).toMatchObject({ ok: false, message: "rate_limited" });

    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, links.expired.link.id));
    await revokePreviewLink(links.revoked.link.id, ids.long);
    await db().update(schema.workPreviewLink).set({ decidedAt: new Date() }).where(eq(schema.workPreviewLink.id, links.decided.link.id));
    // The same answer as a token nobody issued, however hard each was hammered: no way to tell
    // from outside that any of them was ever real.
    for (const [name, { token }] of Object.entries(links).filter(([name]) => name !== "open" && name !== "withdrawn")) {
      expect(await openPreviewLink(token, visitor("busy-2")), name).toEqual({ ok: false, reason: "closed" });
      expect(await openPreviewFile(token, visitor("busy-2")), name).toEqual({ ok: false, reason: "closed" });
      expect(await decide(token, {}, "busy-2"), name).toMatchObject({ ok: false, message: "preview_link_closed" });
    }
    expect(await openPreviewLink("Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", visitor("busy-2"))).toEqual({ ok: false, reason: "closed" });

    // The company takes the version back: every link to it is closed, hammered or not.
    await db().update(schema.workDeliverable).set({ decision: "changes_requested" }).where(eq(schema.workDeliverable.id, deliverableId));
    for (const token of [links.withdrawn.token, links.open.token]) {
      expect(await openPreviewLink(token, visitor("busy-3"))).toEqual({ ok: false, reason: "closed" });
      expect(await openPreviewFile(token, visitor("busy-3"))).toEqual({ ok: false, reason: "closed" });
      expect(await decide(token, {}, "busy-3")).toMatchObject({ ok: false, message: "preview_link_closed" });
    }
  });

  it("still counts the visitor first, whatever the token is", async () => {
    const { taskId } = await taskWithVersion("Giới hạn theo người xem vẫn áp trước");
    const expired = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));
    const walker = visitor("busy-walker");
    const answers = [];
    for (let attempt = 0; attempt < PREVIEW_LIMITS.view.max + 1; attempt++) answers.push(await openPreviewLink(expired.token, walker));
    // A closed link costs the visitor's allowance like any other request, and nothing of the link's own.
    expect(answers[PREVIEW_LIMITS.view.max - 1]).toEqual({ ok: false, reason: "closed" });
    expect(answers[PREVIEW_LIMITS.view.max]).toEqual({ ok: false, reason: "rate_limited" });
    expect(await db().select().from(schema.workPreviewHit).where(eq(schema.workPreviewHit.keyHash, expired.link.tokenHash))).toHaveLength(0);
  });
});

describe("a video is watched on the page", () => {
  it("is named a video on the page and signed for half an hour — a picture keeps its minute", async () => {
    const cut = await taskWithFile("Bản dựng xem tại chỗ", "teaser-v3.mp4");
    const { token } = await linkOn(cut.taskId);
    const page = await openPreviewLink(token, visitor("video"));
    expect(page.ok && page.page).toMatchObject({ kind: "file", url: null, fileName: "teaser-v3.mp4", fileIsImage: false, fileIsVideo: true });

    const file = await openPreviewFile(token, visitor("video"));
    expect(PREVIEW_MEDIA_LINK_SECONDS).toBe(30 * 60);
    expect(file.ok && file.url).toContain(`${cut.objectPath}?expires=${PREVIEW_MEDIA_LINK_SECONDS}`);
    // Only this route, only this link's own version: every other file keeps the minute.
    for (const name of ["poster-v3.png", "storyboard-v3.pdf", "voice-v3.mp3"]) {
      const other = await taskWithFile(`Không phải video: ${name}`, name);
      const outcome = await openPreviewFile((await linkOn(other.taskId)).token, visitor("video"));
      expect(outcome.ok && outcome.url, name).toContain(`${other.objectPath}?expires=60`);
    }
  });
});

describe("the project's live links in one place (R14)", () => {
  it("is for whoever may hand a client a link on the project, and nobody else", async () => {
    const facts = async (projectId: string) => {
      const found = (await findProject(projectId))!;
      return projectFacts(found.project, found.team);
    };
    const [open, secret] = [await facts(ids.project), await facts(ids.secret)];
    // The account manager, the project's lead, the team's lead.
    for (const key of ["an", "tam", "long"] as const) expect(canSeeProjectPreviewLinks(await viewer(key), open), key).toBe(true);
    // Somebody doing the work, and a stranger.
    for (const key of ["huy", "khoi"] as const) expect(canSeeProjectPreviewLinks(await viewer(key), open), key).toBe(false);
    // A private project: its member still does not see who was sent what.
    expect(canSeeProjectPreviewLinks(await viewer("an"), secret)).toBe(true);
    expect(canSeeProjectPreviewLinks(await viewer("huy"), secret)).toBe(false);
    // It is the rule a link is created under: the same people, task by task.
    const { taskId } = await taskWithVersion("Cùng một quy tắc");
    const task = (await loadTask(taskId))!.facts;
    for (const key of ["an", "tam", "long", "huy", "khoi"] as const) {
      expect(canSeeProjectPreviewLinks(await viewer(key), open), key).toBe(canManagePreviewLinks(await viewer(key), task, { accountManagerPersonId: null }));
    }
  });

  it("lists what is still out there across the project's tasks, and nothing that is not", async () => {
    const projectId = (await createProject({ teamId: ids.video, name: "Chiến dịch 12.12", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
    await setProjectMember(projectId, ids.an, "account_manager");
    const one = await taskWithVersion("Teaser 15s", projectId);
    const two = await taskWithVersion("Key visual", projectId);
    const elsewhere = await taskWithVersion("Việc của dự án khác");

    const live = await linkOn(one.taskId, { label: "Chị Mai" });
    const viewOnly = await linkOn(two.taskId, { label: "Anh Tú", allowDecision: false });
    const answered = await linkOn(two.taskId, { label: "Chị Hà" });
    const revoked = await linkOn(one.taskId);
    const expired = await linkOn(one.taskId);
    await linkOn(elsewhere.taskId);
    await openPreviewLink(live.token, visitor("project-list"));
    expect(await decide(answered.token, { decision: "approved_with_changes", comment: "Đổi màu chữ" }, "project-list")).toEqual({ ok: true, data: { recorded: true } });
    await revokePreviewLink(revoked.link.id, ids.an);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));

    const rows = await listProjectPreviewLinks(projectId);
    const row = (id: string) => rows.find((candidate) => candidate.id === id)!;
    // The revoked and the expired ones are gone, the other project's was never there; newest first.
    expect(rows.map((candidate) => candidate.id).sort()).toEqual([answered.link.id, viewOnly.link.id, live.link.id].sort());
    expect(rows.map((candidate) => candidate.createdAt.getTime())).toEqual(rows.map((candidate) => candidate.createdAt.getTime()).sort((a, b) => b - a));
    expect(row(live.link.id)).toMatchObject({ taskId: one.taskId, taskTitle: "Teaser 15s", label: "Chị Mai", version: 1, state: "viewed", viewCount: 1, createdByPersonId: ids.an, createdByName: "an", allowDecision: true, decision: null });
    expect(row(live.link.id).taskKey).toMatch(/^VID-\d+$/);
    expect(row(viewOnly.link.id)).toMatchObject({ taskId: two.taskId, label: "Anh Tú", state: "active", viewCount: 0, allowDecision: false });
    // Answered: spent, and still part of what was sent until it expires.
    expect(row(answered.link.id)).toMatchObject({ taskId: two.taskId, label: "Chị Hà", state: "decided", decision: "approved_with_changes" });
    // Nothing on the list could open a link: it carries no token and no hash of one.
    expect(JSON.stringify(rows)).not.toContain(live.token);
    expect(JSON.stringify(rows)).not.toContain(live.link.tokenHash);
  });
});

describe("links that have outlived their reason (R14)", () => {
  it("are taken back by the nightly sweep — a closed project's and a leaver's — and the audit says why", async () => {
    const projectId = (await createProject({ teamId: ids.video, name: "Dự án sắp đóng", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
    await setProjectMember(projectId, ids.an, "account_manager");
    const closing = await taskWithVersion("Việc của dự án sắp đóng", projectId);
    const ofClosed = await linkOn(closing.taskId);
    const answered = await linkOn(closing.taskId);
    expect(await decide(answered.token, { decision: "changes_required", comment: "Sửa logo" }, "sweep")).toEqual({ ok: true, data: { recorded: true } });

    // Somebody who made a link on a project that stays open, and then left.
    const [leaver] = await db().insert(schema.person).values({ fullName: "minh", searchName: "minh", workEmail: "minh@suzu.group", status: "active", primaryEntityId: ids.szm }).returning();
    const staying = await taskWithVersion("Việc của người sắp nghỉ");
    const ofLeaver = await createPreviewLink({ taskId: staying.taskId, deliverableId: null, label: "Anh Nam", message: null, allowDecision: true, days: 14 }, leaver.id);
    const untouched = await linkOn(staying.taskId);

    // Nothing has changed yet: a sweep finds nothing to take back.
    expect(await sweepPreviewLinks()).toEqual({ project_closed: 0, creator_offboarded: 0 });

    await db().update(schema.workProject).set({ status: "done" }).where(eq(schema.workProject.id, projectId));
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, leaver.id));
    expect(await sweepPreviewLinks()).toEqual({ project_closed: 1, creator_offboarded: 1 });

    const rowOf = async (id: string) => (await db().select().from(schema.workPreviewLink).where(eq(schema.workPreviewLink.id, id)))[0];
    // Revoked by nobody in particular; the client's page says its one sentence.
    for (const swept of [ofClosed, ofLeaver]) {
      const row = await rowOf(swept.link.id);
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedByPersonId).toBeNull();
      expect(await openPreviewLink(swept.token, visitor("sweep"))).toEqual({ ok: false, reason: "closed" });
    }
    // An answered link keeps its record as it was; a colleague's link on the open project is untouched.
    expect((await rowOf(answered.link.id)).revokedAt).toBeNull();
    expect((await rowOf(untouched.link.id)).revokedAt).toBeNull();
    expect((await openPreviewLink(untouched.token, visitor("sweep"))).ok).toBe(true);

    // The audit entry is on the task, names the link, and gives the reason.
    const reasonOf = async (taskId: string) => {
      const rows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "work.preview_link.revoke"), eq(schema.auditLog.resourceId, taskId)));
      return rows.map((row) => ({ after: row.after as { linkId: string; reason: string }, summary: row.summary, entityId: row.entityId, actorPersonId: row.actorPersonId }));
    };
    const closedAudit = await reasonOf(closing.taskId);
    expect(closedAudit).toHaveLength(1);
    expect(closedAudit[0]).toMatchObject({ after: { linkId: ofClosed.link.id, reason: "project_closed" }, entityId: ids.szm, actorPersonId: null });
    expect(closedAudit[0].summary).toContain("the project is finished or archived");
    const leaverAudit = await reasonOf(staying.taskId);
    expect(leaverAudit).toHaveLength(1);
    expect(leaverAudit[0]).toMatchObject({ after: { linkId: ofLeaver.link.id, reason: "creator_offboarded" } });
    expect(leaverAudit[0].summary).toContain("has left the company");

    // Run again the same night: nothing more to do, nothing more written.
    expect(await sweepPreviewLinks()).toEqual({ project_closed: 0, creator_offboarded: 0 });
    expect(await reasonOf(closing.taskId)).toHaveLength(1);

    // And no new link is made on a project that is finished: it would be gone by morning.
    await expect(linkOn(closing.taskId)).rejects.toThrow("preview_project_closed");
    await db().update(schema.workProject).set({ status: "archived" }).where(eq(schema.workProject.id, projectId));
    await expect(linkOn(closing.taskId)).rejects.toThrow("preview_project_closed");
  });
});

describe("the public page", () => {
  const ROOT = join(import.meta.dirname, "..", "..", "app", "(preview)");
  const sources = (function everySourceFile(directory: string): { path: string; source: string }[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return everySourceFile(path);
      return /\.tsx?$/.test(entry) ? [{ path, source: readFileSync(path, "utf8") }] : [];
    });
  })(ROOT);

  it("exists at all (the guard would otherwise be vacuous)", () => {
    // The layout, the page, the decision endpoint and the file route.
    expect(sources.length).toBeGreaterThanOrEqual(4);
    expect(sources.some(({ path }) => path.endsWith(join("[token]", "file", "route.ts")))).toBe(true);
  });

  /** The code, without the comments: these files explain at length what they deliberately do not do. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("renders no navigation, no directory and nobody's name but the sender's", () => {
    for (const { path, source: whole } of sources) {
      const source = withoutComments(whole);
      // The app shell — navigation, the inbox, the command palette, the person in the corner — is
      // everything this page must not have. The language and theme switches are the two pieces it shares.
      const shellImports = [...source.matchAll(/from "@\/components\/shell\/([a-z-]+)"/g)].map((match) => match[1]);
      expect(shellImports, path).toEqual(shellImports.filter((name) => name === "locale-switch" || name === "theme-switch"));
      for (const forbidden of ["requireUser", "getCurrentUser", "loadViewer", "listPeople", "listTeams", "listAssignable", "listComments", "listActivity", "Sidebar", "NavLinks", "@/modules/core-hr", "@/modules/payroll", "@/modules/daily"]) {
        expect(source, `${path} must not reach for ${forbidden}`).not.toContain(forbidden);
      }
      // Everything it reads of work management comes through the module's one entry point.
      for (const importPath of [...source.matchAll(/from "(@\/modules\/work[^"]*)"/g)].map((match) => match[1])) {
        expect(importPath, path).toBe("@/modules/work/service");
      }
    }
  });

  const pageSource = () => withoutComments(sources.find(({ path }) => path.endsWith(join("[token]", "page.tsx")))!.source);

  it("says thank you to a returning submission before it looks at the link at all", () => {
    const source = pageSource();
    // A submission that was silently dropped and one that was recorded come back to the same page,
    // so the honeypot cannot be told apart by the one visitor it is aimed at: the thank-you is not
    // conditional on the link's state, and the link is not consulted to render it.
    const sent = source.indexOf('query.sent === "1"');
    expect(sent).toBeGreaterThan(-1);
    expect(sent).toBeLessThan(source.indexOf("await openPreviewLink("));
    expect(source).not.toContain("justSent");
  });

  it("puts the version the client is reading in the form", () => {
    expect(pageSource()).toContain('name="version"');
  });

  it("chooses no answer for the client: no decision is preselected, and the form will not go without one (PJM-05)", () => {
    const source = pageSource();
    const radio = source.match(/<RadioGroup [^>]*>/g) ?? [];
    expect(radio).toHaveLength(1);
    expect(radio[0]).toContain('name="decision"');
    expect(radio[0]).toContain("required");
    // However it is spelled: an approval is something the client does, never the page's default.
    expect(source).not.toMatch(/defaultChecked|\bchecked\b|defaultValue/);
  });

  it("links the file through the token's own route and prints no storage URL (PJM-06)", () => {
    const source = pageSource();
    expect(source).toContain("`/preview/${encodeURIComponent(token)}/file`");
    // The picture and the link share the one address; nothing on the page is signed.
    expect(source).toContain("<img src={fileHref}");
    expect(source).toContain("<a href={fileHref}");
    for (const forbidden of ["createDownloadLink", "createSignedDownloadUrl", "openPreviewFile", "@/modules/platform/files/service"]) expect(source).not.toContain(forbidden);
  });

  it("plays a video in the browser's own player, through the same route, with the download beside it — and ships no script", () => {
    const source = pageSource();
    const player = source.match(/<video[^>]*>/g) ?? [];
    expect(player).toHaveLength(1);
    for (const attribute of ["src={fileHref}", "controls", 'preload="metadata"', "playsInline"]) expect(player[0], attribute).toContain(attribute);
    // Nothing starts by itself, and the file's own link stays: a cut the browser cannot play is still had.
    expect(player[0]).not.toMatch(/autoPlay|muted/);
    expect(source.indexOf("<video")).toBeLessThan(source.lastIndexOf("<a href={fileHref}"));
    expect(source.slice(source.lastIndexOf("<a href={fileHref}"))).toContain("{page.fileName}");
    // No client code of the app's on this page: no player component, no script, no client boundary.
    for (const { path, source: whole } of sources) {
      const code = withoutComments(whole);
      for (const forbidden of ['"use client"', "<script", "<Script", "media-player", "@videojs", "dangerouslySetInnerHTML"]) expect(code, `${path} must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows a machine fetching on somebody's behalf a page that says nothing about the link", () => {
    const source = pageSource();
    const neutral = source.indexOf('outcome.reason === "not_a_view"');
    // Decided before the closed page and before anything of the work is rendered.
    expect(neutral).toBeGreaterThan(source.indexOf("await openPreviewLink("));
    expect(neutral).toBeLessThan(source.indexOf('t("closed.title")'));
    expect(neutral).toBeLessThan(source.indexOf("outcome.page"));
    expect(source).toContain('t("unfurl.title")');
  });
});

describe("the endpoint the answer is posted to", () => {
  const post = async (body: BodyInit | ReadableStream, headers: Record<string, string>, token = "abc") => {
    const { POST } = await import("../../app/(preview)/preview/[token]/decide/route");
    const request = new Request(`https://suzu.one/preview/${token}/decide`, { method: "POST", body, headers, duplex: "half" } as RequestInit);
    return POST(request, { params: Promise.resolve({ token }) });
  };
  /** Shaped like a real one, issued by nobody. */
  const STRANGER = "Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g";
  /** More than the cap, handed over in pieces — what a `content-length` never sees. */
  const chunks = (count: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < count; index++) controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1024)));
        controller.close();
      },
    });

  it("refuses a body that is too big however it arrives", async () => {
    // Declared honestly.
    const big = "x".repeat(70 * 1024);
    expect((await post(big, { "content-type": "application/x-www-form-urlencoded" })).headers.get("location")).toBe("/preview/abc?error=failed");
    // Declared as nothing at all, and sent in chunks: the guard that reads the header alone is blind
    // to this, so the bytes are counted as they arrive.
    expect((await post(chunks(16), { "content-type": "application/x-www-form-urlencoded" })).headers.get("location")).toBe("/preview/abc?error=failed");
    // Declared as small and sent large.
    expect((await post(chunks(16), { "content-type": "application/x-www-form-urlencoded", "content-length": "10" })).headers.get("location")).toBe("/preview/abc?error=failed");
  });

  it("sends a form with no decision in it back, as invalid (PJM-05)", async () => {
    const body = new URLSearchParams({ decidedByName: "Chị Mai", version: "1", comment: "", website: "" }).toString();
    const response = await post(body, { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) }, STRANGER);
    expect(response.headers.get("location")).toBe(`/preview/${STRANGER}?error=invalid`);
  });

  it("takes an ordinary form and hands it on", async () => {
    const body = new URLSearchParams({ decision: "approved", decidedByName: "Chị Mai", version: "1", comment: "", website: "" }).toString();
    const response = await post(body, { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) }, STRANGER);
    // The token is nobody's, so the answer is the closed page — but the body was read, not refused.
    expect(response.headers.get("location")).toBe(`/preview/${STRANGER}?error=preview_link_closed`);
  });
});

describe("the route the file is fetched from (PJM-06)", () => {
  /** A browser asks unless a test says who else does: a request with no user agent is not a person's. */
  const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const get = async (token: string, userAgent: string | null = BROWSER) => {
    const { GET } = await import("../../app/(preview)/preview/[token]/file/route");
    return GET(new Request(`https://suzu.one/preview/${token}/file`, { headers: userAgent ? { "user-agent": userAgent } : {} }), { params: Promise.resolve({ token }) });
  };
  /** What every answer of this route carries, whatever it is: never indexed, never stored, never a referrer. */
  const guarded = (response: Response) => ({ cache: response.headers.get("cache-control"), robots: response.headers.get("x-robots-tag"), referrer: response.headers.get("referrer-policy") });
  const GUARDED = { cache: "private, no-store, max-age=0", robots: "noindex, nofollow, noarchive, nosnippet", referrer: "no-referrer" };

  it("redirects an open link to a freshly signed URL, and counts no view", async () => {
    const { taskId, objectPath } = await taskWithFile("Mở tệp qua route", "kv-route.png");
    const { token } = await linkOn(taskId);
    const response = await get(token);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(`https://storage.invalid/${objectPath}?expires=60`);
    expect(guarded(response)).toEqual(GUARDED);
    expect(await response.text()).toBe("");
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "active", viewCount: 0 });
  });

  it("sends a wrong token, an expired link and a revoked one to the page's one sentence — never to storage", async () => {
    const { taskId } = await taskWithFile("Route từ chối", "kv-refused.png");
    const expired = await linkOn(taskId);
    await db().update(schema.workPreviewLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workPreviewLink.id, expired.link.id));
    const revoked = await linkOn(taskId);
    await revokePreviewLink(revoked.link.id, ids.long);

    const before = storage.signed.length;
    for (const token of ["Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", expired.token, revoked.token]) {
      const response = await get(token);
      // The same answer for all three, and nothing in it but the way back to the page.
      expect([response.status, response.headers.get("location")], token).toEqual([303, `/preview/${token}`]);
      expect(guarded(response), token).toEqual(GUARDED);
      expect(await response.text()).toBe("");
    }
    expect(storage.signed).toHaveLength(before);
    // A token is encoded on its way into the redirect, whatever was typed into the address.
    expect((await get("a b/c")).headers.get("location")).toBe("/preview/a%20b%2Fc");
  });

  it("gives a chat app's fetcher an empty answer and never the file, whatever the token", async () => {
    const { taskId } = await taskWithFile("Route: máy lấy xem trước", "kv-unfurl.png");
    const { token } = await linkOn(taskId);
    const before = storage.signed.length;
    for (const [asked, agent] of [[token, "facebookexternalhit/1.1"], [token, "TelegramBot (like TwitterBot)"], [token, null], ["Zm9yZ2VkLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g", "Slackbot-LinkExpanding 1.0"]] as const) {
      const response = await get(asked, agent);
      // No redirect to storage and none to the page: nothing to follow, nothing to learn.
      expect([response.status, response.headers.get("location"), await response.text()], String(agent)).toEqual([204, null, ""]);
      expect(guarded(response)).toEqual(GUARDED);
    }
    expect(storage.signed).toHaveLength(before);
    expect((await listPreviewLinks(taskId))[0]).toMatchObject({ state: "active", viewCount: 0 });
  });

  it("signs a video for the length of a viewing, so the page's player does not stop a minute in", async () => {
    const { taskId, objectPath } = await taskWithFile("Route: video", "cut-route.mp4");
    const response = await get((await linkOn(taskId)).token);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(`https://storage.invalid/${objectPath}?expires=1800`);
  });

  it("answers a version with no file, and storage that cannot sign, with a bare status", async () => {
    const link = await taskWithVersion("Route: phiên bản là đường dẫn");
    const none = await get((await linkOn(link.taskId)).token);
    expect([none.status, none.headers.get("location"), await none.text()]).toEqual([404, null, ""]);
    expect(guarded(none)).toEqual(GUARDED);

    const { taskId } = await taskWithFile("Route: kho tệp lỗi", "kv-down.png");
    const { token } = await linkOn(taskId);
    storage.down = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const down = await get(token);
      expect([down.status, down.headers.get("location"), await down.text()]).toEqual([503, null, ""]);
    } finally {
      storage.down = false;
      logged.mockRestore();
    }
  });
});
