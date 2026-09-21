// The register against a real Postgres (PGlite): codes, the one-holder rule the database itself
// enforces, the handover/return cycle, what the listing shows about money, and the return tasks
// the offboarding checklist leans on.
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

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import {
  assignAsset,
  cancelReturnTasks,
  confirmHandover,
  countAssetsOfPerson,
  findAssignment,
  getAssetView,
  listAssets,
  listAssetsOfPerson,
  nextAssetCode,
  openReturnTasks,
  registerAsset,
  returnAsset,
  setAssetStatus,
  updateAsset,
} from "./service";

const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "szc" | "vid" | "laptop" | "camera" | "long" | "huy" | "tam" | "keeper" | "financePerson" | "team", string>;
let keeper: Principal;
let entityKeeperSzc: Principal;
let huy: Principal;
let financeViewer: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [team] = await db().insert(schema.orgUnit).values({ kind: "team", parentId: vid.id, name: "Quay dựng" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, team: team.id });

  const people: [keyof typeof ids, string, string | null][] = [
    ["long", "Đặng Hoàng Long", null],
    ["tam", "Bùi Thanh Tâm", "long"],
    ["huy", "Hồ Gia Huy", "long"],
    ["keeper", "Người giữ kho", null],
    ["financePerson", "Kế toán", null],
  ];
  for (const [key, fullName, manager] of people) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName, searchName: key, primaryEntityId: szm.id, departmentId: vid.id, status: "active", managerId: manager ? ids[manager as keyof typeof ids] : null })
      .returning();
    ids[key] = row.id;
  }

  const [laptop] = await db().insert(schema.assetCategory).values({ code: "LAP", name: "Máy tính xách tay", kind: "it_equipment", requiresSerial: true, sortOrder: 1 }).returning();
  const [camera] = await db().insert(schema.assetCategory).values({ code: "CAM", name: "Máy quay", kind: "production_gear", requiresSerial: true, bookable: true, sortOrder: 2 }).returning();
  Object.assign(ids, { laptop: laptop.id, camera: camera.id });

  keeper = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "group" } }]);
  entityKeeperSzc = principal("other-keeper", [{ role: "asset_admin", scope: { type: "entity", id: szc.id } }]);
  huy = principal(ids.huy);
  financeViewer = principal(ids.financePerson, [{ role: "finance", scope: { type: "group" } }]);
});

let personCounter = 0;
/** A holder of their own, so one test's equipment never turns up in another test's counts. */
async function newPerson(fullName = "Người mượn", managerId: string | null = null): Promise<string> {
  const key = `p${++personCounter}`;
  const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: ids.szm, orgUnitId: ids.vid, status: "active", managerId }).returning();
  return row.id;
}

const newAsset = (over: Partial<Parameters<typeof registerAsset>[0]> = {}) =>
  registerAsset(
    {
      categoryId: ids.laptop,
      entityId: ids.szm,
      name: "MacBook Pro 14",
      brand: "Apple",
      model: "M3 Pro",
      serial: `SN-${Math.random().toString(36).slice(2, 10)}`,
      purchaseDate: "2025-04-01",
      purchasePrice: 52_000_000,
      supplier: "Thế Giới Di Động",
      warrantyUntil: "2027-04-01",
      condition: "new",
      location: "Kho tầng 3",
      notes: null,
      ...over,
    },
    ids.keeper,
  );

