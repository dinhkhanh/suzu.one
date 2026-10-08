// The face kiosk against a real Postgres (PGlite with pgvector): who a face is, among whom; what
// enrolment refuses; a kiosk's token and its QR code; a face punch, "Not me", and the cooldown;
// how long a kiosk stays one; and the limiter of the endpoints nobody signs in to.
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
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { commitKioskPunch, KIOSK_COOLDOWN_MS, nextKioskDirection, recentKioskPunches, saveDevice, saveProfile, withdrawKioskPunch } from "./devices";
import { countEndpointHit, endpointKey, purgeEndpointHits } from "./endpoint-limit";
import { PROFILE_SEED } from "./engine/device-log";
import { EMBEDDING_SIZE, normalise } from "./engine/face";
import { KIOSK_IDLE_DAYS, KIOSK_MAX_DAYS } from "./engine/kiosk-lifetime";
import { qrWindow } from "./engine/kiosk-qr";
import { ENDPOINT_LIMITS } from "./engine/rate-limit";
import { deleteFaces, enrolFaces, faceLeaversJob, faceStatusOf, purgeFacesOfLeavers, recogniseFace } from "./faces";
import { closeKioskSession, closeLapsedKioskSessions, kioskAccessOfToken, kioskOfQrToken, kioskOfToken, kioskQrCodes, kioskQrUrl, listKioskDevices, openKioskSession } from "./kiosk";

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
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const person = async (name: string, entityId: string, status: "active" | "offboarded" = "active") =>
    (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, status }).returning())[0].id;
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

    // A batch: one code per window from now on, each good only once its window has started.
    const batch = kioskQrCodes(session, Date.now(), 4);
    expect(batch.map((item) => item.window)).toEqual([0, 1, 2, 3].map((offset) => qrWindow(Date.now()) + offset));
    expect(new URL(batch[0].url).searchParams.get("t")).toBe(code);
    const later = new URL(batch[3].url).searchParams.get("t")!;
    expect(await kioskOfQrToken(later)).toBeNull();
    expect(await kioskOfQrToken(later, Date.now() + 3 * 20_000)).toMatchObject({ session: { id: session.id } });

    await closeKioskSession(session.id, ids.hr);
    expect(await kioskOfToken(token)).toBeNull();
    expect(await kioskOfQrToken(code)).toBeNull();
    await expect(closeKioskSession(session.id, ids.hr)).rejects.toThrow("not_found");
  });

  it('punches for a face, takes it back on "Not me", and remembers who checked in a moment ago', async () => {
    const since = new Date(Date.now() - 60_000);
    const made = (await commitKioskPunch(ids.device, { personId: ids.huy, entityId: ids.media }, "face")) as { punchId: string; direction: "in" | "out" };
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
    expect(await withdrawKioskPunch(ids.device, scanned.punchId!)).toBeNull();
  });

  it("leaves after arriving by any route, and arrives again once the stay is over", async () => {
    // Nhu checked in on her phone this morning: the kiosk tonight is her departure.
    const morning = new Date(Date.now() - 9 * 3_600_000);
    await db().insert(schema.punch).values({ personId: ids.nhu, entityId: ids.media, at: morning, direction: "in", source: "app" });
    expect(await nextKioskDirection(ids.nhu)).toBe("out");
    // (Past the minute after her QR check-in of a moment ago, inside which a kiosk makes no second punch.)
    const tonight = new Date(Date.now() + 2 * KIOSK_COOLDOWN_MS);
    const evening = await commitKioskPunch(ids.device, { personId: ids.nhu, entityId: ids.media }, "face", tonight);
    expect(evening).toMatchObject({ direction: "out", repeat: false });
    expect((await recentKioskPunches(ids.device, [ids.nhu], new Date(Date.now() - 60_000))).get(ids.nhu)).toMatchObject({ direction: "out" });
    // Out is out: the next punch arrives. And an arrival more than 16 hours old no longer holds a stay open.
    expect(await nextKioskDirection(ids.nhu, new Date(tonight.getTime() + 1000))).toBe("in");
    await db()
      .insert(schema.punch)
      .values({ personId: ids.hr, entityId: ids.media, at: new Date(Date.now() - 17 * 3_600_000), direction: "in", source: "app" });
    expect(await nextKioskDirection(ids.hr)).toBe("in");
    // A rejected punch does not count.
    await db()
      .insert(schema.punch)
      .values({ personId: ids.hr, entityId: ids.media, at: new Date(Date.now() - 3_600_000), direction: "in", source: "app", reviewStatus: "rejected" });
    expect(await nextKioskDirection(ids.hr)).toBe("in");
  });
});

