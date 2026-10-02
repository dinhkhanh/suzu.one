// The face kiosk against a real Postgres (PGlite with pgvector): who a face is, among whom; what
// enrolment refuses; a kiosk's token and its QR code; a face punch, "Not me", and the cooldown.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
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
import { migrateTestDb } from "../../../tests/helpers/db";
import { commitKioskPunch, nextKioskDirection, recentKioskPunches, saveDevice, saveProfile, withdrawKioskPunch } from "./devices";
import { PROFILE_SEED } from "./engine/device-log";
import { EMBEDDING_SIZE, normalise } from "./engine/face";
import { qrWindow } from "./engine/kiosk-qr";
import { deleteFaces, enrolFaces, faceStatusOf, purgeFacesOfLeavers, recogniseFace } from "./faces";
import { closeKioskSession, kioskOfQrToken, kioskOfToken, kioskQrUrl, openKioskSession } from "./kiosk";

const ids = {} as Record<"media" | "creative" | "huy" | "nhu" | "lan" | "hr" | "device", string>;

/** A random direction in 128 dimensions, the same for the same seed (mulberry32). */
function direction(seed: number): number[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  return Array.from({ length: EMBEDDING_SIZE }, next);
}
/** A face; `noise` mixes in another direction — another photo of the same face. Different seeds are strangers (cosine near 0). */
const face = (seed: number, noise = 0, variant = 0): number[] => {
  const own = direction(seed * 7919);
  const other = direction(seed * 104729 + variant + 1);
  return normalise(own.map((value, index) => value + noise * other[index]));
};

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const person = async (name: string, entityId: string, status: "active" | "offboarded" = "active") => (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, status }).returning())[0].id;
  Object.assign(ids, { media: media.id, creative: creative.id, huy: await person("Huy", media.id), nhu: await person("Nhu", media.id), lan: await person("Lan", creative.id), hr: await person("Bao", media.id) });
  const { after: profile } = await saveProfile({ id: null, entityId: null, ...PROFILE_SEED[1], isActive: true });
  const { after: device } = await saveDevice({ id: null, entityId: media.id, name: "Cửa chính", model: null, serialNumber: null, locationId: null, profileId: profile.id, isActive: true });
  ids.device = device.id;
});

describe("enrolling a face", () => {
  it("needs the person's consent the first time, and records it", async () => {
    await expect(enrolFaces({ personId: ids.huy, entityId: ids.media, embeddings: [face(1)], consent: false, actorPersonId: ids.hr })).rejects.toThrow("face_consent_required");
    expect(await enrolFaces({ personId: ids.huy, entityId: ids.media, embeddings: [face(1), face(1, 0.2)], consent: true, actorPersonId: ids.hr })).toEqual({ added: 2, total: 2, consentRecorded: true });
    // Later photos need no new consent.
    expect(await enrolFaces({ personId: ids.huy, entityId: ids.media, embeddings: [face(1, 0.3)], consent: false, actorPersonId: ids.hr })).toMatchObject({ added: 1, total: 3, consentRecorded: false });
    const status = await faceStatusOf([ids.huy, ids.nhu]);
    expect(status.get(ids.huy)).toMatchObject({ templates: 3 });
    expect(status.has(ids.nhu)).toBe(false);
  });

  it("refuses photos of more than one face, and a face already somebody else's", async () => {
    await expect(enrolFaces({ personId: ids.nhu, entityId: ids.media, embeddings: [face(2), face(3)], consent: true, actorPersonId: ids.hr })).rejects.toThrow("face_photos_differ");
    await expect(enrolFaces({ personId: ids.nhu, entityId: ids.media, embeddings: [face(1, 0.1)], consent: true, actorPersonId: ids.hr })).rejects.toThrow("face_looks_like_someone_else");
    expect((await faceStatusOf([ids.nhu])).has(ids.nhu)).toBe(false);
    await enrolFaces({ personId: ids.nhu, entityId: ids.media, embeddings: [face(2)], consent: true, actorPersonId: ids.hr });
    await enrolFaces({ personId: ids.lan, entityId: ids.creative, embeddings: [face(4)], consent: true, actorPersonId: ids.hr });
  });

  it("keeps the newest ten templates", async () => {
    const result = await enrolFaces({ personId: ids.huy, entityId: ids.media, embeddings: Array.from({ length: 9 }, (_, index) => face(1, 0.3, index)), consent: false, actorPersonId: ids.hr });
    expect(result.total).toBe(10);
  });
});

describe("naming a face", () => {
  it("names the person among the entities the kiosk serves, and nobody outside them", async () => {
    expect(await recogniseFace(face(1, 0.25), [ids.media])).toMatchObject({ personId: ids.huy, name: "Huy", entityId: ids.media });
    expect(await recogniseFace(face(2, 0.1), [ids.media])).toMatchObject({ personId: ids.nhu });
    // Lan works for Creative: a Media-only kiosk does not know her.
    expect(await recogniseFace(face(4), [ids.media])).toBeNull();
    expect(await recogniseFace(face(4), [ids.media, ids.creative])).toMatchObject({ personId: ids.lan });
  });

  it("does not name a stranger, or a malformed embedding", async () => {
    expect(await recogniseFace(face(99), [ids.media, ids.creative])).toBeNull();
    expect(await recogniseFace(face(1).slice(0, 64), [ids.media])).toBeNull();
  });

  it("forgets someone who has left, and deletes their face at night", async () => {
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, ids.nhu));
    expect(await recogniseFace(face(2), [ids.media])).toBeNull();
    expect(await purgeFacesOfLeavers()).toBe(1);
    expect((await faceStatusOf([ids.nhu])).has(ids.nhu)).toBe(false);
    await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, ids.nhu));
  });

  it("deletes a person's face data with the consent record", async () => {
    expect(await deleteFaces(ids.lan)).toBe(1);
    expect(await recogniseFace(face(4), [ids.creative])).toBeNull();
    expect(await deleteFaces(ids.lan)).toBe(0);
  });
});