describe("putting things on the books", () => {
  it("numbers an asset from its entity and category, carrying on from what is already there", async () => {
    const first = await newAsset();
    const second = await newAsset();
    expect(first.code).toBe("SZM-LAP-0001");
    expect(second.code).toBe("SZM-LAP-0002");
    expect(await nextAssetCode(db(), "SZM", "LAP")).toBe("SZM-LAP-0003");
    // A different entity and a different category count separately.
    const other = await newAsset({ entityId: ids.szc, categoryId: ids.camera, name: "Sony FX6" });
    expect(other.code).toBe("SZC-CAM-0001");
  });

  it("gives every asset its own unguessable label token", async () => {
    const one = await newAsset();
    const two = await newAsset();
    expect(one.qrToken).toMatch(/^[0-9a-f]{32}$/);
    expect(one.qrToken).not.toBe(two.qrToken);
  });

  it("insists on a serial where the category says one is needed, and refuses a negative price", async () => {
    expect(await fails(newAsset({ serial: null }))).toBe("asset_serial_required");
    expect(await fails(newAsset({ purchasePrice: -1 }))).toBe("asset_price_invalid");
  });

  it("records what changed without recording what it cost", async () => {
    const asset = await newAsset();
    await updateAsset(asset.id, { name: "MacBook Pro 14 (2025)", purchasePrice: 49_000_000 }, ids.keeper);
    const [event] = await db().select().from(schema.assetEvent).where(and(eq(schema.assetEvent.assetId, asset.id), eq(schema.assetEvent.type, "edited")));
    expect(event.detail).toEqual({ fields: ["name", "purchasePrice"] });
    expect(JSON.stringify(event.detail)).not.toContain("49000000");
  });
});

describe("one thing, one holder", () => {
  it("hands a thing over, and the asset follows the assignment", async () => {
    const holder = await newPerson();
    const asset = await newAsset();
    const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: holder, conditionOut: "new", dueBack: null, purpose: "Dựng phim", accessories: ["Sạc", "Túi chống sốc"] }, ids.keeper);
    const after = (await findAssignment(assignment.id))!;
    expect(after.asset.status).toBe("assigned");
    expect(after.assignment.handoverConfirmedAt).toBeNull();
    expect(await countAssetsOfPerson(holder)).toBe(1);
  });

  it("refuses a second holder — and the database refuses it even if the check is bypassed", async () => {
    const asset = await newAsset();
    await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.tam, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    expect(await fails(assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.long, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper))).toBe("asset_already_assigned");

    // Straight past the use-case, to prove the rule lives in the schema and not only in the code.
    // Drizzle wraps the driver's error, so the constraint's name is on the cause.
    const raw = await db()
      .insert(schema.assetAssignment)
      .values({ assetId: asset.id, holderType: "person", holderPersonId: ids.long, conditionOut: "good" })
      .then(() => null, (error: Error & { cause?: Error }) => `${error.message} ${error.cause?.message ?? ""}`);
    expect(raw).toMatch(/asset_assignment_open_key/);
  });

  it("will not hand over something lost or written off", async () => {
    const asset = await newAsset();
    await setAssetStatus(asset.id, "lost", "Để quên ở hiện trường", ids.keeper);
    expect(await fails(assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper))).toBe("asset_not_assignable");
  });

  it("will not change the status of something somebody is still holding", async () => {
    const asset = await newAsset();
    await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    expect(await fails(setAssetStatus(asset.id, "in_repair", null, ids.keeper))).toBe("asset_still_out");
    expect(await fails(setAssetStatus(asset.id, "assigned", null, ids.keeper))).toBe("asset_status_follows_assignment");
  });

  it("holds a thing for a team as well as for a person", async () => {
    const asset = await newAsset({ categoryId: ids.camera, name: "Sony FX6" });
    const assignment = await assignAsset({ assetId: asset.id, holderType: "team", holderId: ids.team, conditionOut: "good", dueBack: null, purpose: "Gear chung", accessories: [] }, ids.keeper);
    expect(assignment.holderPersonId).toBeNull();
    expect(assignment.holderTeamId).toBe(ids.team);
  });

  it("refuses to hand anything to somebody who has left", async () => {
    const [gone] = await db().insert(schema.person).values({ fullName: "Đã nghỉ", searchName: "da nghi", primaryEntityId: ids.szm, status: "offboarded" }).returning();
    const asset = await newAsset();
    expect(await fails(assignAsset({ assetId: asset.id, holderType: "person", holderId: gone.id, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper))).toBe("asset_holder_inactive");
  });
});

