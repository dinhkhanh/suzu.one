// The knowledge base against a real Postgres (PGlite): the SQL filters say what the policy says,
// publishing and versions, restricted subtrees that follow a move, search columns.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
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

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { pageVisibleSql, spaceEditableSql } from "./access-sql";
import { doc, heading, link, paragraph } from "./engine/build";
import { compareVersions, createPage, deletePage, getReadingView, levelOf, listTree, listVersions, loadPage, movePage, publishPage, recordView, restoreVersion, saveDraft, setPageAccess, setPageArchived, unpublishPage } from "./pages";
import { atLeast, type KbViewer, spaceLevel, viewerKeys } from "./policy";
import { createSpace, listSpaces, loadSpace, setSpaceAccess, setSpaceArchived } from "./spaces";

type Who = "owner" | "hrGroup" | "hrSzm" | "head" | "huy" | "khoi" | "ngo";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des", string>;
const viewers = {} as Record<Who, KbViewer>;
const spaces = {} as Record<"handbook" | "szmHr" | "video" | "tools" | "finance", string>;
const pages = {} as Record<"leave" | "leaveForms" | "managers" | "managersChild" | "draft" | "videoSop" | "toolsTip" | "szmPolicy", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.department).values({ code: "DES", name: "Design" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id });

  const people: [Who, string, string, Grant["role"] | null, "group" | "entity" | "department" | null, "employee" | "collaborator"][] = [
    ["owner", szm.id, vid.id, "owner", "group", "employee"],
    ["hrGroup", szm.id, vid.id, "hr_admin", "group", "employee"],
    ["hrSzm", szm.id, vid.id, "hr_staff", "entity", "employee"],
    ["head", szm.id, vid.id, "department_head", "department", "employee"],
    ["huy", szm.id, vid.id, null, null, "employee"],
    ["khoi", szc.id, des.id, null, null, "employee"],
    ["ngo", szm.id, vid.id, null, null, "collaborator"],
  ];
  for (const [key, entityId, departmentId, role, scope, workforceType] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType, primaryEntityId: entityId, departmentId }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : scope === "entity" ? { type: "entity", id: entityId } : { type: "department", id: departmentId } }] : [];
    const principal: Principal = { personId: row.id, workforceType, grants };
    viewers[key] = { principal, personId: row.id, keys: viewerKeys(principal, { entityId, departmentId, teamId: null }) };
  }

  const make = async (key: string, over: { entityId?: string | null; kind?: "open" | "controlled" }, access: { subjectKey: string; level: "view" | "edit" }[]) =>
    (await createSpace({ key, name: key, description: null, icon: null, entityId: over.entityId ?? null, kind: over.kind ?? "open", sortOrder: 0 }, ids.owner, access)).id;
  spaces.handbook = await make("handbook", { kind: "controlled" }, [{ subjectKey: "all", level: "view" }, { subjectKey: "role:hr_staff", level: "edit" }, { subjectKey: "role:hr_admin", level: "edit" }]);
  spaces.szmHr = await make("szm-hr", { entityId: szm.id, kind: "controlled" }, [{ subjectKey: `entity:${szm.id}`, level: "view" }]);
  spaces.video = await make("video", {}, [{ subjectKey: `department:${vid.id}`, level: "edit" }]);
  spaces.tools = await make("tools", {}, [{ subjectKey: "all", level: "edit" }, { subjectKey: `person:${ids.ngo}`, level: "view" }]);
  spaces.finance = await make("finance", {}, [{ subjectKey: "role:finance", level: "edit" }]);

  const actor = { personId: ids.hrGroup };
  const page = async (spaceId: string, title: string, parentId: string | null = null, publish = true) => {
    const row = await createPage({ spaceId, parentId, title, content: doc(heading(1, title), paragraph("Nội dung ", link("liên kết", "/kb"), ".")) }, actor);
    if (publish) await publishPage(row.id, actor);
    return row.id;
  };
  pages.leave = await page(spaces.handbook, "Quy định nghỉ phép");
  pages.leaveForms = await page(spaces.handbook, "Biểu mẫu nghỉ phép", pages.leave);
  pages.managers = await page(spaces.handbook, "Dành cho quản lý");
  pages.managersChild = await page(spaces.handbook, "Khung lương tham chiếu", pages.managers);
  pages.draft = await page(spaces.handbook, "Bản nháp nội quy", null, false);
  pages.videoSop = await page(spaces.video, "SOP dựng phim");
  pages.toolsTip = await page(spaces.tools, "Mẹo dùng Drive");
  pages.szmPolicy = await page(spaces.szmHr, "Nội quy SZM");
  await setPageAccess(pages.managers, [{ subjectKey: "role:department_head", level: "view" }]);
});

