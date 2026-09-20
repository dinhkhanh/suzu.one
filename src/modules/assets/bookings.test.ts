// Booking shared production gear against a real Postgres (PGlite): the reservation cycle, and —
// the point of the exercise — that two overlapping bookings are impossible *in the database*,
// not merely unlikely in the code. Every "cannot" here is proved by going round the use-case and
// inserting the row by hand, which is the only way to know the constraint is what stops it.
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { bookAsset, cancelBooking, checkInBooking, checkOutBooking, decideBooking, findAsset, findBooking, listBookableAssets, listBookingRequests, listBookings, listBookingsOfPerson, registerAsset } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

// Everything is set well into the future, so "in the past" never depends on when the suite runs.
const DAY = 86_400_000;
const soon = (days: number, hour = 9) => new Date(Date.now() + days * DAY + hour * 3_600_000);

const ids = {} as Record<"szm" | "camera" | "laptop" | "keeper" | "tam" | "huy", string>;
let keeper: Principal;
let tam: Principal;
let huy: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  ids.szm = szm.id;
  for (const [key, fullName] of [
    ["keeper", "Người giữ kho"],
    ["tam", "Bùi Thanh Tâm"],
    ["huy", "Hồ Gia Huy"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, departmentId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  const [camera] = await db().insert(schema.assetCategory).values({ code: "CAM", name: "Máy quay", kind: "production_gear", requiresSerial: true, bookable: true, sortOrder: 1 }).returning();
  const [laptop] = await db().insert(schema.assetCategory).values({ code: "LAP", name: "Máy tính xách tay", kind: "it_equipment", requiresSerial: true, bookable: false, sortOrder: 2 }).returning();
  Object.assign(ids, { camera: camera.id, laptop: laptop.id });

  keeper = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "group" } }]);
  tam = principal(ids.tam);
  huy = principal(ids.huy);
});

let serial = 0;
const newCamera = (categoryId = ids.camera) =>
  registerAsset(
    { categoryId, entityId: ids.szm, name: "Sony FX6", brand: "Sony", model: "FX6", serial: `CAM-${++serial}`, purchaseDate: "2025-01-10", purchasePrice: 180_000_000, supplier: "Sony VN", warrantyUntil: "2027-01-10", condition: "good", location: "Kho tầng 3", notes: null },
    ids.keeper,
  );

const book = (assetId: string, who: { personId: string; principal: Principal }, from: Date, to: Date, purpose: string | null = "Quay phóng sự") =>
  bookAsset({ assetId, personId: who.personId, startAt: from, endAt: to, purpose, projectRef: null }, who);

const asKeeper = { personId: ids.keeper, principal: {} as Principal };

describe("making a booking", () => {
  it("a keeper's booking is confirmed on the spot; anybody else's is a request", async () => {
    const asset = await newCamera();
    const theirs = await book(asset.id, { personId: ids.tam, principal: tam }, soon(3), soon(3, 17));
    expect(theirs.status).toBe("requested");

    const mine = await book(asset.id, { personId: ids.keeper, principal: keeper }, soon(5), soon(5, 17));
    expect(mine.status).toBe("confirmed");
    expect(mine.decidedAt).not.toBeNull();
  });

  it("writes the booking into the asset's own history", async () => {
    const asset = await newCamera();
    const booking = await book(asset.id, { personId: ids.tam, principal: tam }, soon(3), soon(3, 17));
    const events = await db().select().from(schema.assetEvent).where(eq(schema.assetEvent.assetId, asset.id));
    const booked = events.find((event) => event.type === "booked");
    expect(booked).toBeDefined();
    expect((booked?.detail as { bookingId?: string }).bookingId).toBe(booking.id);
  });

  it("refuses gear whose category nobody books, and gear that is lost or being mended", async () => {
    const laptop = await newCamera(ids.laptop);
    expect(await fails(book(laptop.id, { personId: ids.tam, principal: tam }, soon(3), soon(3, 17)))).toBe("asset_not_bookable");

    const broken = await newCamera();
    await db().update(schema.asset).set({ status: "in_repair" }).where(eq(schema.asset.id, broken.id));
    expect(await fails(book(broken.id, { personId: ids.tam, principal: tam }, soon(3), soon(3, 17)))).toBe("asset_in_repair");

    const gone = await newCamera();
    await db().update(schema.asset).set({ status: "lost" }).where(eq(schema.asset.id, gone.id));
    expect(await fails(book(gone.id, { personId: ids.tam, principal: tam }, soon(3), soon(3, 17)))).toBe("asset_not_assignable");
  });

  it("refuses a booking for somebody who has left", async () => {
    const asset = await newCamera();
    const [gone] = await db().insert(schema.person).values({ fullName: "Người đã nghỉ", searchName: "gone", primaryEntityId: ids.szm, status: "offboarded" }).returning();
    expect(await fails(book(asset.id, { personId: gone.id, principal: keeper }, soon(3), soon(3, 17)))).toBe("asset_holder_inactive");
  });
});

