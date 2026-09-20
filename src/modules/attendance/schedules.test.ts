// Calendar, schedules, assignments and the roster against a real database (PGlite), ending in
// `getDayPlans` — the question the leave module and the timesheet engine ask.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { DayRule, SchedulePattern } from "./engine/calendar";
import { assignSchedule, confirmCalendarDay, getDayPlans, listAssignments, listCalendarDays, removeAssignment, saveCalendarDay, saveSchedule, saveShift, setRoster } from "./schedules";

const OFFICE_DAY: DayRule = { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const OFF: DayRule = { type: "off" };
const OFFICE: SchedulePattern = { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: OFF } };
const ALL_OFF: SchedulePattern = { days: { 1: OFF, 2: OFF, 3: OFF, 4: OFF, 5: OFF, 6: OFF, 7: OFF } };
const SIX_DAYS: SchedulePattern = { days: { ...OFFICE.days, 6: OFFICE_DAY } };

const ids = {} as Record<"media" | "creative" | "video" | "huy" | "tam" | "lan" | "office" | "crew" | "sixDays" | "night", string>;
const kinds = async (personId: string, from: string, to: string) => (await getDayPlans([personId], from, to)).get(personId)!.days.map((day) => day.kind);

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const person = async (name: string, entityId: string, departmentId: string | null) => (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, departmentId }).returning())[0].id;
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, huy: await person("Huy", media.id, video.id), tam: await person("Tam", media.id, video.id), lan: await person("Lan", creative.id, null) });
});

describe("schedules and day plans", () => {
  it("has nothing to plan until a default schedule exists", async () => {
    expect(await kinds(ids.huy, "2026-08-03", "2026-08-03")).toEqual(["unscheduled"]);
    const { after } = await saveSchedule({ id: null, entityId: null, name: "Office", kind: "fixed", pattern: OFFICE, isDefault: true, isActive: true });
    ids.office = after.id;
    // Monday … Sunday: five office days, the untracked Saturday (FR-ATT-17), a rest day.
    expect(await kinds(ids.huy, "2026-08-03", "2026-08-09")).toEqual(["working", "working", "working", "working", "working", "untracked", "rest"]);
  });

  it("refuses a broken pattern, an entity's default, and keeps a single default", async () => {
    await expect(saveSchedule({ id: null, entityId: null, name: "Bad", kind: "fixed", pattern: ALL_OFF, isDefault: false, isActive: true })).rejects.toThrow("pattern_no_working_day");
    await expect(saveSchedule({ id: null, entityId: ids.media, name: "Media default", kind: "fixed", pattern: OFFICE, isDefault: true, isActive: true })).rejects.toThrow("schedule_default_group_only");
    const { after } = await saveSchedule({ id: null, entityId: null, name: "Six days", kind: "fixed", pattern: SIX_DAYS, isDefault: true, isActive: true });
    ids.sixDays = after.id;
    expect((await db().select().from(schema.workSchedule)).filter((row) => row.isDefault).map((row) => row.id)).toEqual([after.id]);
    await saveSchedule({ id: ids.office, entityId: null, name: "Office", kind: "fixed", pattern: OFFICE, isDefault: true, isActive: true });
  });

  it("lets the most specific assignment win and ends the previous one the day before", async () => {
    // Media works six days; its video department keeps the office week; Huy goes back to six days from the 17th.
    await assignSchedule({ scope: "entity", entityId: ids.media, departmentId: null, personId: null, scheduleId: ids.sixDays, validFrom: "2026-01-01", validTo: null, note: null }, ids.huy);
    expect((await kinds(ids.huy, "2026-08-08", "2026-08-08"))[0]).toBe("working");
    expect((await kinds(ids.lan, "2026-08-08", "2026-08-08"))[0]).toBe("untracked");
    await assignSchedule({ scope: "department", entityId: ids.media, departmentId: ids.video, personId: null, scheduleId: ids.office, validFrom: "2026-01-01", validTo: null, note: null }, ids.huy);
    expect((await kinds(ids.huy, "2026-08-08", "2026-08-08"))[0]).toBe("untracked");
    await assignSchedule({ scope: "person", entityId: null, departmentId: null, personId: ids.huy, scheduleId: ids.sixDays, validFrom: "2026-08-10", validTo: null, note: null }, ids.huy);
    const { closed } = await assignSchedule({ scope: "person", entityId: null, departmentId: null, personId: ids.huy, scheduleId: ids.office, validFrom: "2026-08-17", validTo: null, note: null }, ids.huy);
    expect(closed?.validTo).toBe("2026-08-16");
    // Saturdays 8th (department), 15th (person: six days), 22nd (person: office).
    expect([(await kinds(ids.huy, "2026-08-08", "2026-08-08"))[0], (await kinds(ids.huy, "2026-08-15", "2026-08-15"))[0], (await kinds(ids.huy, "2026-08-22", "2026-08-22"))[0]]).toEqual(["untracked", "working", "untracked"]);
  });

  it("refuses an assignment that would swallow a later one, a wrong shape, and another entity's schedule", async () => {
    const person = { scope: "person" as const, entityId: null, departmentId: null, personId: ids.huy, validTo: null, note: null };
    await expect(assignSchedule({ ...person, scheduleId: ids.office, validFrom: "2026-08-01" }, ids.huy)).rejects.toThrow("schedule_assignment_overlap");
    await expect(assignSchedule({ ...person, personId: null, scheduleId: ids.office, validFrom: "2026-08-01" }, ids.huy)).rejects.toThrow("schedule_assignment_scope");
    const { after: mediaOnly } = await saveSchedule({ id: null, entityId: ids.media, name: "Crew", kind: "shift", pattern: ALL_OFF, isDefault: false, isActive: true });
    ids.crew = mediaOnly.id;
    await expect(assignSchedule({ scope: "entity", entityId: ids.creative, departmentId: null, personId: null, scheduleId: mediaOnly.id, validFrom: "2026-01-01", validTo: null, note: null }, ids.huy)).rejects.toThrow("schedule_other_entity");
    // The database itself refuses overlapping rows of one scope, whatever the service does.
    await expect(db().insert(schema.scheduleAssignment).values({ scope: "person", personId: ids.huy, scheduleId: ids.office, validFrom: "2026-08-20" })).rejects.toThrow();
    const rows = await listAssignments();
    expect(rows.filter((row) => row.personId === ids.huy)).toHaveLength(2);
    await removeAssignment(rows.find((row) => row.personId === ids.huy && row.validTo === null)!.id);
    expect((await listAssignments()).filter((row) => row.personId === ids.huy)).toHaveLength(1);
  });

  it("plans a rostered crew: overnight shift, rostered off, back to the pattern when cleared", async () => {
    const { after: night } = await saveShift({ id: null, entityId: ids.media, code: "NIGHT", name: "Night", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 45, isActive: true });
    ids.night = night.id;
    await expect(saveShift({ id: null, entityId: ids.media, code: "NIGHT", name: "Again", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 0, isActive: true })).rejects.toThrow("shift_code_taken");
    await expect(saveShift({ id: null, entityId: ids.media, code: "BAD", name: "Bad", segments: [{ start: "08:00", end: "09:00" }], breakMinutes: 60, isActive: true })).rejects.toThrow("pattern_break_too_long");
    await assignSchedule({ scope: "person", entityId: null, departmentId: null, personId: ids.tam, scheduleId: ids.crew, validFrom: "2026-01-01", validTo: null, note: null }, ids.huy);
    expect(await kinds(ids.tam, "2026-08-12", "2026-08-13")).toEqual(["rest", "rest"]);
    await setRoster({ personId: ids.tam, from: "2026-08-12", to: "2026-08-13", shiftId: night.id, note: null });
    await setRoster({ personId: ids.tam, from: "2026-08-14", to: "2026-08-14", shiftId: "off", note: null });
    const plans = (await getDayPlans([ids.tam], "2026-08-12", "2026-08-14")).get(ids.tam)!.days;
    expect(plans[0]).toMatchObject({ kind: "working", shiftId: night.id, requiredMinutes: 435, segments: [{ start: 1320, end: 1800 }] });
    expect(plans[2]).toMatchObject({ kind: "rest", trace: ["roster:off"] });
    await setRoster({ personId: ids.tam, from: "2026-08-13", to: "2026-08-14", shiftId: "clear", note: null });
    expect(await kinds(ids.tam, "2026-08-12", "2026-08-14")).toEqual(["working", "rest", "rest"]);
    await expect(setRoster({ personId: ids.tam, from: "2026-01-01", to: "2026-06-30", shiftId: night.id, note: null })).rejects.toThrow("roster_range_too_long");
  });
});

