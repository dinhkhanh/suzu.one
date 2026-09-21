// Announcements, kudos and the home feed against a real Postgres (PGlite): the SQL audience in
// both directions agrees with the pure policy, scheduling, read tracking, the job's "once", and
// the feed's tier rules (no birth year, nothing about people for a collaborator).
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
import type { Grant, Principal } from "../platform/rbac/policy";
import { acknowledgeAnnouncement, type AnnouncementInput, audiencePeople, commsViewerOf, countUnreadAnnouncements, createAnnouncement, getAnnouncementView, getReadReport, listAnnouncementsFor, listManagedAnnouncements, loadAnnouncement, markAnnouncementRead, mayPostTo, mayRead, notifyDueAnnouncements, publishAnnouncement, setAnnouncementState } from "./announcements";
import { audienceKey } from "./enums";
import { getHomeFeed } from "./feed";
import { findKudos, giveKudos, listKudos, mayRemoveKudos, removeKudos } from "./kudos";

type Who = "owner" | "hrGroup" | "hrSzm" | "long" | "huy" | "linh" | "khoi" | "ngo" | "gone";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des" | "hcm" | "hn", string>;
const users = {} as Record<Who, { person: { id: string; fullName: string; primaryEntityId: string | null; orgUnitId: string | null; orgUnitPath: string[] }; principal: Principal }>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const TODAY = "2026-09-20";
const draft = (over: Partial<AnnouncementInput>): AnnouncementInput => ({ title: "Thông báo", body: "Nội dung", kbPageId: null, pinned: false, mustAcknowledge: false, expiresAt: null, audience: ["all"], ...over });

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design" }).returning();
  const [hcm] = await db().insert(schema.branch).values({ entityId: szm.id, name: "HCM" }).returning();
  const [hn] = await db().insert(schema.branch).values({ entityId: szm.id, name: "Hà Nội" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id, hcm: hcm.id, hn: hn.id });

  // key, entity, department, branch, role, scope, workforce type, status, date of birth, start date
  const people: [Who, string, string, string | null, Grant["role"] | null, "group" | "entity" | "department" | null, "employee" | "collaborator", "active" | "offboarded", string | null, string][] = [
    ["owner", szm.id, vid.id, hcm.id, "owner", "group", "employee", "active", "1980-01-05", "2019-01-01"],
    ["hrGroup", szm.id, vid.id, hcm.id, "hr_admin", "group", "employee", "active", null, "2020-09-23"],
    ["hrSzm", szm.id, vid.id, hcm.id, "hr_staff", "entity", "employee", "active", "1990-03-01", "2022-03-01"],
    ["long", szm.id, vid.id, hcm.id, "department_head", "department", "employee", "active", "1988-09-22", "2021-05-10"],
    ["huy", szm.id, vid.id, hn.id, null, null, "employee", "active", "1999-09-20", "2026-09-14"],
    ["linh", szm.id, vid.id, hn.id, null, null, "employee", "active", "1996-02-29", "2023-02-01"],
    ["khoi", szc.id, des.id, null, null, null, "employee", "active", "1997-12-30", "2024-07-01"],
    ["ngo", szm.id, vid.id, hcm.id, null, null, "collaborator", "active", "1995-09-21", "2026-09-15"],
    ["gone", szm.id, vid.id, hcm.id, null, null, "employee", "offboarded", "1991-09-21", "2020-01-01"],
  ];
  for (const [key, entityId, departmentId, branchId, role, scope, workforceType, status, dateOfBirth, startDate] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, primaryEntityId: entityId, orgUnitId: departmentId, workforceType, status }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : scope === "entity" ? { type: "entity", id: entityId } : { type: "unit", id: departmentId } }] : [];
    users[key] = { person: row, principal: { personId: row.id, workforceType, grants } };
    await db().insert(schema.personProfile).values({ personId: row.id, dateOfBirth });
    const [employment] = await db().insert(schema.employment).values({ personId: row.id, entityId, employeeCode: key, startDate, seniorityDate: startDate, endDate: status === "offboarded" ? "2026-01-31" : null }).returning();
    await db().insert(schema.assignment).values({ employmentId: employment.id, workforceType, branchId, orgUnitId: departmentId, departmentId, validFrom: startDate, validTo: status === "offboarded" ? "2026-01-31" : null });
  }
  await db().insert(schema.companyValue).values({ key: "teamwork", nameVi: "Đồng đội", nameEn: "Teamwork" });
});