describe("two bookings never overlap", () => {
  it("refuses a second booking that runs into the first, and says so in words", async () => {
    const asset = await newCamera();
    await book(asset.id, { personId: ids.tam, principal: keeper }, soon(3, 8), soon(3, 18));
    expect(await fails(book(asset.id, { personId: ids.huy, principal: huy }, soon(3, 12), soon(3, 20)))).toBe("asset_booking_clash");
  });

  it("allows a booking that begins exactly when the one before it ends", async () => {
    const asset = await newCamera();
    await book(asset.id, { personId: ids.tam, principal: keeper }, soon(4, 8), soon(4, 12));
    const next = await book(asset.id, { personId: ids.huy, principal: huy }, soon(4, 12), soon(4, 18));
    expect(next.id).toBeDefined();
  });

  it("is the DATABASE that forbids it — an overlapping row inserted past the use-case is refused", async () => {
    const asset = await newCamera();
    const first = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(6, 8), soon(6, 18));
    const refusal = await db()
      .insert(schema.assetBooking)
      .values({ assetId: asset.id, personId: ids.huy, startAt: soon(6, 10), endAt: soon(6, 14), status: "confirmed" })
      .then(
        () => null,
        // Drizzle wraps the driver's error; the constraint's name and code are on the cause.
        (error: Error & { cause?: { code?: string; constraint_name?: string; message?: string } }) => error.cause ?? error,
      );
    expect(refusal).not.toBeNull();
    expect((refusal as { code?: string }).code).toBe("23P01");
    expect(JSON.stringify(refusal)).toContain("asset_booking_no_overlap");
    // The first booking is untouched.
    expect((await findBooking(first.id))?.status).toBe("confirmed");
  });

  it("frees the slot when a booking is called off — the same window is then bookable", async () => {
    const asset = await newCamera();
    const first = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(7, 8), soon(7, 18));
    await cancelBooking(first.id, "Hoãn quay", ids.tam);
    const second = await book(asset.id, { personId: ids.huy, principal: huy }, soon(7, 8), soon(7, 18));
    expect(second.id).toBeDefined();
  });

  it("frees the rest of the window when the gear comes back early", async () => {
    const asset = await newCamera();
    const long = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(8, 8), soon(11, 18));
    await checkOutBooking({ bookingId: long.id, conditionOut: "good", note: null }, ids.keeper);
    // Still out: nobody else may have it.
    expect(await fails(book(asset.id, { personId: ids.huy, principal: huy }, soon(10, 8), soon(10, 18)))).toBe("asset_booking_clash");
    await checkInBooking({ bookingId: long.id, conditionIn: "good", note: "Về sớm" }, ids.keeper);
    // Back on the shelf a day early, and the last two days are somebody else's to take.
    const next = await book(asset.id, { personId: ids.huy, principal: huy }, soon(10, 8), soon(10, 18));
    expect(next.id).toBeDefined();
  });

  it("a request holds the slot just as a confirmation does — asking early beats confirming late", async () => {
    const asset = await newCamera();
    await book(asset.id, { personId: ids.tam, principal: tam }, soon(12, 8), soon(12, 18));
    expect(await fails(book(asset.id, { personId: ids.keeper, principal: keeper }, soon(12, 9), soon(12, 12)))).toBe("asset_booking_clash");
  });
});

describe("the keeper's answer", () => {
  it("confirms a request", async () => {
    const asset = await newCamera();
    const asked = await book(asset.id, { personId: ids.tam, principal: tam }, soon(13), soon(13, 17));
    const after = await decideBooking(asked.id, "confirm", null, ids.keeper);
    expect(after.status).toBe("confirmed");
    expect(after.decidedByPersonId).toBe(ids.keeper);
  });

  it("refuses one only with a reason, and the refusal frees the slot", async () => {
    const asset = await newCamera();
    const asked = await book(asset.id, { personId: ids.tam, principal: tam }, soon(14), soon(14, 17));
    expect(await fails(decideBooking(asked.id, "refuse", "  ", ids.keeper))).toBe("asset_booking_reason_required");
    const after = await decideBooking(asked.id, "refuse", "Máy đã hẹn bảo dưỡng", ids.keeper);
    expect(after.status).toBe("cancelled");
    const replacement = await book(asset.id, { personId: ids.huy, principal: huy }, soon(14), soon(14, 17));
    expect(replacement.id).toBeDefined();
  });

  it("answers a request once and only once", async () => {
    const asset = await newCamera();
    const asked = await book(asset.id, { personId: ids.tam, principal: tam }, soon(15), soon(15, 17));
    await decideBooking(asked.id, "confirm", null, ids.keeper);
    expect(await fails(decideBooking(asked.id, "confirm", null, ids.keeper))).toBe("asset_booking_not_pending");
  });

  it("lists what is still waiting, within the keeper's own entities", async () => {
    const asset = await newCamera();
    await book(asset.id, { personId: ids.tam, principal: tam }, soon(16), soon(16, 17));
    const waiting = await listBookingRequests(keeper);
    expect(waiting.some((row) => row.assetId === asset.id)).toBe(true);
    // A keeper of nothing sees nothing.
    expect(await listBookingRequests(principal(ids.huy))).toEqual([]);
  });
});

