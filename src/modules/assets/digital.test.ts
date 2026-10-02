// The digital-asset register against a real Postgres (PGlite): who sees which asset, the life of a
// grant from the request to the day it is taken away, the one-open-grant rule the database itself
// enforces, the password that has to change once somebody who knew it is out, and the tasks an
// offboarding opens.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
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

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import {
  activeAccessPairs,
  cancelReturnTasks,
  decideDigitalAccess,
  type DigitalAssetInput,
  endDigitalAccess,
  findDigitalAsset,
  getDigitalAssetView,
  grantDigitalAccess,
  listDigitalAccessOfPerson,
  listDigitalAssets,
  listDigitalDirectory,
  markCredentialsRotated,
  openReturnTasks,
  requestDigitalAccess,
  saveDigitalAsset,
  summariseDigitalAssets,
} from "./service";

const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

type PersonKey = "keeper" | "khoi" | "huy" | "lan" | "long" | "gone";
const ids = {} as Record<PersonKey | "szm" | "szc" | "client", string>;
let keeper: Principal;
let szcKeeper: Principal;
const as = (key: PersonKey) => principal(ids[key]);
const noticesOf = (key: PersonKey, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  for (const [key, fullName, status] of [
    ["long", "Đặng Hoàng Long", "active"],
    ["keeper", "Người giữ sổ", "active"],
    ["khoi", "Lý Minh Khôi", "active"],
    ["huy", "Hồ Gia Huy", "active"],
    ["lan", "Trần Ngọc Lan", "active"],
    ["gone", "Người đã nghỉ", "offboarded"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, status, managerId: key === "huy" || key === "lan" ? ids.long : null }).returning();
    ids[key] = row.id;
  }
  const [client] = await db().insert(schema.workClient).values({ code: "TLX", name: "Trà Lá Xanh" }).returning();
  ids.client = client.id;
  keeper = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "group" } }]);
  szcKeeper = principal("szc-keeper", [{ role: "asset_admin", scope: { type: "entity", id: szc.id } }]);
});

const input = (over: Partial<DigitalAssetInput> = {}): DigitalAssetInput => ({
  kind: "social_channel",
  platform: "facebook",
  name: "SuZu Media — Fanpage",
  handle: "@suzumedia",
  url: "https://www.facebook.com/suzumedia",
  entityId: ids.szm,
  ownership: "company",
  clientId: null,
  ownerPersonId: ids.khoi,
  visibility: "staff",
  status: "active",
  loginIdentity: "social@suzu.group",
  recoveryContact: "0900 000 000",
  credentialLocation: "1Password › Social",
  notes: null,
  ...over,
});
const register = async (over: Partial<DigitalAssetInput> = {}) => (await saveDigitalAsset(null, input(over), ids.keeper)).after;
const grant = (assetId: string, person: PersonKey, over: Partial<{ level: "admin" | "editor" | "analyst"; method: "own_account" | "shared_login" }> = {}) =>
  grantDigitalAccess({ assetId, personId: ids[person], level: over.level ?? "editor", method: over.method ?? "own_account", expiresOn: null, note: null }, ids.khoi);

describe("registering", () => {
  it("records an asset, tells its owner, and refuses a client's asset without the client, a non-https address, or an owner who has left", async () => {
    const asset = await register({ name: "Kênh TikTok SuZu", platform: "tiktok" });
    expect(asset.ownerPersonId).toBe(ids.khoi);
    expect((await noticesOf("khoi", "approvals.digital_asset_entrusted")).length).toBeGreaterThan(0);

    expect(await fails(saveDigitalAsset(null, input({ ownership: "client", clientId: null }), ids.keeper))).toBe("digital_asset_client_required");
    expect(await fails(saveDigitalAsset(null, input({ url: "http://example.com" }), ids.keeper))).toBe("digital_asset_url_invalid");
    expect(await fails(saveDigitalAsset(null, input({ ownerPersonId: ids.gone }), ids.keeper))).toBe("digital_person_inactive");
    const forClient = await register({ name: "Fanpage Trà Lá Xanh", ownership: "client", clientId: ids.client });
    expect(forClient.clientId).toBe(ids.client);
  });

  it("keeps only `staff` assets in the directory work picks from, and drops retired ones from the picker", async () => {
    const open = await register({ name: "Trong danh bạ" });
    const hidden = await register({ name: "Cổng ngân hàng", kind: "business_account", platform: "other", visibility: "restricted", url: null });
    const names = async (includeRetired = false) => (await listDigitalDirectory({ includeRetired })).map((row) => row.name);
    expect(await names()).toContain("Trong danh bạ");
    expect(await names()).not.toContain("Cổng ngân hàng");
    // Nothing a directory entry carries says where the login is kept.
    expect(Object.keys((await listDigitalDirectory())[0])).not.toContain("credentialLocation");

    await saveDigitalAsset(open.id, input({ name: "Trong danh bạ", status: "retired" }), ids.keeper);
    expect(await names()).not.toContain("Trong danh bạ");
    expect(await names(true)).toContain("Trong danh bạ");
    expect((await findDigitalAsset(hidden.id))?.visibility).toBe("restricted");
  });
});