const viewer = (who: Who) => commsViewerOf(users[who], TODAY);
const titlesFor = async (who: Who) => (await listAnnouncementsFor(await viewer(who))).map((card) => card.title).sort();

describe("announcements", () => {
  const made = {} as Record<"all" | "szm" | "vid" | "hn" | "ngo" | "later" | "draft" | "expired", string>;

  it("asks comms:manage over every target", async () => {
    const vid = audienceKey("unit", ids.vid);
    expect(await mayPostTo(users.long.principal, [vid])).toBe(true);
    expect(await mayPostTo(users.long.principal, ["all"])).toBe(false);
    expect(await mayPostTo(users.long.principal, [vid, audienceKey("unit", ids.des)])).toBe(false);
    expect(await mayPostTo(users.hrSzm.principal, [audienceKey("entity", ids.szm), audienceKey("branch", ids.hn)])).toBe(true);
    expect(await mayPostTo(users.hrSzm.principal, [audienceKey("entity", ids.szc)])).toBe(false);
    expect(await mayPostTo(users.hrSzm.principal, [audienceKey("person", ids.khoi)])).toBe(false);
    expect(await mayPostTo(users.hrGroup.principal, ["all", audienceKey("entity", ids.szc)])).toBe(true);
    // A key that parses but names nothing.
    expect(await mayPostTo(users.owner.principal, [audienceKey("entity", "00000000-0000-4000-8000-000000000000")])).toBe(false);
    expect(await mayPostTo(users.huy.principal, [vid])).toBe(false);
  });

  it("shows each reader the live announcements that name them — the SQL filter agrees with the pure policy", async () => {
    const create = async (key: keyof typeof made, author: Who, over: Partial<AnnouncementInput>, publishAt: Date | null | "no") => {
      const row = await createAnnouncement(draft({ title: key, ...over }), ids[author]);
      made[key] = row.id;
      if (publishAt !== "no") await publishAnnouncement(row.id, publishAt);
    };
    await create("all", "hrGroup", { pinned: true, mustAcknowledge: true }, null);
    await create("szm", "hrSzm", { audience: [audienceKey("entity", ids.szm)] }, null);
    await create("vid", "long", { audience: [audienceKey("unit", ids.vid)] }, null);
    await create("hn", "hrSzm", { audience: [audienceKey("branch", ids.hn)] }, null);
    await create("ngo", "hrGroup", { audience: [audienceKey("person", ids.ngo)] }, null);
    await create("later", "hrGroup", {}, new Date(Date.now() + 7 * 86_400_000));
    await create("draft", "hrGroup", {}, "no");
    await create("expired", "hrGroup", { expiresAt: new Date(Date.now() + 1500) }, null);
    await db().update(schema.announcement).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.announcement.id, made.expired));

    expect(await titlesFor("huy")).toEqual(["all", "hn", "szm", "vid"]);
    expect(await titlesFor("long")).toEqual(["all", "szm", "vid"]);
    expect(await titlesFor("khoi")).toEqual(["all"]);
    expect(await titlesFor("ngo")).toEqual(["ngo"]);
    expect((await listAnnouncementsFor(await viewer("huy")))[0].title).toBe("all");

    for (const who of ["huy", "long", "khoi", "ngo", "hrGroup"] as const) {
      const seen = new Set(await titlesFor(who));
      for (const [key, id] of Object.entries(made)) expect(mayRead(await viewer(who), (await loadAnnouncement(id))!), `${who} / ${key}`).toBe(seen.has(key));
    }
  });

  it("resolves an audience to active people, collaborators only by name", async () => {
    const names = async (keys: string[]) => (await audiencePeople(keys, db(), TODAY)).map((row) => row.fullName).sort();
    expect(await names(["all"])).toEqual(["hrGroup", "hrSzm", "huy", "khoi", "linh", "long", "owner"]);
    expect(await names([audienceKey("branch", ids.hn)])).toEqual(["huy", "linh"]);
    expect(await names([audienceKey("entity", ids.szc), audienceKey("person", ids.ngo)])).toEqual(["khoi", "ngo"]);
    expect(await names([audienceKey("person", ids.gone)])).toEqual([]);
  });

  it("opens a scheduled or draft announcement to its managers only", async () => {
    expect(await getAnnouncementView(await viewer("huy"), made.later)).toBeNull();
    expect(await getAnnouncementView(await viewer("huy"), made.draft)).toBeNull();
    expect(await getAnnouncementView(await viewer("khoi"), made.vid)).toBeNull();
    expect((await getAnnouncementView(await viewer("hrGroup"), made.later))?.phase).toBe("scheduled");
    expect((await getAnnouncementView(await viewer("long"), made.vid))?.canManage).toBe(true);
    // The entity's HR does not manage what the department head told his department.
    expect((await getAnnouncementView(await viewer("hrSzm"), made.vid))?.canManage).toBe(false);
    // A note to one person is managed by whoever holds comms:manage over that person.
    expect((await listManagedAnnouncements(users.long.principal)).map((row) => row.title).sort()).toEqual(["ngo", "vid"]);
    expect((await listManagedAnnouncements(users.hrSzm.principal)).map((row) => row.title).sort()).toEqual(["hn", "ngo", "szm"]);
  });

  it("told the audience at publication, and tells a scheduled one once when its hour has come", async () => {
    const told = async (id: string) => (await db().select().from(schema.notification).where(eq(schema.notification.link, `/announcements/${id}`))).length;
    // Everyone on staff but the author.
    expect(await told(made.all)).toBe(6);
    expect(await told(made.later)).toBe(0);
    expect(await notifyDueAnnouncements()).toEqual({ announcements: 0, notified: 0 });
    await db().update(schema.announcement).set({ publishAt: new Date(Date.now() - 60_000) }).where(eq(schema.announcement.id, made.later));
    expect(await notifyDueAnnouncements()).toEqual({ announcements: 1, notified: 6 });
    expect(await notifyDueAnnouncements()).toEqual({ announcements: 0, notified: 0 });
    expect(await told(made.later)).toBe(6);
  });

  it("tracks reads and acknowledgements, idempotently, for the audience only", async () => {
    const huy = await viewer("huy");
    expect(await countUnreadAnnouncements(huy)).toBe(5);
    expect(await markAnnouncementRead(huy, made.all)).toBe(true);
    expect(await markAnnouncementRead(huy, made.all)).toBe(false);
    expect(await markAnnouncementRead(await viewer("khoi"), made.vid)).toBe(false);
    expect(await countUnreadAnnouncements(huy)).toBe(4);
    expect((await acknowledgeAnnouncement(huy, made.all)).first).toBe(true);
    expect((await acknowledgeAnnouncement(huy, made.all)).first).toBe(false);
    // Acknowledging without having opened it also counts as read.
    expect((await acknowledgeAnnouncement(await viewer("linh"), made.all)).first).toBe(true);
    expect(await fails(acknowledgeAnnouncement(huy, made.szm))).toBe("comms_ack_not_asked");
    expect(await fails(acknowledgeAnnouncement(await viewer("khoi"), made.vid))).toBe("comms_announcement_not_found");

    const report = (await getReadReport(made.all))!;
    expect([report.total, report.read, report.acknowledged]).toEqual([7, 2, 2]);
    expect(report.byDepartment.find((row) => row.departmentName === "Video")).toEqual({ departmentName: "Video", total: 6, read: 2, acknowledged: 2 });
    const pending = await listAnnouncementsFor(await viewer("long"), { onlyPendingAck: true });
    expect(pending.map((card) => card.title)).toEqual(["all"]);
    expect(await listAnnouncementsFor(huy, { onlyPendingAck: true })).toEqual([]);
  });

  it("archives: gone for readers, unpinned", async () => {
    const { after } = await setAnnouncementState(made.all, { archive: true });
    expect([after.status, after.pinned]).toEqual(["archived", false]);
    expect(await titlesFor("khoi")).toEqual(["later"]);
    expect(await fails(publishAnnouncement(made.all, null))).toBe("comms_announcement_archived");
  });
});