describe("the SQL filters and the policy agree", () => {
  it("lists exactly the spaces `spaceLevel` opens, with the same level", async () => {
    const expected: Record<Who, Record<string, string>> = {
      owner: { finance: "manage", handbook: "manage", "szm-hr": "manage", tools: "manage", video: "manage" },
      hrGroup: { finance: "manage", handbook: "manage", "szm-hr": "manage", tools: "manage", video: "manage" },
      hrSzm: { handbook: "edit", "szm-hr": "manage", tools: "edit", video: "edit" },
      head: { handbook: "view", "szm-hr": "view", tools: "edit", video: "edit" },
      huy: { handbook: "view", "szm-hr": "view", tools: "edit", video: "edit" },
      khoi: { handbook: "view", tools: "edit" },
      ngo: { tools: "view" },
    };
    for (const who of Object.keys(expected) as Who[]) {
      const listed = Object.fromEntries((await listSpaces(viewers[who])).map((space) => [space.key, space.level]));
      expect(listed, who).toEqual(expected[who]);
    }
  });

  it("selects exactly the pages `pageLevel` opens, for every viewer and page", async () => {
    const all = await db().select({ id: schema.kbPage.id }).from(schema.kbPage);
    for (const who of Object.keys(viewers) as Who[]) {
      const viewer = viewers[who];
      const bySql = new Set((await db().select({ id: schema.kbPage.id }).from(schema.kbPage).innerJoin(schema.kbSpace, eq(schema.kbSpace.id, schema.kbPage.spaceId)).where(pageVisibleSql(viewer))).map((row) => row.id));
      for (const { id } of all) {
        const loaded = (await loadPage(id))!;
        expect(bySql.has(id), `${who} → ${loaded.page.title}`).toBe(levelOf(viewer, loaded) !== null);
      }
      const editable = new Set((await db().select({ id: schema.kbSpace.id }).from(schema.kbSpace).where(spaceEditableSql(viewer))).map((row) => row.id));
      for (const spaceId of Object.values(spaces)) expect(editable.has(spaceId), `${who} edits ${spaceId}`).toBe(atLeast(spaceLevel(viewer, (await loadSpace({ id: spaceId }))!.facts), "edit"));
    }
  });

  it("shows a reader the published tree without drafts or closed subtrees; an editor all of it", async () => {
    const handbook = (await loadSpace({ id: spaces.handbook }))!;
    const titles = async (who: Who) => (await listTree(viewers[who], handbook)).map((node) => `${"  ".repeat(node.depth)}${node.title}`);
    expect(await titles("huy")).toEqual(["Quy định nghỉ phép", "  Biểu mẫu nghỉ phép"]);
    expect(await titles("head")).toEqual(["Quy định nghỉ phép", "  Biểu mẫu nghỉ phép", "Dành cho quản lý", "  Khung lương tham chiếu"]);
    expect(await titles("hrSzm")).toEqual(["Quy định nghỉ phép", "  Biểu mẫu nghỉ phép", "Dành cho quản lý", "  Khung lương tham chiếu", "Bản nháp nội quy"]);
    expect(await titles("ngo")).toEqual([]);
  });
});