const DAY = 86_400_000;
const deviceRow = async () => (await db().select().from(schema.attendanceDevice).where(eq(schema.attendanceDevice.id, ids.device)))[0];
const sessionRow = async (id: string) => (await db().select().from(schema.kioskSession).where(eq(schema.kioskSession.id, id)))[0];

describe("how long a kiosk stays a kiosk", () => {
  it("stays open while it keeps being used, and stops when left unused for two weeks", async () => {
    const { token, session } = await openKioskSession({ device: await deviceRow(), openedByPersonId: ids.hr, userAgent: "Tablet" });
    const opened = session.openedAt.getTime();
    // Used on day 13: seen, so the two weeks start again from there.
    const day13 = new Date(opened + 13 * DAY);
    expect(await kioskAccessOfToken(token, day13)).toMatchObject({ status: "open", kiosk: { session: { id: session.id } } });
    expect((await sessionRow(session.id)).lastSeenAt?.getTime()).toBe(day13.getTime());
    expect(await kioskOfToken(token, new Date(opened + 26 * DAY))).toMatchObject({ session: { id: session.id } });
    // Then nobody for two weeks: refused, and told apart from a kiosk that was never one.
    const idle = new Date(opened + (26 + KIOSK_IDLE_DAYS) * DAY);
    expect(await kioskAccessOfToken(token, idle)).toEqual({ status: "expired" });
    expect(await kioskOfToken(token, idle)).toBeNull();
    // A refused call is not a use: the session's last moment is still day 26.
    expect((await sessionRow(session.id)).lastSeenAt?.getTime()).toBe(opened + 26 * DAY);
    expect(await kioskAccessOfToken(`szk_${"c".repeat(43)}`, idle)).toEqual({ status: "none" });
    // Its QR code stops with it: a phone cannot check in at a kiosk that has run out.
    const code = new URL(kioskQrUrl(session, idle.getTime())).searchParams.get("t")!;
    expect(await kioskOfQrToken(code, idle.getTime())).toBeNull();
    expect(await kioskOfQrToken(new URL(kioskQrUrl(session, opened + 27 * DAY)).searchParams.get("t")!, opened + 27 * DAY)).toMatchObject({ session: { id: session.id } });
    await closeKioskSession(session.id, ids.hr);
  });

  it("stops three months after it was opened, however much it is used", async () => {
    const { token, session } = await openKioskSession({ device: await deviceRow(), openedByPersonId: ids.hr, userAgent: "Tablet" });
    const opened = session.openedAt.getTime();
    // In use every week, to the last day.
    for (let day = 7; day < KIOSK_MAX_DAYS; day += 7) expect((await kioskAccessOfToken(token, new Date(opened + day * DAY))).status).toBe("open");
    expect((await kioskAccessOfToken(token, new Date(opened + KIOSK_MAX_DAYS * DAY - 60_000))).status).toBe("open");
    const after = new Date(opened + KIOSK_MAX_DAYS * DAY);
    expect(await kioskAccessOfToken(token, after)).toEqual({ status: "expired" });

    // The nightly job closes it with nobody's name, and the tablet still hears "expired", not "closed".
    expect(await closeLapsedKioskSessions(new Date(opened + (KIOSK_MAX_DAYS - 1) * DAY))).toBe(0);
    expect(await closeLapsedKioskSessions(after)).toBe(1);
    expect(await sessionRow(session.id)).toMatchObject({ closedAt: after, closedByPersonId: null });
    expect(await kioskAccessOfToken(token)).toEqual({ status: "expired" });
    await expect(closeKioskSession(session.id, ids.hr)).rejects.toThrow("not_found");
  });

  it('answers a kiosk HR closed with nothing, not with "expired"', async () => {
    const { token, session } = await openKioskSession({ device: await deviceRow(), openedByPersonId: ids.hr, userAgent: "Tablet" });
    await closeKioskSession(session.id, ids.hr);
    expect(await kioskAccessOfToken(token)).toEqual({ status: "none" });
    // Long after, too: a person closed it, whatever its age says.
    expect(await kioskAccessOfToken(token, new Date(Date.now() + 200 * DAY))).toEqual({ status: "none" });
    expect(await closeLapsedKioskSessions(new Date(Date.now() + 200 * DAY))).toBe(0);
  });

  it("closes a kiosk left unused at night, and leaves one in use alone", async () => {
    const device = await deviceRow();
    const quiet = await openKioskSession({ device, openedByPersonId: ids.hr, userAgent: "Left in a drawer" });
    const busy = await openKioskSession({ device, openedByPersonId: ids.hr, userAgent: "On the wall" });
    const night = new Date(Date.now() + (KIOSK_IDLE_DAYS + 1) * DAY);
    await kioskOfToken(busy.token, new Date(night.getTime() - 2 * DAY));
    expect(await closeLapsedKioskSessions(night)).toBe(1);
    expect((await sessionRow(quiet.session.id)).closedAt).toEqual(night);
    expect((await sessionRow(busy.session.id)).closedAt).toBeNull();
    await closeKioskSession(busy.session.id, ids.hr);
  });
});