describe("kudos", () => {
  it("thanks a colleague, tells them, and refuses oneself, leavers and collaborators", async () => {
    const from = (who: Who) => ({ personId: ids[who], fullName: who, principal: users[who].principal });
    const row = await giveKudos(from("huy"), { toPersonId: ids.long, valueKey: "teamwork", message: "Cảm ơn anh đã hỗ trợ dự án!" });
    expect((await db().select().from(schema.notification).where(eq(schema.notification.kind, "comms.kudos_received"))).map((notice) => notice.recipientPersonId)).toEqual([ids.long]);
    expect(await fails(giveKudos(from("huy"), { toPersonId: ids.huy, valueKey: "teamwork", message: "x" }))).toBe("comms_kudos_recipient");
    expect(await fails(giveKudos(from("huy"), { toPersonId: ids.gone, valueKey: "teamwork", message: "x" }))).toBe("comms_kudos_recipient");
    expect(await fails(giveKudos(from("huy"), { toPersonId: ids.ngo, valueKey: "teamwork", message: "x" }))).toBe("comms_kudos_recipient");
    expect(await fails(giveKudos(from("ngo"), { toPersonId: ids.long, valueKey: "teamwork", message: "x" }))).toBe("comms_kudos_recipient");
    expect(await fails(giveKudos(from("huy"), { toPersonId: ids.long, valueKey: "nope", message: "x" }))).toBe("comms_value_unknown");

    const found = (await findKudos(row.id))!;
    expect(mayRemoveKudos(users.huy.principal, found)).toBe(true);
    expect(mayRemoveKudos(users.long.principal, found)).toBe(true); // comms:manage over his own department
    expect(mayRemoveKudos(users.linh.principal, found)).toBe(false);
    expect((await listKudos({ toPersonId: ids.long })).map((card) => card.valueNameEn)).toEqual(["Teamwork"]);
    await giveKudos(from("linh"), { toPersonId: ids.khoi, valueKey: "teamwork", message: "Thiết kế rất đẹp" });
    await removeKudos(row.id, ids.huy);
    expect(await fails(removeKudos(row.id, ids.huy))).toBe("comms_kudos_not_found");
    expect((await listKudos()).map((card) => card.toName)).toEqual(["khoi"]);
  });
});

