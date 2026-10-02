// Where a piece of work goes (FR-AST-09), against a real Postgres (PGlite): a task and a project
// name registered pages and channels, only the ones everybody may name; a post is planned on one;
// and the asset's page reads back the work aimed at it — never more than its reader may open.
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { type DigitalAssetInput, saveDigitalAsset } from "@/modules/assets/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { workflow } from "../../../tests/helpers/workflows";
import { digitalAssetsByProject, digitalAssetsByTask, listLinkableDigitalAssets, setProjectDigitalAssets } from "./digital-links";
import { listWorkOfDigitalAsset } from "./digital-work";
import { createProject } from "./projects";
import { listPublishesByTask, markPublished, planPublish, updatePublishPlan } from "./publish";
import { createWorkTask, getTaskDetail, listActivity, updateWorkTask } from "./tasks";
import { createTeam, setTeamMember } from "./teams";
import { viewerOfPerson } from "./viewer";

type Key = "khoi" | "huy" | "lan" | "long";
const ids = {} as Record<Key | "szm" | "social" | "hr" | "project" | "secret" | "fanpage" | "tiktok" | "x" | "bank", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const eqId = (taskId: string) => eq(schema.task.id, taskId);
const viewerOf = async (key: Key) => (await viewerOfPerson(db(), ids[key]))!;