describe("restricted subtrees", () => {
  it("cover the pages below and follow a move", async () => {
    const rootOf = async (pageId: string) => (await loadPage(pageId))!.page.accessRootId;
    expect(await rootOf(pages.managersChild)).toBe(pages.managers);
    expect(await rootOf(pages.leaveForms)).toBeNull();

    // Into the closed subtree: closed. Out again: open.
    await movePage(pages.leaveForms, { parentId: pages.managersChild, position: null });
    expect(await rootOf(pages.leaveForms)).toBe(pages.managers);
    expect(levelOf(viewers.huy, (await loadPage(pages.leaveForms))!)).toBeNull();
    await movePage(pages.leaveForms, { parentId: pages.leave, position: 0 });
    expect(await rootOf(pages.leaveForms)).toBeNull();
    expect(levelOf(viewers.huy, (await loadPage(pages.leaveForms))!)).toBe("view");

    // A new page inherits its parent's root; clearing the rows opens the subtree.
    const fresh = await createPage({ spaceId: spaces.handbook, parentId: pages.managersChild, title: "Mới" }, { personId: ids.hrGroup });
    expect(fresh.accessRootId).toBe(pages.managers);
    await setPageAccess(pages.managers, []);
    expect(await rootOf(pages.managersChild)).toBeNull();
    expect(await rootOf(fresh.id)).toBeNull();
    await setPageAccess(pages.managers, [{ subjectKey: "role:department_head", level: "view" }]);
    expect(await rootOf(fresh.id)).toBe(pages.managers);
    await deletePage(fresh.id);
  });

  it("refuses a move under itself, into another space, and unknown subjects", async () => {
    expect(await fails(movePage(pages.leave, { parentId: pages.leaveForms, position: null }))).toBe("kb_move_into_itself");
    expect(await fails(movePage(pages.leave, { parentId: pages.videoSop, position: null }))).toBe("kb_parent_not_found");
    expect(await fails(setPageAccess(pages.leave, [{ subjectKey: "entity:00000000-0000-4000-8000-000000000000", level: "view" }]))).toBe("kb_subject_unknown");
    expect(await fails(setSpaceAccess(spaces.tools, [{ subjectKey: "role:wizard", level: "view" }]))).toBe("kb_subject_unknown");
    expect(await fails(deletePage(pages.leave))).toBe("kb_page_has_children");
  });

  it("reorders siblings", async () => {
    await movePage(pages.managers, { parentId: null, position: 0 });
    const handbook = (await loadSpace({ id: spaces.handbook }))!;
    expect((await listTree(viewers.hrGroup, handbook)).filter((node) => node.depth === 0).map((node) => node.title)).toEqual(["Dành cho quản lý", "Quy định nghỉ phép", "Bản nháp nội quy"]);
  });
});

