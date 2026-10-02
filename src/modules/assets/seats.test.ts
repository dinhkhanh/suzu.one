// The seats of a licence against a real Postgres (PGlite): a seat goes to a person or to a device,
// never past what is paid for, never twice to the same holder — the last two said by the database
// as well as the code — and comes back when the device is written off, the subscription ends, or
// the person leaves.
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { assignAsset, assignSeat, cancelReturnTasks, licenceTotals, type LicenceInput, listLicences, listSeatsOfAsset, listSeatsOfLicence, listSeatsOfPerson, openReturnTasks, registerAsset, releaseSeat, saveLicence, setAssetStatus } from "./service";

const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

type PersonKey = "keeper" | "chi" | "huy" | "tam" | "long" | "gone";
const ids = {} as Record<PersonKey | "szm" | "laptop", string>;
let keeper: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, fullName, status] of [
    ["long", "Đặng Hoàng Long", "active"],
    ["keeper", "Người giữ sổ", "active"],
    ["chi", "Dương Thùy Chi", "active"],
    ["huy", "Hồ Gia Huy", "active"],
    ["tam", "Bùi Thanh Tâm", "active"],
    ["gone", "Người đã nghỉ", "offboarded"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, status, managerId: key === "huy" || key === "tam" ? ids.long : null }).returning();
    ids[key] = row.id;
  }
  const [laptop] = await db().insert(schema.assetCategory).values({ code: "LAP", name: "Máy tính xách tay", kind: "it_equipment", sortOrder: 1 }).returning();
  ids.laptop = laptop.id;
  keeper = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "group" } }]);
});

const licenceInput = (over: Partial<LicenceInput> = {}): LicenceInput => ({ name: "Adobe Creative Cloud", vendor: "Adobe", entityId: ids.szm, seats: 3, costPerCycle: 36_000_000, billingCycle: "annual", renewalDate: "2027-03-14", autoRenews: true, ownerPersonId: ids.chi, accountRef: null, notes: null, status: "active", ...over });
const newLicence = async (over: Partial<LicenceInput> = {}) => (await saveLicence(null, licenceInput(over), ids.keeper)).after;
let serial = 0;
const newDevice = () => registerAsset({ categoryId: ids.laptop, entityId: ids.szm, name: "MacBook Pro 14", brand: "Apple", model: null, serial: `SN-${++serial}`, purchaseDate: null, purchasePrice: null, supplier: null, warrantyUntil: null, condition: "good", location: null, notes: null }, ids.keeper);
const toPerson = (licenceId: string, person: PersonKey) => assignSeat({ licenceId, personId: ids[person], assetId: null, note: null }, ids.keeper);
const toDevice = (licenceId: string, assetId: string) => assignSeat({ licenceId, personId: null, assetId, note: null }, ids.keeper);