describe("who sees what", () => {
  it("shows a staff asset to everybody, its login details only to whoever runs it, and how people get in only to them", async () => {
    const asset = await register({ name: "Fanpage để xem" });
    await grant(asset.id, "huy", { method: "shared_login" });

    const plain = (await getDigitalAssetView(as("lan"), asset.id))!;
    expect(plain.asset.name).toBe("Fanpage để xem");
    expect(plain.secrets).toBeNull();
    expect(plain.canRun).toBe(false);
    // Lan sees that Huy is in, and at what level — not that he knows the password.
    expect(plain.access.map((row) => [row.personName, row.level, row.method])).toEqual([["Hồ Gia Huy", "editor", null]]);
    expect(plain.history).toEqual([]);

    for (const runner of [as("khoi"), keeper]) {
      const view = (await getDigitalAssetView(runner, asset.id))!;
      expect(view.canRun).toBe(true);
      expect(view.secrets?.credentialLocation).toBe("1Password › Social");
      expect(view.access[0].method).toBe("shared_login");
    }
    // The keeper of another entity's register is a member of staff like any other here.
    expect((await getDigitalAssetView(szcKeeper, asset.id))?.secrets).toBeNull();
  });

  it("hides a restricted asset from everybody but its keepers, its owner and the people who hold access", async () => {
    const asset = await register({ name: "Tài khoản thuế điện tử", kind: "business_account", platform: "other", visibility: "restricted", url: null, ownerPersonId: ids.long });
    expect(await getDigitalAssetView(as("lan"), asset.id)).toBeNull();
    expect((await listDigitalAssets(as("lan"))).some((row) => row.id === asset.id)).toBe(false);
    // A restricted asset is granted, never asked for: the request answers like an id that is not there.
    expect((await getDigitalAssetView(as("long"), asset.id))?.canRun).toBe(true);
    expect((await listDigitalAssets(keeper)).some((row) => row.id === asset.id)).toBe(true);

    await grantDigitalAccess({ assetId: asset.id, personId: ids.lan, level: "analyst", method: "own_account", expiresOn: null, note: null }, ids.long);
    const view = (await getDigitalAssetView(as("lan"), asset.id))!;
    expect(view.asset.mine).toEqual({ status: "active", level: "analyst" });
    expect(view.secrets).toBeNull();
    expect((await listDigitalAssets(as("lan"))).some((row) => row.id === asset.id)).toBe(true);
    expect((await listDigitalAssets(as("lan"), { mine: true })).map((row) => row.id)).toContain(asset.id);
  });

  it("counts over everything in reach: what is mine, what waits for me, what password I have to change", async () => {
    const asset = await register({ name: "Kênh để đếm", platform: "youtube" });
    await requestDigitalAccess({ assetId: asset.id, level: "editor", note: "Cần đăng video" }, ids.lan);
    const forOwner = await summariseDigitalAssets(as("khoi"));
    expect(forOwner.waiting).toBeGreaterThanOrEqual(1);
    // Somebody who runs nothing is shown no figure that belongs to the people who do.
    const forLan = await summariseDigitalAssets(as("lan"));
    expect(forLan.waiting).toBe(0);
    expect(forLan.rotationDue).toBe(0);
    const row = (await listDigitalAssets(as("lan"))).find((item) => item.id === asset.id)!;
    expect(row.mine).toEqual({ status: "requested", level: "editor" });
    expect(row.waiting).toBe(0);
    expect((await listDigitalAssets(as("khoi"))).find((item) => item.id === asset.id)!.waiting).toBe(1);
  });
});