describe("what a kiosk's cookie can do to somebody's day", () => {
  it("makes one punch per person per minute on a clock, however many are sent", async () => {
    const at = new Date(Date.now() + DAY);
    const person = { personId: ids.lan, entityId: ids.creative };
    // Five at once, as a script holding the cookie would send them.
    const sent = await Promise.all(Array.from({ length: 5 }, (_, index) => commitKioskPunch(ids.device, person, "face", new Date(at.getTime() + index))));
    expect(sent.filter((made) => !made.repeat)).toHaveLength(1);
    const first = sent.find((made) => !made.repeat)!;
    for (const again of sent.filter((made) => made.repeat)) expect(again).toEqual({ punchId: null, at: first.at, direction: first.direction, repeat: true });
    // Still inside the minute: the earlier punch again, and nothing written.
    expect(await commitKioskPunch(ids.device, person, "face", new Date(at.getTime() + KIOSK_COOLDOWN_MS - 1000))).toMatchObject({ punchId: null, repeat: true, direction: "in" });
    expect(await db().select({ id: schema.punch.id }).from(schema.punch).where(eq(schema.punch.personId, ids.lan))).toHaveLength(1);
    // Past it: the next punch, which leaves.
    expect(await commitKioskPunch(ids.device, person, "face", new Date(at.getTime() + KIOSK_COOLDOWN_MS + 1000))).toMatchObject({ repeat: false, direction: "out" });
    expect(await db().select({ id: schema.punch.id }).from(schema.punch).where(eq(schema.punch.personId, ids.lan))).toHaveLength(2);
  });

  it("writes the tablet session on every punch that came through it, and counts today's for HR", async () => {
    const hrAdmin: Principal = { personId: ids.hr, workforceType: "employee", grants: [{ role: "hr_admin", scope: { type: "group" } }] };
    const { session } = await openKioskSession({ device: await deviceRow(), openedByPersonId: ids.hr, userAgent: "Tablet" });
    const other = await openKioskSession({ device: await deviceRow(), openedByPersonId: ids.hr, userAgent: "Second tablet" });
    const now = new Date();
    const face = await commitKioskPunch(ids.device, { personId: ids.hr, entityId: ids.media }, "face", now, session.id);
    expect((await db().select().from(schema.punch).where(eq(schema.punch.id, face.punchId!)))[0]).toMatchObject({ kioskSessionId: session.id, deviceUserId: `face:${ids.hr}` });
    // A phone's QR check-in names the kiosk whose code it scanned.
    const scanned = await commitKioskPunch(ids.device, { personId: ids.huy, entityId: ids.media }, "qr", now, session.id);
    expect((await db().select().from(schema.punch).where(eq(schema.punch.id, scanned.punchId!)))[0]).toMatchObject({ kioskSessionId: session.id });
    // Yesterday's does not count as today's.
    await db()
      .insert(schema.punch)
      .values({ personId: ids.huy, entityId: ids.media, at: new Date(now.getTime() - 2 * DAY), direction: "in", source: "device", deviceId: ids.device, deviceUserId: `face:${ids.huy}`, kioskSessionId: session.id });

    const [listed] = await listKioskDevices(hrAdmin, now);
    const byId = new Map(listed.sessions.map((row) => [row.id, row]));
    expect(byId.get(session.id)).toMatchObject({ punchesToday: 2, lapsed: false });
    expect(byId.get(other.session.id)).toMatchObject({ punchesToday: 0, lapsed: false });
    expect(byId.get(session.id)!.expiresAt.getTime()).toBe(session.openedAt.getTime() + KIOSK_IDLE_DAYS * DAY);
    // Past its lifetime and not yet closed by the night's job: HR sees it has expired.
    const later = await listKioskDevices(hrAdmin, new Date(now.getTime() + (KIOSK_IDLE_DAYS + 1) * DAY));
    expect(later[0].sessions.find((row) => row.id === session.id)).toMatchObject({ lapsed: true, punchesToday: 0 });
    // Somebody with no say over the clock's entity sees none of it.
    expect(await listKioskDevices({ personId: ids.lan, workforceType: "employee", grants: [] }, now)).toEqual([]);
    await closeKioskSession(session.id, ids.hr);
    await closeKioskSession(other.session.id, ids.hr);
  });
});