describe("home feed", () => {
  it("shows staff the week's occasions without any birth year", async () => {
    const feed = await getHomeFeed(users.khoi, TODAY);
    expect(feed.birthdays.map((row) => [row.fullName, row.month, row.day, row.inDays])).toEqual([
      ["huy", 9, 20, 0],
      ["long", 9, 22, 2],
    ]);
    // hrGroup: 6 years on 23 September. Collaborators and leavers are in nobody's feed.
    expect(feed.anniversaries.map((row) => [row.fullName, row.years, row.inDays])).toEqual([["hrGroup", 6, 3]]);
    expect(feed.joiners.map((row) => row.fullName)).toEqual(["huy"]);
    expect(feed.kudos.map((card) => card.toName)).toEqual(["khoi"]);
    // Ids are random hex: one of them spells "1990" every few runs, so they are taken out first.
    const text = JSON.stringify(feed).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
    for (const year of ["1980", "1988", "1990", "1995", "1996", "1997", "1999"]) expect(text).not.toContain(year);
    expect(text).not.toContain("dateOfBirth");
  });

  it("celebrates 29 February on the 28th, and sees over the new year", async () => {
    expect((await getHomeFeed(users.khoi, "2027-02-25")).birthdays.map((row) => [row.fullName, row.inDays])).toEqual([
      ["linh", 3],
      ["hrSzm", 4],
    ]);
    expect((await getHomeFeed(users.huy, "2026-12-29")).birthdays.map((row) => row.fullName)).toEqual(["khoi", "owner"]);
  });

  it("gives a collaborator announcements aimed at them and nothing about people", async () => {
    const feed = await getHomeFeed(users.ngo, TODAY);
    expect(feed.announcements.map((card) => card.title)).toEqual(["ngo"]);
    expect([feed.birthdays, feed.anniversaries, feed.joiners, feed.kudos]).toEqual([[], [], [], []]);
  });

  it("lists what waits for me", async () => {
    const feed = await getHomeFeed(users.long, TODAY);
    expect(feed.pending.approvals).toBe(0);
    expect(feed.pending.acks).toEqual([]);
  });
});