describe("giving out seats", () => {
  it("gives a seat to a person or to a device — one or the other — and shows who is using what", async () => {
    const licence = await newLicence();
    const device = await newDevice();
    await assignAsset({ assetId: device.id, holderType: "person", holderId: ids.tam, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await toPerson(licence.id, "huy");
    await toDevice(licence.id, device.id);
    expect(await fails(assignSeat({ licenceId: licence.id, personId: null, assetId: null, note: null }, ids.keeper))).toBe("seat_holder_required");
    expect(await fails(assignSeat({ licenceId: licence.id, personId: ids.chi, assetId: device.id, note: null }, ids.keeper))).toBe("seat_holder_required");

    const seats = await listSeatsOfLicence(licence.id);
    expect(seats.open.map((seat) => seat.personName ?? seat.assetCode).sort()).toEqual([device.code, "Hồ Gia Huy"].sort());
    // The seat on the device says who is sitting at the machine.
    expect(seats.open.find((seat) => seat.assetId === device.id)?.deviceHolderName).toBe("Bùi Thanh Tâm");
    expect((await listLicences(keeper, { id: licence.id }))[0].seatsUsed).toBe(2);
    expect((await listSeatsOfAsset(device.id)).map((seat) => seat.name)).toEqual(["Adobe Creative Cloud"]);
  });

  it("lists a person's software: seats in their name, and seats on the devices they hold", async () => {
    const own = await newLicence({ name: "Figma", seats: null });
    const onMachine = await newLicence({ name: "DaVinci Resolve Studio", seats: null });
    const device = await newDevice();
    await assignAsset({ assetId: device.id, holderType: "person", holderId: ids.chi, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await toPerson(own.id, "chi");
    await toDevice(onMachine.id, device.id);
    const mine = await listSeatsOfPerson(ids.chi);
    expect(mine.map((seat) => [seat.name, seat.viaAsset?.code ?? null])).toEqual([
      ["DaVinci Resolve Studio", device.code],
      ["Figma", null],
    ]);
  });

  it("refuses a second seat for the same holder, a seat past what is paid for, a leaver and a machine that is gone", async () => {
    const licence = await newLicence({ name: "CapCut Pro", seats: 2 });
    await toPerson(licence.id, "huy");
    expect(await fails(toPerson(licence.id, "huy"))).toBe("seat_already_assigned");
    await toPerson(licence.id, "tam");
    expect(await fails(toPerson(licence.id, "chi"))).toBe("seat_none_free");
    expect(await fails(toPerson((await newLicence({ name: "Slack" })).id, "gone"))).toBe("seat_holder_inactive");

    const lost = await newDevice();
    await setAssetStatus(lost.id, "lost", "Mất ở phim trường", ids.keeper);
    expect(await fails(toDevice((await newLicence({ name: "Notion" })).id, lost.id))).toBe("seat_device_unavailable");
    expect(await fails(toPerson((await newLicence({ name: "Đã hủy", status: "cancelled" })).id, "chi"))).toBe("licence_not_active");
  });

  it("lets the database say it too: one open seat per holder, and a seat with exactly one holder", async () => {
    const licence = await newLicence({ name: "Frame.io", seats: null });
    await toPerson(licence.id, "huy");
    await expect(db().insert(schema.licenceSeat).values({ licenceId: licence.id, personId: ids.huy })).rejects.toMatchObject({ cause: { constraint: "licence_seat_person_open_key" } });
    await expect(db().insert(schema.licenceSeat).values({ licenceId: licence.id })).rejects.toMatchObject({ cause: { constraint: "licence_seat_one_holder" } });
    const device = await newDevice();
    await expect(db().insert(schema.licenceSeat).values({ licenceId: licence.id, personId: ids.tam, assetId: device.id })).rejects.toMatchObject({ cause: { constraint: "licence_seat_one_holder" } });
  });
});

describe("taking seats back", () => {
  it("releases a seat, keeps the row as history, and frees the place for somebody else", async () => {
    const licence = await newLicence({ name: "Envato Elements", seats: 1 });
    const { seat } = await toPerson(licence.id, "huy");
    await releaseSeat(seat.id, "Đổi sang người khác", ids.keeper);
    expect(await fails(releaseSeat(seat.id, null, ids.keeper))).toBe("seat_already_released");
    await toPerson(licence.id, "tam");
    const seats = await listSeatsOfLicence(licence.id);
    expect(seats.open.map((row) => row.personName)).toEqual(["Bùi Thanh Tâm"]);
    expect(seats.released.map((row) => [row.personName, row.releaseNote])).toEqual([["Hồ Gia Huy", "Đổi sang người khác"]]);
  });

  it("frees the seats on a device that is lost or written off", async () => {
    const licence = await newLicence({ name: "Final Cut Pro", seats: 2 });
    const device = await newDevice();
    await toDevice(licence.id, device.id);
    await setAssetStatus(device.id, "disposed", "Thanh lý", ids.keeper);
    expect((await listSeatsOfLicence(licence.id)).open).toEqual([]);
    expect((await listLicences(keeper, { id: licence.id }))[0].seatsUsed).toBe(0);
  });

  it("will not cut the seat count below what is in use, and lets go of every seat when the subscription ends", async () => {
    const licence = await newLicence({ name: "Microsoft 365", seats: 3 });
    await toPerson(licence.id, "huy");
    await toPerson(licence.id, "tam");
    expect(await fails(saveLicence(licence.id, licenceInput({ name: "Microsoft 365", seats: 1 }), ids.keeper))).toBe("licence_seats_below_used");
    expect((await saveLicence(licence.id, licenceInput({ name: "Microsoft 365", seats: 2 }), ids.keeper)).released).toBe(0);
    const ended = await saveLicence(licence.id, licenceInput({ name: "Microsoft 365", seats: 2, status: "cancelled" }), ids.keeper);
    expect(ended.released).toBe(2);
    expect((await listSeatsOfLicence(licence.id)).open).toEqual([]);
  });
});

describe("what the unused seats cost", () => {
  it("sums seats paid for against seats in use, and brings every cycle to a month", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZT", legalName: "Totals", shortName: "Totals" }).returning();
    const scoped = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "entity", id: fresh.id } }]);
    // 12,000,000 a year for 4 seats = 1,000,000 a month, 250,000 a seat; one in use.
    const annual = await newLicence({ name: "Năm", entityId: fresh.id, seats: 4, costPerCycle: 12_000_000, billingCycle: "annual" });
    // 600,000 a month for 2 seats, both in use.
    const monthly = await newLicence({ name: "Tháng", entityId: fresh.id, seats: 2, costPerCycle: 600_000, billingCycle: "monthly", renewalDate: "2026-11-01" });
    // A perpetual licence costs nothing per month, and one that has ended is not counted at all.
    await newLicence({ name: "Vĩnh viễn", entityId: fresh.id, seats: 1, costPerCycle: 9_000_000, billingCycle: "perpetual", renewalDate: null });
    await newLicence({ name: "Hết hạn", entityId: fresh.id, seats: 10, costPerCycle: 5_000_000, status: "expired" });
    await toPerson(annual.id, "huy");
    await toPerson(monthly.id, "huy");
    await toPerson(monthly.id, "tam");

    expect(await licenceTotals(scoped)).toEqual({ active: 3, seats: 7, seatsUsed: 3, seatsUnused: 4, costPerMonth: 1_600_000, unusedPerMonth: 750_000 });
    // Somebody who keeps no register is shown nothing.
    expect(await licenceTotals(principal("plain"))).toMatchObject({ active: 0, costPerMonth: null });
  });
});