describe("the life of a grant", () => {
  it("asks, is answered at another level, and tells both sides", async () => {
    const asset = await register({ name: "Fanpage xin quyền" });
    const { access } = await requestDigitalAccess({ assetId: asset.id, level: "admin", note: "Lên lịch bài" }, ids.huy);
    expect(access.status).toBe("requested");
    expect((await noticesOf("khoi", "approvals.digital_access_requested")).some((row) => (row.params as { asset?: string }).asset === "Fanpage xin quyền")).toBe(true);
    // Asking twice is refused, not queued.
    expect(await fails(requestDigitalAccess({ assetId: asset.id, level: "editor", note: null }, ids.huy))).toBe("digital_access_already_open");

    const { after } = await decideDigitalAccess({ accessId: access.id, decision: "approve", level: "editor", method: "own_account", expiresOn: "2026-12-31", note: null }, ids.khoi);
    expect(after).toMatchObject({ status: "active", level: "editor", expiresOn: "2026-12-31", decidedByPersonId: ids.khoi });
    expect((await noticesOf("huy", "approvals.digital_access_decided")).some((row) => (row.params as { outcome?: string }).outcome === "approved")).toBe(true);
    expect(await fails(decideDigitalAccess({ accessId: access.id, decision: "decline", level: null, method: null, expiresOn: null, note: "Trễ" }, ids.khoi))).toBe("digital_access_not_pending");
  });

  it("declines with a reason, and a declined person may ask again", async () => {
    const asset = await register({ name: "Fanpage từ chối" });
    const { access } = await requestDigitalAccess({ assetId: asset.id, level: "editor", note: null }, ids.lan);
    expect(await fails(decideDigitalAccess({ accessId: access.id, decision: "decline", level: null, method: null, expiresOn: null, note: " " }, ids.khoi))).toBe("digital_access_reason_required");
    const { after } = await decideDigitalAccess({ accessId: access.id, decision: "decline", level: null, method: null, expiresOn: null, note: "Không thuộc nhóm Social" }, ids.khoi);
    expect(after).toMatchObject({ status: "declined", endNote: "Không thuộc nhóm Social" });
    expect((await requestDigitalAccess({ assetId: asset.id, level: "analyst", note: null }, ids.lan)).access.status).toBe("requested");
  });

  it("grants straight in, changes a level by granting again, and answers a waiting request by granting", async () => {
    const asset = await register({ name: "Fanpage cấp thẳng" });
    expect((await grant(asset.id, "huy")).outcome).toBe("granted");
    expect((await noticesOf("huy", "approvals.digital_access_granted")).some((row) => (row.params as { asset?: string }).asset === "Fanpage cấp thẳng")).toBe(true);
    const changed = await grant(asset.id, "huy", { level: "admin" });
    expect(changed.outcome).toBe("changed");
    expect(changed.access.level).toBe("admin");
    // Still one row for the pair.
    expect(await db().select().from(schema.digitalAssetAccess).where(and(eq(schema.digitalAssetAccess.digitalAssetId, asset.id), eq(schema.digitalAssetAccess.personId, ids.huy)))).toHaveLength(1);

    await requestDigitalAccess({ assetId: asset.id, level: "analyst", note: null }, ids.lan);
    expect((await grant(asset.id, "lan")).outcome).toBe("approved");
    expect(await fails(grantDigitalAccess({ assetId: asset.id, personId: ids.gone, level: "editor", method: "own_account", expiresOn: null, note: null }, ids.khoi))).toBe("digital_person_inactive");
    expect([...(await activeAccessPairs([asset.id], [ids.huy, ids.lan, ids.long]))].sort()).toEqual([`${asset.id}:${ids.huy}`, `${asset.id}:${ids.lan}`].sort());
  });

  it("lets the database refuse a second open grant for the same person, past the use-case", async () => {
    const asset = await register({ name: "Fanpage một quyền" });
    await grant(asset.id, "huy");
    const second = db().insert(schema.digitalAssetAccess).values({ digitalAssetId: asset.id, personId: ids.huy, level: "admin", status: "active" });
    await expect(second).rejects.toMatchObject({ cause: { constraint: "digital_asset_access_open_key" } });
    // A closed row does not hold the pair: history is unlimited.
    await db().insert(schema.digitalAssetAccess).values({ digitalAssetId: asset.id, personId: ids.huy, level: "admin", status: "revoked" });
  });

  it("takes access away, tells the person, and asks for the password to change when they knew it", async () => {
    const asset = await register({ name: "Kênh dùng chung mật khẩu", platform: "tiktok" });
    const own = (await grant(asset.id, "lan")).access;
    const shared = (await grant(asset.id, "huy", { method: "shared_login" })).access;

    // Somebody whose own account was given a role: taking the role away ends it.
    await endDigitalAccess(own.id, "Chuyển nhóm", ids.khoi);
    expect((await findDigitalAsset(asset.id))?.rotationDueSince).toBeNull();
    expect((await noticesOf("lan", "approvals.digital_access_revoked")).some((row) => (row.params as { asset?: string }).asset === "Kênh dùng chung mật khẩu")).toBe(true);

    const { after } = await endDigitalAccess(shared.id, null, ids.khoi);
    expect(after.status).toBe("revoked");
    expect((await findDigitalAsset(asset.id))?.rotationDueSince).toBeInstanceOf(Date);
    expect((await listDigitalAssets(as("khoi"))).find((row) => row.id === asset.id)?.rotationDue).toBe(true);
    // The flag is the owner's to see, nobody else's.
    expect((await listDigitalAssets(as("lan"))).find((row) => row.id === asset.id)?.rotationDue).toBe(false);
    expect(await fails(endDigitalAccess(shared.id, null, ids.khoi))).toBe("digital_access_closed");

    const rotated = await markCredentialsRotated(asset.id);
    expect(rotated.after.rotationDueSince).toBeNull();
    expect(rotated.after.credentialsRotatedAt).toBeInstanceOf(Date);
    // What ended is the history, for whoever runs the asset.
    expect((await getDigitalAssetView(as("khoi"), asset.id))!.history.map((row) => row.status)).toEqual(["revoked", "revoked"]);
  });

  it("ends every open grant and request when the asset is retired", async () => {
    const asset = await register({ name: "Kênh sắp đóng", platform: "youtube" });
    await grant(asset.id, "huy");
    await requestDigitalAccess({ assetId: asset.id, level: "editor", note: null }, ids.lan);
    await saveDigitalAsset(asset.id, input({ name: "Kênh sắp đóng", platform: "youtube", status: "retired" }), ids.keeper);
    const rows = await db().select().from(schema.digitalAssetAccess).where(eq(schema.digitalAssetAccess.digitalAssetId, asset.id));
    expect(rows.map((row) => row.status).sort()).toEqual(["declined", "revoked"]);
    expect(await fails(grant(asset.id, "huy"))).toBe("digital_asset_retired");
  });
});

