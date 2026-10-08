// Check-in, review and "who's in" against a real Postgres (PGlite).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const resolveNetworkNames = vi.hoisted(() => vi.fn(async (names: readonly string[]) => new Map(names.map((name): [string, string[]] => [name, name === "wan1.office.example.com" ? ["192.0.2.44"] : []]))));
vi.mock("./network-names", () => ({ resolveNetworkNames }));
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
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { SchedulePattern } from "./engine/calendar";
import { saveLocation } from "./locations";
import { countPunchesToReview, getCheckInState, getWhoIsIn, listFlaggedPunches, listPunches, recordAppPunch, remindPunchReviews, reviewPunch } from "./punches";
import { saveSchedule } from "./schedules";

const OFFICE = { latitude: 10.771595, longitude: 106.704758 };
const north = (metres: number, accuracyM = 10) => ({ latitude: OFFICE.latitude + metres / 111_195, longitude: OFFICE.longitude, accuracyM });
const WEEK: SchedulePattern = {
  days: {
    1: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 },
    2: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 },
    3: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 },
    4: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 },
    5: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 },
    6: { type: "untracked", creditMinutes: 480 },
    7: { type: "off" },
  },
};

// Wednesday 2026-09-16, Vietnam time.
const at = (time: string, date = "2026-09-16") => new Date(`${date}T${time}:00+07:00`);
const ids = {} as Record<"media" | "creative" | "video" | "lead" | "huy" | "nhu" | "lan" | "hr" | "hoa" | "office", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const me = (key: keyof typeof ids) => ({ id: ids[key], primaryEntityId: key === "lan" ? ids.creative : ids.media, status: "active" });
const punchInput = (key: keyof typeof ids, direction: "in" | "out", position: ReturnType<typeof north> | null, ipAddress: string | null = "198.51.100.7") => ({
  person: me(key),
  direction,
  position,
  ipAddress,
  userAgent: "vitest",
  deviceInfo: { standalone: true },
  note: null,
});

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const person = async (name: string, entityId: string, managerId: string | null = null) =>
    (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, orgUnitId: video.id, managerId, status: "active" }).returning())[0].id;
  const lead = await person("Long", media.id);
  Object.assign(ids, {
    media: media.id,
    creative: creative.id,
    video: video.id,
    lead,
    huy: await person("Huy", media.id, lead),
    nhu: await person("Nhu", media.id, lead),
    lan: await person("Lan", creative.id),
    hr: await person("Bao", media.id),
  });
  await saveSchedule({ id: null, entityId: null, name: "Office", kind: "fixed", pattern: WEEK, isDefault: true, isActive: true });
});

describe("work locations", () => {
  it("refuses a location that tests nothing, and a malformed network", async () => {
    const base = { id: null, entityId: ids.media, name: "HQ", address: null, accuracyLimitM: 100, isActive: true, mode: "flag" as const };
    await expect(saveLocation({ ...base, latitude: null, longitude: null, radiusM: null, ipAllowlist: [], rule: "gps_or_ip" })).rejects.toThrow("location_needs_rule");
    await expect(saveLocation({ ...base, ...OFFICE, radiusM: 150, ipAllowlist: ["203.0.113.0/40"], rule: "gps_or_ip" })).rejects.toThrow("location_ip_invalid");
    const { after } = await saveLocation({ ...base, ...OFFICE, radiusM: 150, ipAllowlist: ["203.0.113.0/24", " 203.0.113.0/24 "], rule: "gps_or_ip" });
    expect(after.ipAllowlist).toEqual(["203.0.113.0/24"]);
    ids.office = after.id;
    await expect(saveLocation({ ...base, id: after.id, entityId: ids.creative, ...OFFICE, radiusM: 150, ipAllowlist: [], rule: "gps" })).rejects.toThrow("location_entity_fixed");
  });
});