describe("what a leaver gives back", () => {
  it("opens one task per seat in their name for whoever looks after the subscription, and settles it when the seat is taken back", async () => {
    const leaver = (await db().insert(schema.person).values({ fullName: "Người sắp nghỉ", searchName: "leaver", primaryEntityId: ids.szm, status: "active", managerId: ids.long }).returning())[0].id;
    const licence = await newLicence({ name: "Adobe của người nghỉ", seats: null });
    const { seat } = await assignSeat({ licenceId: licence.id, personId: leaver, assetId: null, note: null }, ids.keeper);
    // A seat on a device they hold is not theirs to give back: it goes with the machine.
    const device = await newDevice();
    await assignAsset({ assetId: device.id, holderType: "person", holderId: leaver, conditionOut: "good", dueBack: null, purpose: null, accessories: [] }, ids.keeper);
    await toDevice((await newLicence({ name: "Trên máy", seats: null })).id, device.id);

    // One for the laptop, one for the seat.
    expect(await db().transaction((tx) => openReturnTasks(tx, leaver, "2026-10-31", ids.keeper))).toBe(2);
    const [task] = await db().select().from(schema.task).where(and(eq(schema.task.kind, "licence_seat_release"), eq(schema.task.subjectPersonId, leaver)));
    expect(task).toMatchObject({ assigneePersonId: ids.chi, contextId: seat.id, dueDate: "2026-10-31", title: "Thu hồi suất dùng: Adobe của người nghỉ", linkUrl: `/assets/licences/${licence.id}` });
    expect(await db().transaction((tx) => openReturnTasks(tx, leaver, "2026-10-31", ids.keeper))).toBe(0);

    await releaseSeat(seat.id, "Nghỉ việc", ids.keeper);
    const [after] = await db().select().from(schema.task).where(eq(schema.task.id, task.id));
    expect(after.status).toBe("cancelled");
    // Nothing left of theirs to call off but the laptop.
    expect(await db().transaction((tx) => cancelReturnTasks(tx, leaver))).toBe(1);
  });
});