describe("what a leaver gives back", () => {
  it("opens a task per grant for the asset's owner and one per asset they answer for, once, and settles them as each is done", async () => {
    const theirs = await register({ name: "Fanpage người nghỉ phụ trách", ownerPersonId: ids.huy });
    const others = await register({ name: "Fanpage người nghỉ có quyền" });
    const access = (await grant(others.id, "huy")).access;
    // A request never answered is not something to take away.
    const pending = await register({ name: "Fanpage người nghỉ đang xin" });
    await requestDigitalAccess({ assetId: pending.id, level: "editor", note: null }, ids.huy);

    const opened = await db().transaction((tx) => openReturnTasks(tx, ids.huy, "2026-10-31", ids.keeper));
    const tasks = await db().select().from(schema.task).where(and(eq(schema.task.subjectPersonId, ids.huy), inArray(schema.task.kind, ["digital_access_revoke", "digital_asset_handover"])));
    const open = () => tasks.filter((task) => task.status === "todo");
    expect(opened).toBeGreaterThanOrEqual(2);
    const revoke = open().find((task) => task.contextId === access.id)!;
    // The asset's owner takes the access away; the leaver's manager finds a new owner.
    expect(revoke).toMatchObject({ kind: "digital_access_revoke", assigneePersonId: ids.khoi, dueDate: "2026-10-31", title: "Thu hồi quyền truy cập: Fanpage người nghỉ có quyền" });
    expect(open().find((task) => task.contextId === theirs.id)).toMatchObject({ kind: "digital_asset_handover", assigneePersonId: ids.long });
    expect(open().some((task) => task.linkUrl === `/assets/digital/${pending.id}`)).toBe(false);

    // Called again it opens nothing new.
    const before = (await db().select().from(schema.task).where(eq(schema.task.subjectPersonId, ids.huy))).length;
    await db().transaction((tx) => openReturnTasks(tx, ids.huy, "2026-10-31", ids.keeper));
    expect((await db().select().from(schema.task).where(eq(schema.task.subjectPersonId, ids.huy))).length).toBe(before);

    // Doing the thing settles its task: the access is taken away, a new owner is named.
    await endDigitalAccess(access.id, "Nghỉ việc", ids.khoi);
    await saveDigitalAsset(theirs.id, input({ name: "Fanpage người nghỉ phụ trách", ownerPersonId: ids.lan }), ids.keeper);
    const after = await db().select().from(schema.task).where(inArray(schema.task.contextId, [access.id, theirs.id]));
    expect(after.every((task) => task.status === "cancelled")).toBe(true);
    expect((await listDigitalAccessOfPerson(ids.huy)).some((row) => row.assetId === others.id)).toBe(false);
  });

  it("calls the tasks off with the termination", async () => {
    const asset = await register({ name: "Fanpage hủy nghỉ việc" });
    await grant(asset.id, "lan");
    await db().transaction((tx) => openReturnTasks(tx, ids.lan, "2026-11-30", ids.keeper));
    const cancelled = await db().transaction((tx) => cancelReturnTasks(tx, ids.lan));
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const tasks = await db().select().from(schema.task).where(and(eq(schema.task.subjectPersonId, ids.lan), eq(schema.task.kind, "digital_access_revoke")));
    expect(tasks.every((task) => task.status === "cancelled")).toBe(true);
    // The access itself is untouched: the person is staying.
    expect((await listDigitalAccessOfPerson(ids.lan)).some((row) => row.assetId === asset.id && row.status === "active")).toBe(true);
  });
});