describe("check-in", () => {
  it("accepts a punch inside the fence and offers check-out next", async () => {
    const result = await recordAppPunch(punchInput("huy", "in", north(40)), at("08:25"));
    expect(result).toMatchObject({ outcome: "accepted", flags: [], locationName: "HQ", duplicate: false });
    expect(result.punch).toMatchObject({ source: "app", reviewStatus: "none", distanceM: 40, locationId: ids.office, accuracyM: 10 });
    expect(result.punch.at).toEqual(at("08:25"));
    const state = await getCheckInState(me("huy"), at("08:30"));
    expect(state).toMatchObject({ today: "2026-09-16", nextDirection: "out", hasLocations: true });
    expect(state.plan?.kind).toBe("working");
    expect(state.punches).toHaveLength(1);
  });

  it("treats a second tap as the same punch and refuses a second check-in later", async () => {
    const repeat = await recordAppPunch(punchInput("huy", "in", north(40)), at("08:26"));
    expect(repeat.duplicate).toBe(true);
    await expect(recordAppPunch(punchInput("huy", "in", north(40)), at("09:30"))).rejects.toThrow("punch_already_in");
    expect(await listPunches([ids.huy], "2026-09-16", "2026-09-16")).toHaveLength(1);
  });

  it("accepts but flags a punch outside the fence, without a position, and notes the office network", async () => {
    const outside = await recordAppPunch(punchInput("nhu", "in", north(900)), at("08:40"));
    expect(outside).toMatchObject({ outcome: "flagged", flags: ["outside_geofence", "ip_not_allowed"], locationName: null });
    expect(outside.punch).toMatchObject({ reviewStatus: "pending", distanceM: 900, locationId: null });
    const noPosition = await recordAppPunch(punchInput("nhu", "out", null), at("12:00"));
    expect(noPosition.flags).toEqual(["no_position", "ip_not_allowed"]);
    const onOfficeNetwork = await recordAppPunch(punchInput("nhu", "in", null, "203.0.113.20"), at("13:00"));
    expect(onOfficeNetwork).toMatchObject({ outcome: "accepted", flags: [], locationName: "HQ" });
  });

  it("refuses when the only location blocks, and accepts anything where no location exists", async () => {
    await db().update(schema.workLocation).set({ mode: "block" });
    await expect(recordAppPunch(punchInput("lead", "in", north(5000)), at("08:00"))).rejects.toThrow("punch_blocked");
    expect(await listPunches([ids.lead], "2026-09-16", "2026-09-16")).toHaveLength(0);
    await db().update(schema.workLocation).set({ mode: "flag" });
    expect(await recordAppPunch(punchInput("lan", "in", null, null), at("09:00"))).toMatchObject({ outcome: "accepted", flags: [] });
    expect((await getCheckInState(me("lan"), at("09:01"))).hasLocations).toBe(false);
  });

  it("refuses people who are not employed", async () => {
    await expect(recordAppPunch({ ...punchInput("huy", "out", null), person: { ...me("huy"), status: "offboarded" } }, at("10:00"))).rejects.toThrow("punch_not_employed");
  });

  it("keeps an overnight check-in open past midnight", async () => {
    await recordAppPunch(punchInput("lead", "in", north(10)), at("22:00", "2026-09-14"));
    expect((await getCheckInState(me("lead"), at("05:50", "2026-09-15"))).nextDirection).toBe("out");
    await recordAppPunch(punchInput("lead", "out", north(10)), at("06:00", "2026-09-15"));
    expect((await getCheckInState(me("lead"), at("06:01", "2026-09-15"))).nextDirection).toBe("in");
  });
});