describe("a kiosk on the wall", () => {
  it("is known by its token until it is closed", async () => {
    const device = (await db().select().from(schema.attendanceDevice).where(eq(schema.attendanceDevice.id, ids.device)))[0];
    const { token, session } = await openKioskSession({ device, openedByPersonId: ids.hr, userAgent: "Tablet" });
    expect(token).toMatch(/^szk_[A-Za-z0-9_-]{43}$/);
    expect(await kioskOfToken(token)).toMatchObject({ session: { id: session.id }, device: { id: ids.device }, entityIds: [ids.media] });
    expect(await kioskOfToken(`szk_${"a".repeat(43)}`)).toBeNull();
    expect(await kioskOfToken(null)).toBeNull();

    // Its QR code: good now and for two windows after, never forged, never once the kiosk is closed.
    const url = new URL(kioskQrUrl(session, Date.now()));
    expect(url.origin + url.pathname).toBe("https://suzu.one/attendance/check-in/kiosk");
    const code = url.searchParams.get("t")!;
    expect(await kioskOfQrToken(code)).toMatchObject({ session: { id: session.id } });
    expect(await kioskOfQrToken(code, Date.now() + 3 * 20_000)).toBeNull();
    const [sessionId, window] = code.split(".");
    expect(await kioskOfQrToken(`${sessionId}.${window}.${"A".repeat(22)}`)).toBeNull();
    expect(await kioskOfQrToken(`${sessionId}.${qrWindow(Date.now()) + 1}.${code.split(".")[2]}`)).toBeNull();

    await closeKioskSession(session.id, ids.hr);
    expect(await kioskOfToken(token)).toBeNull();
    expect(await kioskOfQrToken(code)).toBeNull();
    await expect(closeKioskSession(session.id, ids.hr)).rejects.toThrow("not_found");
  });

  it("punches for a face, takes it back on \"Not me\", and remembers who checked in a moment ago", async () => {
    const since = new Date(Date.now() - 60_000);
    const made = await commitKioskPunch(ids.device, { personId: ids.huy, entityId: ids.media }, "face");
    const [row] = await db().select().from(schema.punch).where(eq(schema.punch.id, made.punchId));
    expect(made.direction).toBe("in");
    expect(row).toMatchObject({ personId: ids.huy, source: "device", deviceId: ids.device, deviceUserId: `face:${ids.huy}`, direction: "in" });
    expect((await recentKioskPunches(ids.device, [ids.huy, ids.nhu], since)).has(ids.huy)).toBe(true);

    // Only this clock's own, only while fresh.
    expect(await withdrawKioskPunch("00000000-0000-4000-8000-000000000000", made.punchId)).toBeNull();
    expect(await withdrawKioskPunch(ids.device, made.punchId, new Date(Date.now() + 120_000))).toBeNull();
    expect(await withdrawKioskPunch(ids.device, made.punchId)).toMatchObject({ personId: ids.huy });
    expect(await db().select().from(schema.punch).where(eq(schema.punch.id, made.punchId))).toEqual([]);
    expect((await recentKioskPunches(ids.device, [ids.huy], since)).size).toBe(0);

    // A QR check-in is the person's own, and "Not me" cannot take it back.
    const scanned = await commitKioskPunch(ids.device, { personId: ids.nhu, entityId: ids.media }, "qr");
    expect(await withdrawKioskPunch(ids.device, scanned.punchId)).toBeNull();
  });

  it("leaves after arriving by any route, and arrives again once the stay is over", async () => {
    // Nhu checked in on her phone this morning: the kiosk tonight is her departure.
    const morning = new Date(Date.now() - 9 * 3_600_000);
    await db().insert(schema.punch).values({ personId: ids.nhu, entityId: ids.media, at: morning, direction: "in", source: "app" });
    expect(await nextKioskDirection(ids.nhu)).toBe("out");
    const evening = await commitKioskPunch(ids.device, { personId: ids.nhu, entityId: ids.media }, "face");
    expect(evening.direction).toBe("out");
    expect((await recentKioskPunches(ids.device, [ids.nhu], new Date(Date.now() - 60_000))).get(ids.nhu)).toMatchObject({ direction: "out" });
    // Out is out: the next punch arrives. And an arrival more than 16 hours old no longer holds a stay open.
    expect(await nextKioskDirection(ids.nhu, new Date(Date.now() + 1000))).toBe("in");
    await db().insert(schema.punch).values({ personId: ids.hr, entityId: ids.media, at: new Date(Date.now() - 17 * 3_600_000), direction: "in", source: "app" });
    expect(await nextKioskDirection(ids.hr)).toBe("in");
    // A rejected punch does not count.
    await db().insert(schema.punch).values({ personId: ids.hr, entityId: ids.media, at: new Date(Date.now() - 3_600_000), direction: "in", source: "app", reviewStatus: "rejected" });
    expect(await nextKioskDirection(ids.hr)).toBe("in");
  });
});
