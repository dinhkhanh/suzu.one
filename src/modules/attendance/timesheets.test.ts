// The stored timesheet and the device import against a real Postgres (PGlite): idempotent imports,
// unmapped IDs, recompute when inputs change, locked rows, who sees whose month.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
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

import { and, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { parseTable } from "@/modules/platform/import/engine/table";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { getAttendancePolicy, savePolicy } from "./attendance-policies";
import { bulkMapByEmployeeCode, checkLogRows, commitLogRows, deviceLogColumns, listUnmapped, mapDeviceUser, saveDevice, saveProfile } from "./devices";
import type { SchedulePattern } from "./engine/calendar";
import { parseDat, PROFILE_SEED, toCanonicalTable } from "./engine/device-log";
import { requestTimesheetRecompute } from "./recompute";
import { saveSchedule } from "./schedules";
import { getTeamMonth, getTimesheetDays, recomputeDays, summariseMonth, timesheetTargetFor } from "./timesheets";

const OFFICE_DAY = { type: "working" as const, segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const WEEK: SchedulePattern = { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } };
const NOW = new Date("2026-08-20T09:00:00+07:00");

const ids = {} as Record<"media" | "creative" | "video" | "lead" | "huy" | "nhu" | "lan" | "hr" | "device" | "annual", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const inTx = <T>(run: (tx: Tx) => Promise<T>) => db().transaction((tx) => run(tx as Tx));

// Monday 3 to Wednesday 5 August 2026 for IDs 17 (Huy) and 21 (Nhu); 99 is nobody yet.
const LOG = [
  "   17\t2026-08-03 08:27:31\t1\t0\t1\t0",
  "   17\t2026-08-03 17:35:02\t1\t1\t1\t0",
  "   21\t2026-08-03 08:52:10\t1\t0\t1\t0",
  "   21\t2026-08-03 17:31:44\t1\t1\t1\t0",
  "   17\t2026-08-04 08:29:00\t1\t0\t1\t0",
  "   99\t2026-08-04 08:15:00\t1\t0\t1\t0",
  "   99\t2026-08-04 17:40:00\t1\t1\t1\t0",
].join("\n");
const rowsOf = (dat: string) => parseTable(toCanonicalTable(parseDat(dat), PROFILE_SEED[1].mapping).table, deviceLogColumns, { headerless: true });
const dayOf = async (personId: string, date: string) => (await getTimesheetDays([personId], date, date))[0];

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "Suzu Media", shortName: "Media" }, { code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }]).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const person = async (name: string, entityId: string, code: string, managerId: string | null = null) => {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, departmentId: video.id, managerId, status: "active" }).returning();
    await db().insert(schema.employment).values({ personId: row.id, entityId, employeeCode: code, startDate: "2025-01-01", seniorityDate: "2025-01-01" });
    return row.id;
  };
  const lead = await person("Long", media.id, "SZM-0001");
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, lead, huy: await person("Huy", media.id, "SZM-0002", lead), nhu: await person("Nhu", media.id, "SZM-0003", lead), lan: await person("Lan", creative.id, "SZC-0001"), hr: await person("Bao", media.id, "SZM-0004") });
  await saveSchedule({ id: null, entityId: null, name: "Office", kind: "fixed", pattern: WEEK, isDefault: true, isActive: true });
  await db().insert(schema.statutoryParameter).values({ key: "work.night_window", validFrom: "2021-01-01", value: { start: "22:00", end: "06:00" }, status: "approved", isVerified: false, legalReference: "test" });
  await savePolicy({ entityId: null, validFrom: "2026-01-01", mergeRule: "first_in_last_out", graceLateMinutes: 5, graceEarlyMinutes: 5, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: 3 }, lead);
  const { after: profile } = await saveProfile({ id: null, entityId: null, ...PROFILE_SEED[1], isActive: true });
  const { after: device } = await saveDevice({ id: null, entityId: media.id, name: "Cửa chính", model: "ZKTeco K40", serialNumber: null, locationId: null, profileId: profile.id, isActive: true });
  ids.device = device.id;
  const [annual] = await db().insert(schema.leaveType).values({ code: "ANNUAL", name: "Phép năm", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  ids.annual = annual.id;
});