describe("review of flagged punches", () => {
  const now = { now: at("18:00") };
  const hrBao = () => ({ personId: ids.hr, principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]) });

  it("shows them to the line manager and the entity's HR only", async () => {
    expect((await listFlaggedPunches({ personId: ids.lead, principal: principal(ids.lead) }, now)).map((row) => row.personName)).toEqual(["Nhu", "Nhu"]);
    expect(await countPunchesToReview(hrBao(), now)).toBe(2);
    expect(await listFlaggedPunches({ personId: ids.huy, principal: principal(ids.huy) }, now)).toEqual([]);
    // Her own flags are not hers to review.
    expect(await listFlaggedPunches({ personId: ids.nhu, principal: principal(ids.nhu) }, now)).toEqual([]);
    expect(await listFlaggedPunches({ personId: ids.lan, principal: principal(ids.lan, [{ role: "hr_staff", scope: { type: "entity", id: ids.creative } }]) }, now)).toEqual([]);
  });

  it("accepts, rejects with a reason, and a rejected punch stops counting", async () => {
    const [noPosition, outside] = await listFlaggedPunches({ personId: ids.lead, principal: principal(ids.lead) }, now);
    await expect(reviewPunch(outside.id, ids.nhu, { decision: "accept", note: null })).rejects.toThrow("punch_own");
    await expect(reviewPunch(noPosition.id, ids.lead, { decision: "reject", note: " " })).rejects.toThrow("punch_review_note_required");
    expect((await reviewPunch(outside.id, ids.lead, { decision: "accept", note: null })).after).toMatchObject({ reviewStatus: "accepted", reviewedByPersonId: ids.lead });
    await expect(reviewPunch(outside.id, ids.lead, { decision: "reject", note: "again" })).rejects.toThrow("punch_not_pending");
    await reviewPunch(noPosition.id, ids.lead, { decision: "reject", note: "Was not at the office" });
    expect((await listPunches([ids.nhu], "2026-09-16", "2026-09-16")).map((row) => row.direction)).toEqual(["in", "in"]);
    expect(await countPunchesToReview(hrBao(), now)).toBe(0);
    // Nhu hears why, once: the accepted one says nothing (ATT-01).
    const notices = await db()
      .select()
      .from(schema.notification)
      .where(and(eq(schema.notification.recipientPersonId, ids.nhu), eq(schema.notification.kind, "attendance.punch_rejected")));
    expect(notices.map((row) => row.params)).toEqual([{ time: "12:00 16/09/2026", reason: "Was not at the office" }]);
    expect(notices[0].link).toBe("/attendance?month=2026-09");
  });

  it("keeps a check-in that still waits in front of its reviewer until last month's lock", async () => {
    // Waiting since the 1st of September; on 5 October that is more than 31 days, but September is not locked yet.
    const [early] = await db()
      .insert(schema.punch)
      .values({ personId: ids.huy, entityId: ids.media, at: at("09:00", "2026-09-01"), direction: "in", source: "app", flags: ["no_position"], reviewStatus: "pending" })
      .returning();
    expect((await listFlaggedPunches({ personId: ids.lead, principal: principal(ids.lead) }, { now: at("09:00", "2026-10-05") })).map((row) => row.id)).toContain(early.id);
    expect(await countPunchesToReview({ personId: ids.lead, principal: principal(ids.lead) }, { now: at("09:00", "2026-10-05") })).toBe(1);
    // In November it belongs to a month whose lock has come: no longer anybody's to-do.
    expect(await countPunchesToReview({ personId: ids.lead, principal: principal(ids.lead) }, { now: at("09:00", "2026-11-05") })).toBe(0);
    await reviewPunch(early.id, ids.lead, { decision: "accept", note: null });
  });
});

describe("who's in today", () => {
  it("gives colleagues a status and nothing else; the manager sees times", async () => {
    const asColleague = await getWhoIsIn({ personId: ids.huy, principal: principal(ids.huy) }, {}, at("14:00"));
    expect(asColleague.rows.map((row) => row.fullName)).toEqual(["Huy", "Bao", "Long", "Nhu"]);
    const nhu = asColleague.rows.find((row) => row.fullName === "Nhu")!;
    expect(nhu).toMatchObject({ status: "in", firstInAt: null, lastOutAt: null, flagged: null });
    expect(asColleague.rows.find((row) => row.isSelf)).toMatchObject({ status: "in", firstInAt: at("08:25") });
    expect(asColleague.rows.find((row) => row.fullName === "Bao")?.status).toBe("not_yet");
    expect(asColleague.counts).toMatchObject({ in: 2, not_yet: 2 });

    const asManager = await getWhoIsIn({ personId: ids.lead, principal: principal(ids.lead) }, {}, at("14:00"));
    expect(asManager.rows.find((row) => row.fullName === "Nhu")).toMatchObject({ status: "in", firstInAt: at("08:40"), flagged: false });
  });

  it("scopes HR to their entity and shows the untracked Saturday and the rest day", async () => {
    const asCreativeHr = await getWhoIsIn({ personId: ids.lan, principal: principal(ids.lan, [{ role: "hr_staff", scope: { type: "entity", id: ids.creative } }]) }, {}, at("10:00"));
    expect(asCreativeHr.rows.map((row) => row.fullName)).toEqual(["Lan"]);
    expect((await getWhoIsIn({ personId: ids.huy, principal: principal(ids.huy) }, {}, at("10:00", "2026-09-19"))).rows[0].status).toBe("untracked");
    expect((await getWhoIsIn({ personId: ids.huy, principal: principal(ids.huy) }, {}, at("10:00", "2026-09-20"))).rows[0].status).toBe("rest");
  });

  it("shows nobody but themselves to a collaborator", async () => {
    const view = await getWhoIsIn({ personId: ids.huy, principal: { ...principal(ids.huy), workforceType: "collaborator" } }, {}, at("14:00"));
    expect(view.rows.map((row) => row.fullName)).toEqual(["Huy"]);
  });
});