const asset = (over: Partial<DigitalAssetInput>): DigitalAssetInput => ({ kind: "social_channel", platform: "facebook", name: "Fanpage", handle: null, url: null, entityId: ids.szm, ownership: "company", clientId: null, ownerPersonId: ids.khoi, visibility: "staff", status: "active", loginIdentity: null, recoveryContact: null, credentialLocation: null, notes: null, ...over });
const register = async (over: Partial<DigitalAssetInput>) => (await saveDigitalAsset(null, asset(over), ids.khoi)).after.id;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["khoi", "huy", "lan", "long"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Social: led by Khôi, Huy a member. HR: a private team of Long's — Lan and Huy are outside it.
  const social = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("content", { published: "Đã đăng" }), ids.khoi);
  const hr = await createTeam({ key: "HR", name: "Nhân sự", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "private", isActive: true }, workflow("simple"), ids.long);
  await setTeamMember(social.id, ids.huy, "member");
  Object.assign(ids, { social: social.id, hr: hr.id });
  ids.project = (await createProject({ teamId: social.id, name: "Tết 2027", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.khoi, startDate: null, dueDate: null }, ids.khoi)).id;
  ids.secret = (await createProject({ teamId: hr.id, name: "Tuyển dụng kín", description: null, clientId: null, status: "active", visibility: "private", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;

  ids.fanpage = await register({ name: "SuZu Fanpage", platform: "facebook" });
  ids.tiktok = await register({ name: "SuZu TikTok", platform: "tiktok" });
  ids.x = await register({ name: "SuZu trên X", platform: "x" });
  ids.bank = await register({ name: "Cổng ngân hàng", platform: "other", kind: "business_account", visibility: "restricted" });
});

describe("a task names the pages and channels it is for", () => {
  it("is created with them, changes them with every change in its activity, and lists them in the register's order", async () => {
    const { task } = await createWorkTask({ teamId: ids.social, projectId: ids.project, title: "Bài chúc Tết", digitalAssetIds: [ids.tiktok, ids.fanpage] }, ids.khoi);
    const names = async () => (await digitalAssetsByTask([task.id])).get(task.id)?.map((row) => row.name) ?? [];
    // Platform, then name: Facebook before TikTok, whatever order they were chosen in.
    expect(await names()).toEqual(["SuZu Fanpage", "SuZu TikTok"]);

    const { changes } = await updateWorkTask(task.id, { digitalAssetIds: [ids.fanpage, ids.x] }, ids.huy);
    expect(changes.map((change) => [change.type, ((change.to ?? change.from) as { name: string }).name]).sort()).toEqual([
      ["digital_asset_added", "SuZu trên X"],
      ["digital_asset_removed", "SuZu TikTok"],
    ]);
    expect((await listActivity(task.id)).filter((entry) => entry.type.startsWith("digital_asset_")).length).toBe(2);
    expect(await names()).toEqual(["SuZu Fanpage", "SuZu trên X"]);

    // A patch that does not name the field leaves the list alone; an empty list clears it.
    await updateWorkTask(task.id, { title: "Bài chúc Tết (bản 2)" }, ids.huy);
    expect(await names()).toHaveLength(2);
    await updateWorkTask(task.id, { digitalAssetIds: [] }, ids.huy);
    expect(await names()).toEqual([]);

    const detail = await getTaskDetail(task.id, await viewerOf("huy"));
    expect(detail?.digitalAssets).toEqual([]);
  });

  it("refuses an asset that is restricted, retired or not there — and keeps one that was retired after it was linked", async () => {
    const { task } = await createWorkTask({ teamId: ids.social, title: "Bài thử" }, ids.khoi);
    // Naming a restricted asset would show it to everybody who can read the task.
    expect(await fails(updateWorkTask(task.id, { digitalAssetIds: [ids.bank] }, ids.khoi))).toBe("digital_asset_not_linkable");
    expect(await fails(updateWorkTask(task.id, { digitalAssetIds: ["00000000-0000-4000-8000-000000000000"] }, ids.khoi))).toBe("digital_asset_not_linkable");
    expect((await listLinkableDigitalAssets()).map((row) => row.name)).not.toContain("Cổng ngân hàng");

    const closing = await register({ name: "Kênh sắp đóng", platform: "youtube" });
    await updateWorkTask(task.id, { digitalAssetIds: [closing, ids.fanpage] }, ids.khoi);
    await saveDigitalAsset(closing, asset({ name: "Kênh sắp đóng", platform: "youtube", status: "retired" }), ids.khoi);
    // Saved again with the same list: the retired one stays on the work that was done for it…
    await updateWorkTask(task.id, { digitalAssetIds: [closing, ids.fanpage] }, ids.khoi);
    expect((await digitalAssetsByTask([task.id])).get(task.id)?.map((row) => [row.name, row.status])).toEqual([
      ["SuZu Fanpage", "active"],
      ["Kênh sắp đóng", "retired"],
    ]);
    // …but nothing new can be aimed at it, and the picker no longer offers it.
    const other = (await createWorkTask({ teamId: ids.social, title: "Bài khác" }, ids.khoi)).task;
    expect(await fails(updateWorkTask(other.id, { digitalAssetIds: [closing] }, ids.khoi))).toBe("digital_asset_not_linkable");
    expect((await listLinkableDigitalAssets()).map((row) => row.name)).not.toContain("Kênh sắp đóng");
  });
});

describe("a project names the channels it produces for", () => {
  it("sets the list, and reads it back for several projects at once", async () => {
    const { after } = await setProjectDigitalAssets(ids.project, [ids.fanpage, ids.tiktok]);
    expect(after.sort()).toEqual(["SuZu Fanpage", "SuZu TikTok"]);
    const second = await setProjectDigitalAssets(ids.project, [ids.tiktok]);
    expect(second).toEqual({ before: expect.arrayContaining(["SuZu Fanpage", "SuZu TikTok"]), after: ["SuZu TikTok"] });
    expect(await fails(setProjectDigitalAssets(ids.project, [ids.bank]))).toBe("digital_asset_not_linkable");
    const byProject = await digitalAssetsByProject([ids.project, ids.secret]);
    expect(byProject.get(ids.project)?.map((row) => row.name)).toEqual(["SuZu TikTok"]);
    expect(byProject.get(ids.secret)).toBeUndefined();
  });
});

describe("a post goes out on a registered channel", () => {
  it("takes the platform and the page from the register, and still takes a page typed by hand", async () => {
    const { task } = await createWorkTask({ teamId: ids.social, title: "Video hậu trường", digitalAssetIds: [ids.tiktok] }, ids.khoi);
    const onChannel = await planPublish(task.id, { platform: null, page: null, plannedAt: new Date("2026-10-20T12:00:00Z"), digitalAssetId: ids.tiktok }, actor("huy"));
    expect(onChannel).toMatchObject({ platform: "tiktok", page: "SuZu TikTok", digitalAssetId: ids.tiktok });
    // A platform work has no channel for is filed under "other"; the asset still says which.
    expect(await planPublish(task.id, { platform: null, page: null, plannedAt: null, digitalAssetId: ids.x }, actor("huy"))).toMatchObject({ platform: "other", page: "SuZu trên X" });
    const byHand = await planPublish(task.id, { platform: "facebook", page: "Fanpage khách", plannedAt: null }, actor("huy"));
    expect(byHand).toMatchObject({ platform: "facebook", page: "Fanpage khách", digitalAssetId: null });

    expect(await fails(planPublish(task.id, { platform: null, page: null, plannedAt: null, digitalAssetId: ids.bank }, actor("huy")))).toBe("digital_asset_not_linkable");
    expect(await fails(planPublish(task.id, { platform: null, page: null, plannedAt: null }, actor("huy")))).toBe("publish_platform_invalid");

    // Moving a typed page onto the registered one, and back.
    const moved = await updatePublishPlan(byHand.id, { platform: null, page: null, plannedAt: null, digitalAssetId: ids.fanpage }, actor("huy"));
    expect(moved.after).toMatchObject({ platform: "facebook", page: "SuZu Fanpage", digitalAssetId: ids.fanpage });
    expect((await listPublishesByTask([task.id])).map((row) => row.digitalAssetId).filter(Boolean)).toHaveLength(3);
  });
});

describe("the work aimed at an asset", () => {
  it("lists its open tasks, its posts and its projects — never more than the reader may open", async () => {
    const page = await register({ name: "Fanpage để đọc việc" });
    await setProjectDigitalAssets(ids.project, [page]);
    const open = (await createWorkTask({ teamId: ids.social, projectId: ids.project, title: "Bài tuần này", assigneePersonId: ids.huy, dueDate: "2026-10-25", digitalAssetIds: [page] }, ids.khoi)).task;
    const done = (await createWorkTask({ teamId: ids.social, projectId: ids.project, title: "Bài tuần trước", digitalAssetIds: [page] }, ids.khoi)).task;
    await db().update(schema.task).set({ status: "done" }).where(eqId(done.id));
    // A private project of another team aims at the same page.
    const hidden = (await createWorkTask({ teamId: ids.hr, projectId: ids.secret, title: "Tin tuyển dụng kín", digitalAssetIds: [page] }, ids.long)).task;
    await setProjectDigitalAssets(ids.secret, [page]);

    const planned = await planPublish(open.id, { platform: null, page: null, plannedAt: new Date(Date.now() + 86_400_000), digitalAssetId: page }, actor("huy"));
    const out = await planPublish(done.id, { platform: null, page: null, plannedAt: null, digitalAssetId: page }, actor("huy"));
    await markPublished(out.id, { url: "https://www.facebook.com/suzu/posts/1", publishedAt: new Date(), boosted: false, adAccount: null }, actor("huy"));
    await planPublish(hidden.id, { platform: null, page: null, plannedAt: new Date(Date.now() + 86_400_000), digitalAssetId: page }, actor("long"));

    const forMember = await listWorkOfDigitalAsset(await viewerOf("huy"), page);
    // Open work only; what is done shows through its post.
    expect(forMember.tasks.map((task) => task.title)).toEqual(["Bài tuần này"]);
    expect(forMember.tasks[0]).toMatchObject({ assigneePersonId: ids.huy, dueDate: "2026-10-25", projectName: "Tết 2027" });
    expect(forMember.posts.map((post) => post.id).sort()).toEqual([planned.id, out.id].sort());
    expect(forMember.projects.map((project) => project.name)).toEqual(["Tết 2027"]);

    // The private project's lead sees their own work on the page, and not the other team's.
    const forLong = await listWorkOfDigitalAsset(await viewerOf("long"), page);
    expect(forLong.tasks.map((task) => task.title)).toEqual(["Tin tuyển dụng kín"]);
    expect(forLong.projects.map((project) => project.name)).toEqual(["Tuyển dụng kín"]);
    // Somebody in neither team sees the page's work only as far as the Social team's visibility lets them.
    const forLan = await listWorkOfDigitalAsset(await viewerOf("lan"), page);
    expect(forLan.tasks.map((task) => task.title)).not.toContain("Tin tuyển dụng kín");
    expect(forLan.projects.map((project) => project.name)).not.toContain("Tuyển dụng kín");
  });
});
