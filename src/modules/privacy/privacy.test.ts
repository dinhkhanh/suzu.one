// The privacy tools against a real Postgres (PGlite): the GPS notice and its withdrawal, the face
// kiosk's withdrawals as the NAS roster reads them, the nightly retention sweeps, the list of former
// employees due for anonymisation and what anonymising one removes — and keeps — and "export my
// data" holding the person's own records and nobody else's.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/platform/files/storage", () => import("../../../tests/helpers/storage"));
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
import { storeIncomingFile } from "@/modules/platform/files/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { storedObjects } from "../../../tests/helpers/storage";
import { anonymiseFormerEmployee, listAnonymisationDue } from "./anonymise";
import { faceWithdrawnAmong, gpsConsentOf, gpsNoticeText, mayRecordPosition, recordConsentEvent, recordGpsAnswer } from "./consents";
import { GPS_NOTICE_VERSION } from "./engine/retention";
import { buildMyDataExport } from "./export";
import { clearPunchPositions, purgeAiConversations } from "./retention";

const ids = {} as Record<"media" | "creative" | "hr" | "huy" | "nhu" | "leaver" | "recent" | "stillHere" | "elsewhere", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode("-1.7\nscan of an ID card")]);
const TODAY = "2026-10-05";
let hrAdmin: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const person = async (name: string, entityId: string, status: "active" | "offboarded", workEmail: string | null = null) =>
    (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, status, workEmail }).returning())[0].id;
  Object.assign(ids, {
    media: media.id,
    creative: creative.id,
    hr: await person("Bảo HR", media.id, "active", "bao@suzu.vn"),
    huy: await person("Huy", media.id, "active", "huy@suzu.vn"),
    nhu: await person("Như", media.id, "active", "nhu@suzu.vn"),
    leaver: await person("Lan Đã Nghỉ", media.id, "offboarded", "lan@suzu.vn"),
    recent: await person("Minh Mới Nghỉ", media.id, "offboarded"),
    stillHere: await person("Tú Quay Lại", media.id, "offboarded"),
    elsewhere: await person("Khoa Creative", creative.id, "offboarded"),
  });
  let code = 0;
  const employment = (personId: string, entityId: string, startDate: string, endDate: string | null) => ({ personId, entityId, employeeCode: `E-${++code}`, startDate, seniorityDate: startDate, endDate });
  await db()
    .insert(schema.employment)
    .values([
      employment(ids.leaver, media.id, "2019-03-01", "2021-06-30"),
      employment(ids.leaver, media.id, "2021-09-01", "2022-06-30"),
      employment(ids.recent, media.id, "2020-01-01", "2025-01-31"),
      // An earlier spell long ago, and one that is still open: not a former employee.
      employment(ids.stillHere, media.id, "2015-01-01", "2016-01-31"),
      employment(ids.stillHere, media.id, "2024-01-01", null),
      employment(ids.elsewhere, creative.id, "2018-01-01", "2020-12-31"),
    ]);
  hrAdmin = principal(ids.hr, [{ role: "hr_admin", scope: { type: "entity", id: media.id } }]);
});

describe("the GPS notice", () => {
  it("is unanswered until answered, and the answer keeps the words that were shown", async () => {
    expect(await gpsConsentOf(ids.huy)).toMatchObject({ state: "unanswered", at: null });
    expect(await mayRecordPosition(ids.huy)).toBe(false);
    const given = await recordGpsAnswer(ids.huy, "given", "vi");
    expect(given).toMatchObject({ purpose: "gps_check_in", decision: "given", noticeVersion: GPS_NOTICE_VERSION, noticeLocale: "vi" });
    expect(given.noticeText).toBe(gpsNoticeText("vi"));
    expect(given.noticeText).toContain("90");
    expect(gpsNoticeText("en")).not.toBe(gpsNoticeText("vi"));
    expect(await mayRecordPosition(ids.huy)).toBe(true);
  });

  it("can be withdrawn as easily, and agreed to again", async () => {
    await recordConsentEvent({ personId: ids.huy, purpose: "gps_check_in", decision: "withdrawn" });
    expect(await gpsConsentOf(ids.huy)).toMatchObject({ state: "withdrawn" });
    expect(await mayRecordPosition(ids.huy)).toBe(false);
    await recordGpsAnswer(ids.huy, "given", "en");
    expect(await mayRecordPosition(ids.huy)).toBe(true);
    // Every answer stays on record.
    expect(await db().select().from(schema.privacyConsentEvent).where(eq(schema.privacyConsentEvent.personId, ids.huy))).toHaveLength(3);
  });

  it("asks again when the notice's version changes, and a decline is an answer", async () => {
    await db().insert(schema.privacyConsentEvent).values({ personId: ids.nhu, purpose: "gps_check_in", decision: "given", noticeVersion: "gps-2020-01", noticeLocale: "vi", noticeText: "older words" });
    expect(await gpsConsentOf(ids.nhu)).toMatchObject({ state: "unanswered" });
    await recordGpsAnswer(ids.nhu, "declined", "vi");
    expect(await gpsConsentOf(ids.nhu)).toMatchObject({ state: "declined" });
    expect(await mayRecordPosition(ids.nhu)).toBe(false);
  });
});