describe("an office on a dynamic address", () => {
  it("is recognised by the DNS name its router publishes", async () => {
    // Every check-in above met addresses only: none of them asked the DNS.
    expect(resolveNetworkNames).not.toHaveBeenCalled();
    const [entity] = await db().insert(schema.entity).values({ code: "SZD", legalName: "SuZu Dynamic", shortName: "Dynamic" }).returning();
    const [person] = await db().insert(schema.person).values({ fullName: "Mai", searchName: "mai", primaryEntityId: entity.id, orgUnitId: ids.video, status: "active" }).returning();
    const { after } = await saveLocation({
      id: null,
      entityId: entity.id,
      name: "Dynamic HQ",
      address: null,
      latitude: null,
      longitude: null,
      radiusM: null,
      accuracyLimitM: 100,
      ipAllowlist: [" WAN1.office.example.com. ", "wan2.office.example.com"],
      rule: "ip",
      mode: "block",
      isActive: true,
    });
    expect(after.ipAllowlist).toEqual(["wan1.office.example.com", "wan2.office.example.com"]);
    const input = (direction: "in" | "out", ipAddress: string) => ({ person: { id: person.id, primaryEntityId: entity.id, status: "active" }, direction, position: null, ipAddress, userAgent: "vitest", deviceInfo: null, note: null });

    await expect(recordAppPunch(input("in", "198.51.100.7"), at("08:00"))).rejects.toThrow("punch_blocked");
    expect(await recordAppPunch(input("in", "192.0.2.44"), at("08:05"))).toMatchObject({ outcome: "accepted", flags: [], locationName: "Dynamic HQ" });
    expect(resolveNetworkNames).toHaveBeenLastCalledWith(["wan1.office.example.com", "wan2.office.example.com"]);
  });
});

describe("telling the reviewers (ATT-01)", () => {
  const noticesOf = async (personId: string, kind: string) =>
    (
      await db()
        .select()
        .from(schema.notification)
        .where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)))
    ).map((row) => row.params);

  it("tells each reviewer once a morning how many of yesterday's check-ins wait: the line manager, or HR without one", async () => {
    const [hoa] = await db().insert(schema.person).values({ fullName: "Hoa", searchName: "hoa", primaryEntityId: ids.media, orgUnitId: ids.video, status: "active" }).returning();
    ids.hoa = hoa.id;
    await db().insert(schema.roleAssignment).values({ personId: hoa.id, role: "hr_staff", scopeType: "entity", scopeId: ids.media });
    const flagged = (personId: string, time: string, date: string) => ({
      personId,
      entityId: ids.media,
      at: at(time, date),
      direction: "in" as const,
      source: "app" as const,
      flags: ["outside_geofence" as const],
      reviewStatus: "pending" as const,
    });
    // Two of Huy's (his manager is Long), one of Bao's (no manager: HR), one of Huy's from the day before.
    await db()
      .insert(schema.punch)
      .values([flagged(ids.huy, "08:10", "2026-09-22"), flagged(ids.huy, "17:40", "2026-09-22"), flagged(ids.hr, "08:20", "2026-09-22"), flagged(ids.huy, "08:00", "2026-09-21")]);

    expect(await remindPunchReviews("2026-09-23")).toEqual({ reviewers: 2 });
    expect(await noticesOf(ids.lead, "attendance.punches_to_review")).toEqual([{ count: 2 }]);
    expect(await noticesOf(hoa.id, "attendance.punches_to_review")).toEqual([{ count: 1 }]);
    // Nobody is told about their own flags, and a second trigger the same morning says nothing more.
    expect(await noticesOf(ids.huy, "attendance.punches_to_review")).toEqual([]);
    expect(await remindPunchReviews("2026-09-23")).toEqual({ reviewers: 0 });
  });

  it("on the 1st tells them about the whole month, whose lock the flags block", async () => {
    expect(await remindPunchReviews("2026-10-01")).toEqual({ reviewers: 2 });
    expect(await noticesOf(ids.lead, "attendance.punches_block_lock")).toEqual([{ count: 3, month: "2026-09" }]);
    expect(await noticesOf(ids.hoa, "attendance.punches_block_lock")).toEqual([{ count: 1, month: "2026-09" }]);
  });
});