describe("working copy, publishing, versions", () => {
  const actor = () => ({ personId: ids.hrGroup });

  it("keeps readers on the published version while the working copy changes", async () => {
    await saveDraft(pages.leave, { title: "Quy định nghỉ phép 2027", content: doc(heading(1, "Quy định nghỉ phép 2027"), paragraph("Nhân viên được 14 ngày phép năm.")) }, actor());
    const loaded = (await loadPage(pages.leave))!;
    expect(loaded.page.hasUnpublishedChanges).toBe(true);
    const asReader = await getReadingView(loaded, "view", true); // a reader asking for the draft still gets the published page
    expect(asReader).toMatchObject({ showing: "published", title: "Quy định nghỉ phép", version: { versionNo: 1 } });
    expect(await getReadingView(loaded, "edit", true)).toMatchObject({ showing: "draft", title: "Quy định nghỉ phép 2027" });
    expect(await getReadingView(loaded, "edit", false)).toMatchObject({ showing: "published" });
    const handbook = (await loadSpace({ id: spaces.handbook }))!;
    expect((await listTree(viewers.huy, handbook)).map((node) => node.title)).toContain("Quy định nghỉ phép");
    expect((await listTree(viewers.hrSzm, handbook)).map((node) => node.title)).toContain("Quy định nghỉ phép 2027");
  });

  it("publishes version n + 1, fills the accent-free search columns, and finds 'nghi phep'", async () => {
    const { version, page } = await publishPage(pages.leave, actor(), { changeNote: "Tăng lên 14 ngày", isMajor: true });
    expect(version).toMatchObject({ versionNo: 2, isMajor: true, changeNote: "Tăng lên 14 ngày", title: "Quy định nghỉ phép 2027" });
    expect(page).toMatchObject({ status: "published", hasUnpublishedChanges: false, publishedVersionId: version.id, publishedTitle: "Quy định nghỉ phép 2027", searchTitle: "quy dinh nghi phep 2027" });
    expect(page.searchBody).toContain("nhan vien duoc 14 ngay phep nam");
    const found = await db().select({ id: schema.kbPage.id }).from(schema.kbPage).where(sql`${schema.kbPage.searchVector} @@ plainto_tsquery('simple', 'nghi phep')`);
    expect(found.map((row) => row.id)).toContain(pages.leave);
    expect(await fails(publishPage(pages.leave, actor()))).toBe("kb_nothing_to_publish");
  });

  it("lists, compares and restores versions without rewriting history", async () => {
    const loaded = (await loadPage(pages.leave))!;
    expect((await listVersions(loaded.page)).map((row) => [row.versionNo, row.current, row.isMajor])).toEqual([[2, true, true], [1, false, false]]);
    const comparison = (await compareVersions(loaded.page, 1, 2))!;
    expect(comparison.lines.filter((line) => line.type !== "same")).toEqual([
      { type: "removed", text: "Quy định nghỉ phép" },
      { type: "removed", text: "Nội dung liên kết." },
      { type: "added", text: "Quy định nghỉ phép 2027" },
      { type: "added", text: "Nhân viên được 14 ngày phép năm." },
    ]);
    expect(await compareVersions(loaded.page, 1, 9)).toBeNull();

    const { after } = await restoreVersion(pages.leave, 1, actor());
    expect(after).toMatchObject({ title: "Quy định nghỉ phép", hasUnpublishedChanges: true, publishedTitle: "Quy định nghỉ phép 2027" });
    expect((await publishPage(pages.leave, actor())).version.versionNo).toBe(3);
    expect(await fails(restoreVersion(pages.leave, 12, actor()))).toBe("kb_version_not_found");
  });

  it("never lets a published version change or go (database trigger)", async () => {
    await expect(db().update(schema.kbPageVersion).set({ title: "x" }).where(eq(schema.kbPageVersion.pageId, pages.leave))).rejects.toThrow();
    await expect(db().delete(schema.kbPageVersion).where(and(eq(schema.kbPageVersion.pageId, pages.leave), eq(schema.kbPageVersion.versionNo, 1)))).rejects.toThrow();
  });

  it("refuses content the validator refuses, and saving while a review is open", async () => {
    const bad = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    expect(await fails(saveDraft(pages.draft, { title: "x", content: bad }, actor()))).toBe("kb_content_invalid");
    expect(await fails(createPage({ spaceId: spaces.tools, parentId: null, title: "x", content: { type: "doc", content: [{ type: "script" }] } }, actor()))).toBe("kb_content_invalid");
    expect(await fails(saveDraft(pages.draft, { title: "  ", content: doc() }, actor()))).toBe("kb_title_required");
    await db().update(schema.kbPage).set({ status: "in_review" }).where(eq(schema.kbPage.id, pages.draft));
    expect(await fails(saveDraft(pages.draft, { title: "x", content: doc() }, actor()))).toBe("kb_page_in_review");
    await db().update(schema.kbPage).set({ status: "draft" }).where(eq(schema.kbPage.id, pages.draft));
  });

  it("takes an unpublished or archived page away from readers and from search, and brings it back", async () => {
    await unpublishPage(pages.toolsTip);
    let loaded = (await loadPage(pages.toolsTip))!;
    expect(loaded.page).toMatchObject({ status: "draft", publishedVersionId: null, searchTitle: "" });
    expect(levelOf(viewers.ngo, loaded)).toBeNull(); // a reader of the space
    expect(levelOf(viewers.huy, loaded)).toBe("edit"); // an editor still sees the draft
    await publishPage(pages.toolsTip, actor());
    await setPageArchived(pages.toolsTip, true);
    loaded = (await loadPage(pages.toolsTip))!;
    expect(levelOf(viewers.ngo, loaded)).toBeNull();
    await setPageArchived(pages.toolsTip, false);
    expect((await loadPage(pages.toolsTip))!.page.status).toBe("published");
    expect(levelOf(viewers.ngo, (await loadPage(pages.toolsTip))!)).toBe("view");
  });

  it("hides an archived space from everyone but its managers, and counts a reader's view once a day", async () => {
    await setSpaceArchived(spaces.video, true);
    expect((await listSpaces(viewers.huy)).map((space) => space.key)).not.toContain("video");
    expect(levelOf(viewers.huy, (await loadPage(pages.videoSop))!)).toBeNull();
    expect((await listSpaces(viewers.hrGroup)).map((space) => space.key)).toContain("video");
    await setSpaceArchived(spaces.video, false);

    await recordView(pages.leave, ids.huy, "2026-09-20");
    await recordView(pages.leave, ids.huy, "2026-09-20");
    await recordView(pages.leave, ids.huy, "2026-09-21");
    expect(await db().select().from(schema.kbPageView).where(eq(schema.kbPageView.personId, ids.huy))).toHaveLength(2);
  });
});