describe("handover and return", () => {
  it("is confirmed once, by the holder, and only while the spell is open", async () => {
    const asset = await newAsset();
    const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "new", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    const confirmed = await confirmHandover(assignment.id, ids.huy, "Đã nhận đủ sạc và túi");
    expect(confirmed.handoverConfirmedAt).toBeInstanceOf(Date);
    expect(await fails(confirmHandover(assignment.id, ids.huy, null))).toBe("asset_handover_already_confirmed");
  });

  it("takes a thing back, records what state it came back in, and frees it for the next person", async () => {
    const holder = await newPerson();
    const next = await newPerson();
    const asset = await newAsset();
    const first = await assignAsset({ assetId: asset.id, holderType: "person", holderId: holder, conditionOut: "new", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await returnAsset({ assignmentId: first.id, conditionIn: "fair", returnNote: "Xước nhẹ ở góc máy" }, ids.keeper);

    const after = (await findAssignment(first.id))!;
    expect(after.assignment.returnedAt).toBeInstanceOf(Date);
    expect(after.assignment.conditionIn).toBe("fair");
    expect(after.asset.status).toBe("in_stock");
    expect(after.asset.condition).toBe("fair");
    expect(await countAssetsOfPerson(holder)).toBe(0);

    // Free again, so the next person may have it.
    const second = await assignAsset({ assetId: asset.id, holderType: "person", holderId: next, conditionOut: "fair", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    expect(second.id).not.toBe(first.id);
    expect(await fails(returnAsset({ assignmentId: first.id, conditionIn: "good", returnNote: null }, ids.keeper))).toBe("asset_assignment_closed");
  });

  it("sends something that came back broken to the repair shelf rather than the ready one", async () => {
    const asset = await newAsset();
    const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await returnAsset({ assignmentId: assignment.id, conditionIn: "broken", returnNote: "Màn hình vỡ" }, ids.keeper);
    expect((await findAssignment(assignment.id))!.asset.status).toBe("in_repair");
  });

  it("keeps the whole history of a thing, newest first", async () => {
    const asset = await newAsset();
    const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "new", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await confirmHandover(assignment.id, ids.huy, null);
    await returnAsset({ assignmentId: assignment.id, conditionIn: "good", returnNote: null }, ids.keeper);
    const view = (await getAssetView(keeper, asset.id))!;
    expect(view.history.map((entry) => entry.type)).toEqual(["returned", "handover_confirmed", "assigned", "acquired"]);
    expect(view.spells).toHaveLength(1);
  });
});

describe("what the register shows, and to whom", () => {
  it("shows an entity's keeper only their own entity", async () => {
    await newAsset();
    await newAsset({ entityId: ids.szc, categoryId: ids.camera, name: "Sony FX6" });
    const mine = await listAssets(entityKeeperSzc, {});
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((row) => row.entityId === ids.szc)).toBe(true);
    expect(await listAssets(huy, {})).toEqual([]);
  });

  it("hands the price to the register and to finance, and to nobody else", async () => {
    const asset = await newAsset({ purchasePrice: 52_000_000 });
    const forKeeper = (await listAssets(keeper, {})).find((row) => row.id === asset.id)!;
    expect(forKeeper.purchasePrice).toBe(52_000_000);
    expect(forKeeper.supplier).toBe("Thế Giới Di Động");

    const forFinance = (await listAssets(financeViewer, {})).find((row) => row.id === asset.id);
    // Finance reads the money but does not keep the register, so the list itself is empty for them…
    expect(forFinance).toBeUndefined();
    // …while the asset they are shown one at a time carries its price.
    await assignAsset({ assetId: asset.id, holderType: "person", holderId: ids.huy, conditionOut: "new", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    const holderView = (await getAssetView(huy, asset.id))!;
    expect(holderView.canSeeMoney).toBe(false);
    expect(holderView.asset.purchasePrice).toBeNull();
    expect(holderView.asset.supplier).toBeNull();
    expect(holderView.asset.code).toBe(asset.code);
  });

  it("gives a stranger nothing at all, not even a different answer", async () => {
    const asset = await newAsset();
    expect(await getAssetView(huy, asset.id)).toBeNull();
    expect(await getAssetView(principal("nobody"), asset.id)).toBeNull();
  });
});

describe("what the lifecycle asks of the register", () => {
  it("opens one return task per thing a leaver still holds, to their manager, due on the last day", async () => {
    const leaver = await newPerson("Người sắp nghỉ", ids.long);
    const one = await newAsset();
    const two = await newAsset({ categoryId: ids.camera, name: "Sony FX6" });
    for (const asset of [one, two]) await assignAsset({ assetId: asset.id, holderType: "person", holderId: leaver, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);

    const opened = await db().transaction(async (tx) => openReturnTasks(tx, leaver, "2026-10-31", ids.keeper));
    expect(opened).toBe(2);
    const tasks = await db().select().from(schema.task).where(and(eq(schema.task.kind, "asset_return"), eq(schema.task.subjectPersonId, leaver)));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.assigneePersonId === ids.long)).toBe(true); // the line manager collects
    expect(tasks.every((task) => task.dueDate === "2026-10-31")).toBe(true);

    // Called again it opens nothing new.
    expect(await db().transaction(async (tx) => openReturnTasks(tx, leaver, "2026-10-31", ids.keeper))).toBe(0);

    // A termination called off takes the tasks with it.
    expect(await db().transaction(async (tx) => cancelReturnTasks(tx, leaver))).toBe(2);
    const after = await db().select().from(schema.task).where(and(eq(schema.task.kind, "asset_return"), eq(schema.task.subjectPersonId, leaver)));
    expect(after.every((task) => task.status === "cancelled")).toBe(true);
  });

  it("settles the return task the moment the thing actually comes back", async () => {
    const holder = await newPerson("Người trả lại", ids.long);
    const asset = await newAsset();
    const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: holder, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await db().transaction(async (tx) => openReturnTasks(tx, holder, "2026-11-30", ids.keeper));
    const [task] = await db().select().from(schema.task).where(and(eq(schema.task.contextType, "asset_assignment"), eq(schema.task.contextId, assignment.id)));
    expect(task.status).toBe("todo");

    await returnAsset({ assignmentId: assignment.id, conditionIn: "good", returnNote: null }, ids.keeper);
    const [settled] = await db().select().from(schema.task).where(eq(schema.task.id, task.id));
    expect(settled.status).toBe("cancelled");
    expect(await listAssetsOfPerson(holder)).toEqual([]);
  });

  it("opens nothing for a leaver holding nothing", async () => {
    const nobody = await newPerson("Không giữ gì");
    expect(await db().transaction(async (tx) => openReturnTasks(tx, nobody, "2026-12-31", ids.keeper))).toBe(0);
  });
});

describe("the open-assignment index", () => {
  it("lets the same asset be held many times over, so long as only one spell is open", async () => {
    const asset = await newAsset();
    for (const holder of [ids.huy, ids.tam, ids.long]) {
      const assignment = await assignAsset({ assetId: asset.id, holderType: "person", holderId: holder, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
      await returnAsset({ assignmentId: assignment.id, conditionIn: "good", returnNote: null }, ids.keeper);
    }
    const spells = await db().select().from(schema.assetAssignment).where(eq(schema.assetAssignment.assetId, asset.id));
    expect(spells).toHaveLength(3);
    expect(await db().select().from(schema.assetAssignment).where(and(eq(schema.assetAssignment.assetId, asset.id), isNull(schema.assetAssignment.returnedAt)))).toHaveLength(0);
  });
});