describe("the working calendar", () => {
  it("applies the group's holiday to everyone and an entity's own row to that entity only", async () => {
    const { after } = await saveCalendarDay({ entityId: null, date: "2026-09-02", kind: "public_holiday", name: "Quốc khánh" });
    await saveCalendarDay({ entityId: ids.creative, date: "2026-08-21", kind: "company_off", name: "Team building" });
    expect((await kinds(ids.huy, "2026-09-02", "2026-09-02"))[0]).toBe("holiday");
    expect((await kinds(ids.lan, "2026-08-21", "2026-08-21"))[0]).toBe("company_off");
    expect((await kinds(ids.huy, "2026-08-21", "2026-08-21"))[0]).toBe("working");
    // An entity turns the group's holiday into a working day for itself.
    await saveCalendarDay({ entityId: ids.media, date: "2026-09-02", kind: "working_override", name: "Shooting day" });
    expect((await kinds(ids.huy, "2026-09-02", "2026-09-02"))[0]).toBe("working");
    expect((await kinds(ids.lan, "2026-09-02", "2026-09-02"))[0]).toBe("holiday");
    // Saving the same date again replaces the row instead of adding one.
    const again = await saveCalendarDay({ entityId: null, date: "2026-09-02", kind: "public_holiday", name: "Quốc khánh 2/9" });
    expect(again.after.id).toBe(after.id);
    expect((await listCalendarDays(2026)).filter((row) => row.date === "2026-09-02")).toHaveLength(2);
  });

  it("keeps seeded dates unconfirmed until HR confirms them", async () => {
    const [seeded] = await db().insert(schema.calendarDay).values({ date: "2027-04-16", kind: "public_holiday", name: "Giỗ Tổ", isConfirmed: false }).returning();
    expect((await confirmCalendarDay(seeded.id)).isConfirmed).toBe(true);
  });
});