describe("attendance policy versions", () => {
  it("an entity's own version wins from its start date; the earlier version is closed, not rewritten", async () => {
    await savePolicy({ entityId: ids.creative, validFrom: "2026-08-01", mergeRule: "prefer_device", graceLateMinutes: 10, graceEarlyMinutes: 0, roundingMinutes: 15, otMinMinutes: 60, otRequiresApproval: false, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: null }, ids.lead);
    expect(await getAttendancePolicy(ids.creative, "2026-07-31")).toMatchObject({ mergeRule: "first_in_last_out", graceLateMinutes: 5 });
    expect(await getAttendancePolicy(ids.creative, "2026-08-01")).toMatchObject({ mergeRule: "prefer_device", graceLateMinutes: 10, roundingMinutes: 15 });
    expect(await getAttendancePolicy(ids.media, "2026-08-01")).toMatchObject({ mergeRule: "first_in_last_out", monthlyCorrectionCap: 3 });
    await expect(savePolicy({ entityId: ids.creative, validFrom: "2026-07-01", mergeRule: "prefer_app", graceLateMinutes: 0, graceEarlyMinutes: 0, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: null }, ids.lead)).rejects.toThrow("attendance_policy_before_current");
  });
});

describe("device log import (FR-ATT-06)", () => {
  it("maps IDs by employee code, all or nothing, only to people of the device's entity", async () => {
    await expect(bulkMapByEmployeeCode(ids.device, "17,SZM-0002\n21;SZM-9999\n30,SZC-0001\noops", ids.hr)).rejects.toMatchObject({ message: "bulk_map_problems", details: [{ line: 2, code: "employee_not_found" }, { line: 3, code: "employee_not_found" }, { line: 4, code: "bad_line" }] });
    expect(await bulkMapByEmployeeCode(ids.device, "17,SZM-0002\n21;szm-0003", ids.hr)).toEqual({ mapped: 2, resolved: 0 });
    await expect(mapDeviceUser(ids.device, "17", ids.lead, ids.hr)).rejects.toThrow("device_user_taken");
  });

  it("reports an unmapped ID as a warning, not a reason to stop", async () => {
    const { rows, problems } = rowsOf(LOG);
    expect(problems).toEqual([]);
    const checked = await checkLogRows(rows, ids.device, db(), NOW);
    expect(checked.problems).toEqual([{ row: 6, column: "Device user ID", code: "device_user_unmapped", severity: "warning", detail: "99 (2)" }]);
    const future = await checkLogRows(rowsOf("   17\t2027-01-01 08:00:00\t1\t0\t1\t0").rows, ids.device, db(), NOW);
    expect(future.problems).toEqual([{ row: 1, column: "Time", code: "timestamp_in_future" }]);
  });

  it("writes punches once: a second import of an overlapping export adds only what is new", async () => {
    const first = await inTx((tx) => commitLogRows(rowsOf(LOG).rows, tx, ids.device, null));
    expect(first).toEqual({ punches: 5, skipped: 0, unmapped: 2, people: 2 });
    const overlapping = `${LOG}\n   17\t2026-08-04 17:33:00\t1\t1\t1\t0\n   17\t2026-08-04 17:33:00\t1\t1\t1\t0`;
    const second = await inTx((tx) => commitLogRows(rowsOf(overlapping).rows, tx, ids.device, null));
    expect(second).toEqual({ punches: 1, skipped: 8, unmapped: 0, people: 1 });
    const punches = await db().select().from(schema.punch).where(eq(schema.punch.deviceId, ids.device));
    expect(punches).toHaveLength(6);
    expect(punches.every((punch) => punch.source === "device" && punch.entityId === ids.media)).toBe(true);
  });

  it("recomputed the days the import touched", async () => {
    expect(await dayOf(ids.huy, "2026-08-03")).toMatchObject({ status: "present", workedMinutes: 480, lateMinutes: 0, anomalies: [] });
    expect(await dayOf(ids.nhu, "2026-08-03")).toMatchObject({ status: "partial", lateMinutes: 22, workedMinutes: 458, anomalies: ["late"] });
    expect((await dayOf(ids.huy, "2026-08-03")).firstIn).toEqual(new Date("2026-08-03T08:27:00+07:00"));
    expect(await dayOf(ids.huy, "2026-08-04")).toMatchObject({ status: "present", workedMinutes: 480 });
  });

  it("turns waiting lines into punches when the ID is mapped", async () => {
    expect(await listUnmapped(ids.device)).toMatchObject([{ deviceUserId: "99", lines: 2 }]);
    expect(await mapDeviceUser(ids.device, "99", ids.hr, ids.hr)).toEqual({ resolved: 2 });
    expect(await listUnmapped(ids.device)).toEqual([]);
    expect(await dayOf(ids.hr, "2026-08-04")).toMatchObject({ status: "present", workedMinutes: 480 });
  });
});

