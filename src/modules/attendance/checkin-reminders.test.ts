// The check-in reminder against a real database (PGlite): who is due five minutes after their day
// starts, who is not (checked in, suspended, a clock whose log arrives later, a day off), and that
// each person hears it once.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { findDueCheckIns, sendCheckInReminders } from "./checkin-reminders";
import type { DayRule, SchedulePattern } from "./engine/calendar";

// 2026-10-07 is a Wednesday; the office day starts at 08:30. The 10th is the untracked Saturday.
const DAY = "2026-10-07";
const vn = (time: string, date = DAY) => new Date(`${date}T${time}:00+07:00`);
const OFFICE_DAY: DayRule = { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const OFFICE: SchedulePattern = { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } };

const PEOPLE = ["an", "binh", "cuong", "dao", "em"] as const;
const ids = {} as Record<(typeof PEOPLE)[number], string>;
const dueIds = async (now: Date) => (await findDueCheckIns(now)).map((item) => item.personId).sort();
const noticesOf = async (personId: string) =>
  db()
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, "daily.checkin_reminder")));

beforeAll(async () => {
  await migrateTestDb();
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  await db().insert(schema.workSchedule).values({ name: "Office", kind: "fixed", pattern: OFFICE, isDefault: true });
  for (const key of PEOPLE) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, primaryEntityId: media.id, status: key === "dao" ? "suspended" : "active" })
      .returning();
    ids[key] = row.id;
  }
  // Binh checked in early; Cuong only yesterday.
  await db()
    .insert(schema.punch)
    .values([
      { personId: ids.binh, entityId: media.id, at: vn("08:12"), direction: "in", source: "app" },
      { personId: ids.cuong, entityId: media.id, at: vn("17:40", "2026-10-06"), direction: "out", source: "app" },
    ]);
  // Em punches on a clock whose log HR uploads later.
  const [profile] = await db()
    .insert(schema.deviceMappingProfile)
    .values({ name: "CSV", fileKind: "csv", mapping: { hasHeader: true, userId: 0, timestamp: 1, timestampFormat: "YYYY-MM-DD HH:mm" } as never })
    .returning();
  const [clock] = await db().insert(schema.attendanceDevice).values({ entityId: media.id, name: "Door", profileId: profile.id }).returning();
  await db().insert(schema.deviceUserMap).values({ deviceId: clock.id, deviceUserId: "7", personId: ids.em });
});

describe("check-in reminders", () => {
  it("waits until five minutes after the start", async () => {
    expect(await dueIds(vn("08:34"))).toEqual([]);
  });

  it("picks out the active people with no check-in since the morning", async () => {
    expect(await dueIds(vn("08:35"))).toEqual([ids.an, ids.cuong].sort());
  });

  it("tells each once, naming the start", async () => {
    expect(await sendCheckInReminders(vn("08:35"))).toEqual({ reminded: 2 });
    expect(await sendCheckInReminders(vn("08:40"))).toEqual({ reminded: 0 });
    expect(await dueIds(vn("08:40"))).toEqual([]);
    const [notice] = await noticesOf(ids.an);
    expect(notice).toMatchObject({ link: "/attendance/check-in", params: { time: "08:30" } });
    expect(await noticesOf(ids.binh)).toHaveLength(0);
  });

  it("stops after two hours, and asks nothing on the untracked Saturday", async () => {
    expect(await dueIds(vn("10:31", "2026-10-08"))).toEqual([]);
    expect(await dueIds(vn("08:35", "2026-10-08"))).toEqual([ids.an, ids.binh, ids.cuong].sort());
    expect(await dueIds(vn("08:35", "2026-10-10"))).toEqual([]);
  });
});