describe("out and back", () => {
  it("takes the gear off the shelf and brings it back, moving the asset with it", async () => {
    const asset = await newCamera();
    const booking = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(17, 8), soon(17, 18));
    await checkOutBooking({ bookingId: booking.id, conditionOut: "good", note: null }, ids.keeper);
    expect((await findAsset(asset.id))?.status).toBe("assigned");

    await checkInBooking({ bookingId: booking.id, conditionIn: "fair", note: "Xước nhẹ ở thân máy" }, ids.keeper);
    const back = await findAsset(asset.id);
    expect(back?.status).toBe("in_stock");
    expect(back?.condition).toBe("fair");
  });

  it("sends gear that came back broken to the repair bench, not the shelf", async () => {
    const asset = await newCamera();
    const booking = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(18, 8), soon(18, 18));
    await checkOutBooking({ bookingId: booking.id, conditionOut: "good", note: null }, ids.keeper);
    await checkInBooking({ bookingId: booking.id, conditionIn: "broken", note: "Rơi khi quay" }, ids.keeper);
    expect((await findAsset(asset.id))?.status).toBe("in_repair");
  });

  it("will not hand out gear nobody has confirmed, nor take back gear that never went out", async () => {
    const asset = await newCamera();
    const asked = await book(asset.id, { personId: ids.tam, principal: tam }, soon(19), soon(19, 17));
    expect(await fails(checkOutBooking({ bookingId: asked.id, conditionOut: "good", note: null }, ids.keeper))).toBe("asset_booking_not_confirmed");
    await decideBooking(asked.id, "confirm", null, ids.keeper);
    expect(await fails(checkInBooking({ bookingId: asked.id, conditionIn: "good", note: null }, ids.keeper))).toBe("asset_booking_not_checked_out");
  });

  it("refuses to cancel gear that is out of the building — it is brought back, not called off", async () => {
    const asset = await newCamera();
    const booking = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(20, 8), soon(20, 18));
    await checkOutBooking({ bookingId: booking.id, conditionOut: "good", note: null }, ids.keeper);
    expect(await fails(cancelBooking(booking.id, "Đổi ý", ids.tam))).toBe("asset_booking_checked_out");
  });

  it("leaves a long-term assignment alone: gear booked and returned goes back to its holder", async () => {
    const asset = await newCamera();
    await db().insert(schema.assetAssignment).values({ assetId: asset.id, holderType: "team", holderTeamId: null, holderEntityId: ids.szm, conditionOut: "good" });
    await db().update(schema.asset).set({ status: "assigned" }).where(eq(schema.asset.id, asset.id));
    const booking = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(21, 8), soon(21, 18));
    await checkOutBooking({ bookingId: booking.id, conditionOut: "good", note: null }, ids.keeper);
    await checkInBooking({ bookingId: booking.id, conditionIn: "good", note: null }, ids.keeper);
    expect((await findAsset(asset.id))?.status).toBe("assigned");
  });
});

describe("reading the calendar", () => {
  it("shows the bookings that touch the window asked for, and nothing outside it", async () => {
    const asset = await newCamera();
    const inside = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(30, 8), soon(30, 18));
    await book(asset.id, { personId: ids.tam, principal: keeper }, soon(60, 8), soon(60, 18));
    const drawn = await listBookings({ from: soon(29), to: soon(32), assetId: asset.id });
    expect(drawn.map((row) => row.id)).toEqual([inside.id]);
    expect(drawn[0].assetCode).toBe(asset.code);
    expect(drawn[0].personName).toBe("Bùi Thanh Tâm");
  });

  it("leaves cancelled and returned bookings out unless they are asked for", async () => {
    const asset = await newCamera();
    const booking = await book(asset.id, { personId: ids.tam, principal: keeper }, soon(33, 8), soon(33, 18));
    await cancelBooking(booking.id, "Hoãn", ids.tam);
    expect(await listBookings({ from: soon(32), to: soon(35), assetId: asset.id })).toEqual([]);
    const withHistory = await listBookings({ from: soon(32), to: soon(35), assetId: asset.id, includeClosed: true });
    expect(withHistory.map((row) => row.status)).toEqual(["cancelled"]);
  });

  it("lists one person's own coming bookings", async () => {
    const asset = await newCamera();
    const mine = await book(asset.id, { personId: ids.huy, principal: keeper }, soon(36, 8), soon(36, 18));
    const rows = await listBookingsOfPerson(ids.huy);
    expect(rows.some((row) => row.id === mine.id)).toBe(true);
  });

  it("offers only bookable, usable gear to book", async () => {
    const camera = await newCamera();
    const laptop = await newCamera(ids.laptop);
    const gone = await newCamera();
    await db().update(schema.asset).set({ status: "disposed" }).where(eq(schema.asset.id, gone.id));
    const offered = await listBookableAssets({});
    const codes = offered.map((row) => row.id);
    expect(codes).toContain(camera.id);
    expect(codes).not.toContain(laptop.id);
    expect(codes).not.toContain(gone.id);
  });
});

// Keeps the unused binding honest — `asKeeper` documents the shape a caller passes.
void asKeeper;