describe("recompute (FR-ATT-09)", () => {
  it("fills a range: absences, untracked Saturdays, rest days; nothing beyond today", async () => {
    const result = await recomputeDays([ids.huy], "2026-08-03", "2026-08-31", db(), NOW);
    expect(result.days).toBe(18);
    const days = await getTimesheetDays([ids.huy], "2026-08-01", "2026-08-31");
    expect(days.at(-1)?.date).toBe("2026-08-20");
    expect(days.find((day) => day.date === "2026-08-05")).toMatchObject({ status: "absent", absenceMinutes: 480, anomalies: ["absent"] });
    expect(days.find((day) => day.date === "2026-08-08")).toMatchObject({ status: "untracked", creditedMinutes: 480, anomalies: [] });
    expect(days.find((day) => day.date === "2026-08-09")).toMatchObject({ status: "rest" });
    expect(days.find((day) => day.date === "2026-08-20")).toMatchObject({ status: "in_progress", anomalies: [] });
    const again = await recomputeDays([ids.huy], "2026-08-03", "2026-08-31", db(), NOW);
    expect(again.written).toBe(0);
  });

  it("follows a new punch and approved leave", async () => {
    await db().insert(schema.punch).values([{ personId: ids.huy, entityId: ids.media, at: new Date("2026-08-05T08:30:00+07:00"), direction: "in", source: "request" }, { personId: ids.huy, entityId: ids.media, at: new Date("2026-08-05T12:00:00+07:00"), direction: "out", source: "request" }]);
    const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.huy, entityId: ids.media, leaveTypeId: ids.annual, startDate: "2026-08-05", endDate: "2026-08-06", startPortion: "pm", totalCenti: 150, status: "approved" }).returning();
    await db().insert(schema.leaveRequestDay).values([{ requestId: request.id, personId: ids.huy, date: "2026-08-05", portion: "pm", amountCenti: 50 }, { requestId: request.id, personId: ids.huy, date: "2026-08-06", portion: "full", amountCenti: 100 }]);
    await inTx((tx) => requestTimesheetRecompute([ids.huy], "2026-08-05", "2026-08-06", tx));
    expect(await dayOf(ids.huy, "2026-08-05")).toMatchObject({ status: "partial", workedMinutes: 210, leavePaidMinutes: 270, absenceMinutes: 0, anomalies: [] });
    expect(await dayOf(ids.huy, "2026-08-06")).toMatchObject({ status: "leave", leavePaidMinutes: 480, absenceMinutes: 0 });
    expect(await summariseMonth(ids.huy, "2026-08")).toMatchObject({ leavePaidMinutes: 750, absentDays: 9 });
  });

  it("never touches a locked day, nor adds days to a locked person-month", async () => {
    await db().update(schema.timesheetDay).set({ lockedAt: new Date() }).where(and(eq(schema.timesheetDay.personId, ids.nhu), eq(schema.timesheetDay.date, "2026-08-03")));
    await db().insert(schema.punch).values({ personId: ids.nhu, entityId: ids.media, at: new Date("2026-08-03T08:00:00+07:00"), direction: "in", source: "request" });
    const result = await recomputeDays([ids.nhu], "2026-08-03", "2026-08-10", db(), NOW);
    expect(result).toMatchObject({ written: 0, lockedSkipped: 8 });
    expect(await dayOf(ids.nhu, "2026-08-03")).toMatchObject({ lateMinutes: 22 });
    expect(await dayOf(ids.nhu, "2026-08-10")).toBeUndefined();
  });

  it("has no row outside someone's employment", async () => {
    await db().update(schema.employment).set({ endDate: "2026-08-04" }).where(eq(schema.employment.personId, ids.hr));
    await recomputeDays([ids.hr], "2026-08-03", "2026-08-06", db(), NOW);
    expect((await getTimesheetDays([ids.hr], "2026-08-01", "2026-08-31")).map((day) => day.date)).toEqual(["2026-08-03", "2026-08-04"]);
  });
});

describe("who reads whose month", () => {
  it("line manager: the reports; HR: the entity; an employee: nobody else", async () => {
    const asLead = await getTeamMonth({ personId: ids.lead, principal: principal(ids.lead) }, "2026-08");
    expect(asLead.rows.map((row) => row.fullName)).toEqual(["Huy", "Nhu"]);
    expect(asLead.rows[0].summary.leavePaidMinutes).toBe(750);
    const asHr = await getTeamMonth({ personId: ids.hr, principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]) }, "2026-08");
    expect(asHr.rows.map((row) => row.fullName)).toEqual(["Huy", "Long", "Nhu"]);
    expect((await getTeamMonth({ personId: ids.huy, principal: principal(ids.huy) }, "2026-08")).rows).toEqual([]);
  });
  it("a colleague and another entity's HR cannot open someone's month", async () => {
    expect(await timesheetTargetFor(principal(ids.nhu), ids.huy)).toBeNull();
    expect(await timesheetTargetFor(principal(ids.lan, [{ role: "hr_staff", scope: { type: "entity", id: ids.creative } }]), ids.huy)).toBeNull();
    expect(await timesheetTargetFor(principal(ids.lead), ids.huy)).not.toBeNull();
    expect(await timesheetTargetFor(principal(ids.huy), ids.huy)).not.toBeNull();
  });
});
