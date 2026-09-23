// The client's expiring review link (D24, FR-PJM-51a) against a real Postgres (PGlite), and the
// public page around it.
//
// What is worth testing here is not that a link can be made but everything that must happen around
// it: that opening one counts a view and shows one version and nothing else, that the client's
// answer becomes the *same* record the account manager's own recording writes — freezing the
// version, counting the round, telling the team — that a link takes exactly one answer, that a
// closed link of any kind says the same thing, that a private project keeps its name, and that a
// script walking the token space runs out of allowance.
import { beforeAll, describe, expect, it, vi } from "vitest";

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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { PREVIEW_LIMITS } from "./engine/preview";
import { createPreviewLink, decideOnPreviewLink, listPreviewLinks, openPreviewLink, purgePreviewHits, revokePreviewLink } from "./preview";
import { canManagePreviewLinks, canRevokePreviewLink } from "./preview-policy";
import { createProject, setProjectMember } from "./projects";
import { listDeliverables, submitDeliverable } from "./reviews";
import { createWorkTask, loadTask } from "./tasks";
import { createTeam, listStates, saveClient, setTeamMember } from "./teams";
import { viewerOfPerson } from "./viewer";

type Key = "long" | "tam" | "huy" | "an" | "khoi";
const ids = {} as Record<Key | "szm" | "video" | "project" | "secret" | "client" | "edit", string>;
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const viewer = async (key: Key) => (await viewerOfPerson(db(), ids[key]))!;
/** A fresh visitor per test, so one test's requests never spend another's allowance. */
const visitor = (name: string) => ({ ipHash: `visitor-${name}`, userAgent: "a phone" });
const noticesOf = async (key: Key, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));

/** A task with one version handed in, ready to be sent to the client. */
async function taskWithVersion(title: string, projectId = ids.project) {
  const { task } = await createWorkTask({ teamId: ids.video, projectId, title, stateId: ids.edit, assigneePersonId: ids.huy }, ids.long);
  const { deliverable } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.google.com/v1", note: null }, actor("huy"));
  return { taskId: task.id, deliverableId: deliverable.id };
}

const linkOn = async (taskId: string, over: Partial<Parameters<typeof createPreviewLink>[0]> = {}) =>
  createPreviewLink({ taskId, deliverableId: null, label: "Chị Mai – Vinamilk", message: "Chị xem giúp em bản dựng.", allowDecision: true, days: 14, ...over }, ids.an);

const decide = (token: string, over: Partial<Parameters<typeof decideOnPreviewLink>[0]> = {}, from = "client") =>
  decideOnPreviewLink({ token, website: "", decision: "approved", decidedByName: "Chị Mai", comment: "", ...over }, visitor(from));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "an", "khoi"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
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
    expect(Object.keys(page!).sort()).toEqual(["allowDecision", "clientName", "expiresAt", "fileName", "kind", "message", "projectName", "recipientLabel", "senderName", "title", "url", "version"]);

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

  it("drops what a machine sends, and tells it nothing", async () => {
    const { taskId } = await taskWithVersion("Bẫy máy");
    const { token } = await linkOn(taskId);
    // The honeypot answer is the success answer: a bot told it was caught tries again differently.
    expect(await decideOnPreviewLink({ token, website: "https://buy-now.example", decision: "approved", decidedByName: "bot", comment: "" }, visitor("bot"))).toEqual({ ok: true, data: { recorded: true } });
    expect((await listDeliverables(taskId))[0].decisions).toHaveLength(0);
    expect((await listPreviewLinks(taskId))[0].state).toBe("active");
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
    // Unknown tokens cost one row per visitor, not one per token: the table cannot be filled by invention.
    const rows = await db().select().from(schema.workPreviewHit).where(eq(schema.workPreviewHit.keyHash, walker.ipHash));
    expect(rows).toHaveLength(1);
    expect(await purgePreviewHits(new Date(Date.now() + 60_000))).toBeGreaterThan(0);
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
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  /** The code, without the comments: these files explain at length what they deliberately do not do. */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("renders no navigation, no directory and nobody's name but the sender's", () => {
    for (const { path, source: whole } of sources) {
      const source = withoutComments(whole);
      // The app shell — navigation, the inbox, the command palette, the person in the corner — is
      // everything this page must not have. The language switch is the one piece it shares.
      const shellImports = [...source.matchAll(/from "@\/components\/shell\/([a-z-]+)"/g)].map((match) => match[1]);
      expect(shellImports, path).toEqual(shellImports.filter((name) => name === "locale-switch"));
      for (const forbidden of ["requireUser", "getCurrentUser", "loadViewer", "listPeople", "listTeams", "listAssignable", "listComments", "listActivity", "Sidebar", "NavLinks", "@/modules/core-hr", "@/modules/payroll", "@/modules/daily"]) {
        expect(source, `${path} must not reach for ${forbidden}`).not.toContain(forbidden);
      }
      // Everything it reads of work management comes through the module's one entry point.
      for (const importPath of [...source.matchAll(/from "(@\/modules\/work[^"]*)"/g)].map((match) => match[1])) {
        expect(importPath, path).toBe("@/modules/work/service");
      }
    }
  });
});