describe("the limiter of the kiosk's and the clocks' endpoints", () => {
  const at = new Date("2026-01-05T03:00:20Z");

  it("allows a session its minute's worth and refuses the next call, until the minute turns", async () => {
    const key = endpointKey("kiosk", "session-1");
    const { max } = ENDPOINT_LIMITS.kiosk_undo;
    for (let call = 0; call < max; call++) expect(await countEndpointHit("kiosk_undo", key, at)).toEqual({ ok: true });
    expect(await countEndpointHit("kiosk_undo", key, at)).toEqual({ ok: false, retryAfterSeconds: 40 });
    // Another session, another bucket and the next minute each have their own count.
    expect(await countEndpointHit("kiosk_undo", endpointKey("kiosk", "session-2"), at)).toEqual({ ok: true });
    expect(await countEndpointHit("kiosk_qr", key, at)).toEqual({ ok: true });
    expect(await countEndpointHit("kiosk_undo", key, new Date(at.getTime() + 40_000))).toEqual({ ok: true });
    // One row per (bucket, key, window), whatever the number of calls.
    expect(await db().select().from(schema.attendanceEndpointHit)).toHaveLength(4);
    expect(
      (
        await db()
          .select()
          .from(schema.attendanceEndpointHit)
          .where(eq(schema.attendanceEndpointHit.windowStart, new Date("2026-01-05T03:00:00Z")))
      ).find((row) => row.bucket === "kiosk_undo" && row.keyHash === key),
    ).toMatchObject({ hits: max + 1 });
  });

  it("keys a kiosk and a clock apart, and names neither", () => {
    expect(endpointKey("kiosk", "x")).not.toBe(endpointKey("device", "x"));
    expect(endpointKey("kiosk", "session-1")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("forgets counted windows at night, with the kiosk's other housekeeping", async () => {
    expect(await purgeEndpointHits(new Date("2026-01-05T03:01:00Z"))).toBe(3);
    expect(await db().select().from(schema.attendanceEndpointHit)).toHaveLength(1);
    // The job: leavers' faces, lapsed kiosks and old windows, each counted.
    await countEndpointHit("device_roster", endpointKey("device", ids.device), new Date(Date.now() - 3 * DAY));
    const result = await faceLeaversJob.run({ today: "2026-10-05" });
    expect(result).toMatchObject({ people: 0, kiosksLapsed: 0, endpointHits: 2 });
  });
});