describe("face withdrawals, as the NAS roster reads them", () => {
  it("names who withdrew and was not enrolled again since", async () => {
    await db().insert(schema.privacyConsentEvent).values({ personId: ids.huy, purpose: "face_check_in", decision: "withdrawn", at: new Date("2026-09-01T00:00:00Z") });
    await db().insert(schema.privacyConsentEvent).values({ personId: ids.nhu, purpose: "face_check_in", decision: "withdrawn", at: new Date("2026-09-01T00:00:00Z") });
    // Như signed a new form afterwards: HR enrolled her again.
    await db().insert(schema.faceEnrolment).values({ personId: ids.nhu, entityId: ids.media, consentAt: new Date("2026-09-15T00:00:00Z"), consentRecordedByPersonId: ids.hr });
    expect([...(await faceWithdrawnAmong([ids.huy, ids.nhu, ids.hr]))]).toEqual([ids.huy]);
    expect(await faceWithdrawnAmong([])).toEqual(new Set());
  });
});

describe("the nightly retention sweeps", () => {
  it("clears the position of old app check-ins only — not one waiting for review, not a correction's, not a recent one", async () => {
    const old = new Date("2026-05-01T01:00:00Z");
    const recent = new Date("2026-10-01T01:00:00Z");
    const where = { latitude: 10.78, longitude: 106.7, accuracyM: 12, ipAddress: "203.0.113.9", userAgent: "Mobile Safari", deviceInfo: { platform: "iPhone" } };
    const rows = await db()
      .insert(schema.punch)
      .values([
        { personId: ids.huy, entityId: ids.media, at: old, direction: "in", source: "app", ...where },
        { personId: ids.huy, entityId: ids.media, at: new Date("2026-05-02T01:00:00Z"), direction: "in", source: "app", reviewStatus: "pending", ...where },
        { personId: ids.huy, entityId: ids.media, at: new Date("2026-05-03T01:00:00Z"), direction: "in", source: "request", deviceInfo: { requestId: "r-1" } },
        { personId: ids.huy, entityId: ids.media, at: recent, direction: "in", source: "app", ...where },
      ])
      .returning();
    expect(await clearPunchPositions(new Date("2026-07-07T00:00:00Z"))).toBe(1);
    const after = new Map((await db().select().from(schema.punch).where(eq(schema.punch.personId, ids.huy))).map((row) => [row.id, row]));
    expect(after.get(rows[0].id)).toMatchObject({ latitude: null, longitude: null, accuracyM: null, ipAddress: null, userAgent: null, deviceInfo: null, at: old, direction: "in" });
    expect(after.get(rows[1].id)).toMatchObject({ latitude: 10.78, ipAddress: "203.0.113.9" });
    expect(after.get(rows[2].id)?.deviceInfo).toEqual({ requestId: "r-1" });
    expect(after.get(rows[3].id)).toMatchObject({ latitude: 10.78 });
    // Nothing left to do the second time.
    expect(await clearPunchPositions(new Date("2026-07-07T00:00:00Z"))).toBe(0);
  });

  it("deletes assistant conversations and logged questions past their window, messages with them", async () => {
    const [stale, fresh] = await db()
      .insert(schema.aiConversation)
      .values([
        { personId: ids.huy, title: "Nghỉ phép năm", updatedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") },
        { personId: ids.huy, title: "Lương tháng 9", updatedAt: new Date("2026-10-01T00:00:00Z") },
      ])
      .returning();
    await db().insert(schema.aiMessage).values([{ conversationId: stale.id, personId: ids.huy, role: "user", body: "Tôi còn mấy ngày phép?" }, { conversationId: fresh.id, personId: ids.huy, role: "user", body: "Lương tháng 9?" }]);
    await db().insert(schema.aiUnansweredQuestion).values([{ personId: ids.huy, question: "cũ", createdAt: new Date("2026-01-01T00:00:00Z") }, { personId: ids.huy, question: "mới" }]);
    expect(await purgeAiConversations(new Date("2026-04-08T00:00:00Z"))).toEqual({ conversations: 1, unansweredQuestions: 1 });
    expect((await db().select().from(schema.aiMessage)).map((row) => row.conversationId)).toEqual([fresh.id]);
    expect(await purgeAiConversations(new Date("2026-04-08T00:00:00Z"))).toEqual({ conversations: 0, unansweredQuestions: 0 });
  });
});

describe("former employees", () => {
  it("lists those past the retention period in the viewer's reach — not a recent leaver, not one with an open employment", async () => {
    const due = await listAnonymisationDue(hrAdmin, TODAY);
    expect(due.map((row) => row.fullName)).toEqual(["Lan Đã Nghỉ"]);
    expect(due[0]).toMatchObject({ lastDay: "2022-06-30", dueOn: "2025-07-01", employeeCode: "E-2", entity: "Media" });
    const owner = principal(ids.hr, [{ role: "owner", scope: { type: "group" } }]);
    expect((await listAnonymisationDue(owner, TODAY)).map((row) => row.fullName)).toEqual(["Khoa Creative", "Lan Đã Nghỉ"]);
    expect(await listAnonymisationDue(principal(ids.hr), TODAY)).toEqual([]);
  });

  it("refuses anyone not due, and the person themselves", async () => {
    const error = (promise: Promise<unknown>) => promise.then(() => "no error", (failure: Error) => failure.message);
    expect(await error(anonymiseFormerEmployee(ids.recent, ids.hr, TODAY))).toBe("retention_not_over");
    expect(await error(anonymiseFormerEmployee(ids.stillHere, ids.hr, TODAY))).toBe("not_former_employee");
    expect(await error(anonymiseFormerEmployee(ids.huy, ids.hr, TODAY))).toBe("not_former_employee");
    expect(await error(anonymiseFormerEmployee(ids.hr, ids.hr, TODAY))).toBe("anonymise_self");
  });

  it("removes the personal details and keeps what the law requires", async () => {
    const id = ids.leaver;
    await db().insert(schema.personProfile).values({ personId: id, phone: "0912345678", personalEmail: "lan@gmail.com", currentAddress: "12 Lê Lợi", permanentAddress: "Huế", dateOfBirth: "1995-04-02", maritalStatus: "single" });
    await db().insert(schema.emergencyContact).values({ personId: id, fullName: "Mẹ của Lan", phone: "0987654321" });
    const scan = await storeIncomingFile({ ownerType: "person_document", ownerId: id, entityId: ids.media, tier: "restricted" }, { fileName: "cccd.pdf", bytes: pdf });
    const signed = await storeIncomingFile({ ownerType: "person_document", ownerId: id, entityId: ids.media, tier: "compensation" }, { fileName: "hop-dong.pdf", bytes: pdf });
    await db().insert(schema.personDocument).values([
      { personId: id, entityId: ids.media, category: "id_scan", title: "CCCD", tier: "restricted", fileId: scan.id },
      { personId: id, entityId: ids.media, category: "contract", title: "HĐLĐ", tier: "compensation", fileId: signed.id },
    ]);
    await db().insert(schema.notification).values({ recipientPersonId: id, kind: "system.welcome" });
    await db().insert(schema.punch).values({ personId: id, entityId: ids.media, at: new Date("2022-06-30T01:00:00Z"), direction: "in", source: "app", latitude: 10.7, longitude: 106.6, ipAddress: "198.51.100.4" });
    await db().insert(schema.user).values({ id: "user-lan", name: "Lan", email: "Lan@suzu.vn" });
    await db().insert(schema.session).values({ id: "session-lan", token: "token-lan", userId: "user-lan", expiresAt: new Date("2030-01-01T00:00:00Z") });
    await db().insert(schema.privacyConsentEvent).values({ personId: id, purpose: "gps_check_in", decision: "given", noticeVersion: GPS_NOTICE_VERSION });

    const result = await anonymiseFormerEmployee(id, ids.hr, TODAY);
    expect(result.lastDay).toBe("2022-06-30");
    expect(result.removed).toMatchObject({ emergencyContacts: 1, documents: 1, notifications: 1, punchPositions: 1, accounts: 1 });

    const [person] = await db().select().from(schema.person).where(eq(schema.person.id, id));
    expect(person).toMatchObject({ fullName: "Lan Đã Nghỉ", workEmail: null, status: "offboarded" });
    const [profile] = await db().select().from(schema.personProfile).where(eq(schema.personProfile.personId, id));
    expect(profile).toMatchObject({ phone: null, personalEmail: null, currentAddress: null, maritalStatus: null, permanentAddress: "Huế", dateOfBirth: "1995-04-02" });
    expect(await db().select().from(schema.emergencyContact).where(eq(schema.emergencyContact.personId, id))).toEqual([]);
    expect(await db().select().from(schema.user).where(eq(schema.user.id, "user-lan"))).toEqual([]);
    expect(await db().select().from(schema.session).where(eq(schema.session.id, "session-lan"))).toEqual([]);
    expect(await db().select().from(schema.notification).where(eq(schema.notification.recipientPersonId, id))).toEqual([]);
    const [punch] = await db().select().from(schema.punch).where(eq(schema.punch.personId, id));
    expect(punch).toMatchObject({ latitude: null, ipAddress: null, direction: "in" });
    // The scan is gone from storage; the signed contract and the employment periods stay.
    const files = new Map((await db().select().from(schema.storedFile)).map((row) => [row.id, row]));
    expect(files.get(scan.id)?.purgedAt).not.toBeNull();
    expect(storedObjects.has(files.get(scan.id)!.objectPath)).toBe(false);
    expect(files.get(signed.id)?.purgedAt).toBeNull();
    expect(storedObjects.has(files.get(signed.id)!.objectPath)).toBe(true);
    expect(await db().select().from(schema.employment).where(eq(schema.employment.personId, id))).toHaveLength(2);
    expect(await db().select().from(schema.privacyConsentEvent).where(eq(schema.privacyConsentEvent.personId, id))).toHaveLength(1);

    // Off the list, and once only.
    expect(await listAnonymisationDue(hrAdmin, TODAY)).toEqual([]);
    await expect(anonymiseFormerEmployee(id, ids.hr, TODAY)).rejects.toThrow("already_anonymised");
  });
});

describe("export my data", () => {
  it("holds the person's own records, positions and answers included, and nobody else's", async () => {
    await db().insert(schema.notification).values([{ recipientPersonId: ids.huy, kind: "system.welcome" }, { recipientPersonId: ids.nhu, kind: "system.welcome" }]);
    await db().insert(schema.personProfile).values({ personId: ids.huy, phone: "0901111222" });
    const file = await buildMyDataExport({ personId: ids.huy, principal: principal(ids.huy) }, new Date("2026-10-05T03:00:00Z"));
    const data = JSON.parse(file.json);
    expect(file.fileName).toBe("suzu-one-my-data-2026-10-05.json");
    expect(data).toMatchObject({ format: "suzu-one/my-data@1", person: { fullName: "Huy", workEmail: "huy@suzu.vn", entity: "SuZu Media" }, profile: { phone: "0901111222" }, payslips: [], contracts: [] });
    expect(data.notifications).toHaveLength(1);
    expect(data.attendance.punches.length).toBe(4);
    expect(data.attendance.punches.some((punch: { latitude: number | null }) => punch.latitude === 10.78)).toBe(true);
    expect(data.privacy.consents.map((row: { purpose: string; decision: string }) => `${row.purpose}:${row.decision}`)).toEqual(expect.arrayContaining(["gps_check_in:given", "gps_check_in:withdrawn", "face_check_in:withdrawn"]));
    expect(data.assistant.map((row: { title: string }) => row.title)).toEqual(["Lương tháng 9"]);
    expect(file.counts).toMatchObject({ notifications: 1, punches: 4, conversations: 1 });
    expect(file.json).not.toContain("Như");
  });
});
