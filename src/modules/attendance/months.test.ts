// Attendance requests, the monthly timesheet and its lock against a real Postgres (PGlite):
// each request type's effect and recompute, the correction cap, confirm → approve → lock, the
// locked month staying put, adjustments for payroll, what payroll reads, and who sees what.
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
import { db, schema } from "@/lib/db";
import { getLeaveUsage } from "@/modules/leave/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { listAnomalies } from "./anomalies";
import { savePolicy } from "./attendance-policies";
import type { SchedulePattern } from "./engine/calendar";
import { eachDate, isoWeekday } from "./engine/calendar";
import { approveMonth, confirmMonth, createAdjustment, getLockedTimesheets, getPeriodOverview, isPeriodLocked, listAdjustmentsForPayroll, listMonthsToApprove, lockPeriod, markAdjustmentsTaken, remindMonthReady, reopenMonth, voidAdjustment } from "./months";
import { declaredOffSiteLocations } from "./request-inputs";
import { type AttendanceRequestInput, cancelAttendanceRequest, confirmWorkedMinutes, decideAttendanceRequest, submitAttendanceRequest } from "./requests";
import { saveSchedule } from "./schedules";
import { getTimesheetDays, recomputeDays } from "./timesheets";

const OFFICE_DAY = { type: "working" as const, segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const WEEK: SchedulePattern = { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } };
const MONTH = "2026-08";

const ids = {} as Record<"media" | "creative" | "owner" | "lead" | "huy" | "nhu" | "hr" | "lan" | "comp", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+07:00`);
const dayOf = async (personId: string, date: string) => (await getTimesheetDays([personId], date, date))[0];
const self = (personId: string) => ({ personId, isHr: false });

const correction = (date: string, inTime: string | null, outTime: string | null): AttendanceRequestInput => ({ type: "attendance_correction", startDate: date, endDate: date, details: { type: "attendance_correction", cause: "forgot", inTime, outTime, outNextDay: false }, reason: "Quên chấm công", evidenceFileId: null, compensation: null });
const overtime = (date: string, from: string, to: string, compensation: "pay" | "time_off"): AttendanceRequestInput => ({ type: "overtime", startDate: date, endDate: date, details: { type: "overtime", from, to }, reason: "Kịp hạn dựng phim", evidenceFileId: null, compensation });
const holidayWork = (date: string, from: string | null, to: string | null): AttendanceRequestInput => ({ type: "holiday_work", startDate: date, endDate: date, details: { type: "holiday_work", from, to }, reason: "Quay sự kiện", evidenceFileId: null, compensation: "pay" });
const remote = (from: string, to: string, kind: "wfh" | "off_site", place: { name: string; latitude: number; longitude: number } | null = null): AttendanceRequestInput => ({ type: "remote_work", startDate: from, endDate: to, details: { type: "remote_work", kind, portion: "full", locationName: place?.name ?? null, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null, radiusM: null }, reason: "Theo kế hoạch", evidenceFileId: null, compensation: null });

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative, holding] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "Suzu Media", shortName: "Media" }, { code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }, { code: "SZG", legalName: "Suzu Group", shortName: "Group" }]).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const person = async (name: string, entityId: string, code: string, managerId: string | null = null) => {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), primaryEntityId: entityId, departmentId: video.id, managerId, status: "active" }).returning();
    await db().insert(schema.employment).values({ personId: row.id, entityId, employeeCode: code, startDate: "2025-01-01", seniorityDate: "2025-01-01" });
    return row.id;
  };
  // The owner and HR sit in the holding company: the Media month is Long, Huy and Nhu.
  const owner = await person("Owner", holding.id, "SZG-0001");
  const lead = await person("Long", media.id, "SZM-0002", owner);
  Object.assign(ids, { media: media.id, creative: creative.id, owner, lead, huy: await person("Huy", media.id, "SZM-0003", lead), nhu: await person("Nhu", media.id, "SZM-0004", lead), hr: await person("Bao", holding.id, "SZG-0002", owner), lan: await person("Lan", creative.id, "SZC-0001") });
  await db().insert(schema.roleAssignment).values([{ personId: owner, role: "owner", scopeType: "group" }, { personId: ids.hr, role: "hr_staff", scopeType: "entity", scopeId: media.id }]);
  await saveSchedule({ id: null, entityId: null, name: "Office", kind: "fixed", pattern: WEEK, isDefault: true, isActive: true });
  await db().insert(schema.statutoryParameter).values([
    { key: "work.night_window", validFrom: "2021-01-01", value: { start: "22:00", end: "06:00" }, status: "approved", isVerified: false, legalReference: "test" },
    { key: "overtime.caps", validFrom: "2021-01-01", value: { monthlyHours: 40, yearlyHours: 200, yearlyHoursExtended: 300 }, status: "approved", isVerified: false, legalReference: "test" },
  ]);
  await savePolicy({ entityId: null, validFrom: "2026-01-01", mergeRule: "first_in_last_out", graceLateMinutes: 5, graceEarlyMinutes: 5, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: 2 }, owner);
  const [comp] = await db().insert(schema.leaveType).values({ code: "COMP", name: "Nghỉ bù", category: "compensatory", isPaid: true, payrollTreatment: "paid_company", tracksBalance: true }).returning();
  ids.comp = comp.id;

  // August 2026: everyone in the office 08:30–17:30 every weekday, with Huy's scripted exceptions.
  const punches: (typeof schema.punch.$inferInsert)[] = [];
  for (const personId of [ids.lead, ids.huy, ids.nhu, ids.lan]) {
    const entityId = personId === ids.lan ? creative.id : media.id;
    for (const date of eachDate("2026-08-01", "2026-08-31")) {
      if (isoWeekday(date) > 5) continue;
      if (personId === ids.huy && date === "2026-08-12") continue; // works from home
      punches.push({ personId, entityId, at: at(date, "08:30"), direction: "in", source: "device", flags: [] });
      if (personId === ids.huy && date === "2026-08-20") continue; // forgot to check out
      punches.push({ personId, entityId, at: at(date, personId === ids.huy && date === "2026-08-27" ? "19:30" : "17:30"), direction: "out", source: "device", flags: [] });
    }
  }
  // Huy worked Sunday the 16th.
  punches.push({ personId: ids.huy, entityId: media.id, at: at("2026-08-16", "09:00"), direction: "in", source: "app", flags: [] }, { personId: ids.huy, entityId: media.id, at: at("2026-08-16", "13:00"), direction: "out", source: "app", flags: [] });
  await db().insert(schema.punch).values(punches);
  await recomputeDays([ids.lead, ids.huy, ids.nhu, ids.lan], "2026-08-01", "2026-08-31");
});

describe("attendance requests (FR-ATT-10, 11, 12, 18)", () => {
  it("starts from the anomalies the month really has", async () => {
    expect((await dayOf(ids.huy, "2026-08-20")).anomalies).toContain("missing_out");
    expect((await dayOf(ids.huy, "2026-08-27")).otUnapprovedMinutes).toBe(120);
    expect((await dayOf(ids.huy, "2026-08-16")).anomalies).toContain("worked_on_day_off");
    expect((await dayOf(ids.huy, "2026-08-12")).status).toBe("absent");
    await expect(confirmMonth(ids.huy, MONTH)).rejects.toMatchObject({ message: "timesheet_missing_punches", details: { days: ["2026-08-20"] } });
  });

  it("a correction goes to the line manager; approving it writes the punch and the day recomputes", async () => {
    const filed = await submitAttendanceRequest(ids.huy, correction("2026-08-20", null, "17:30"), self(ids.huy));
    expect(filed.outcome).toBe("pending");
    await expect(submitAttendanceRequest(ids.huy, correction("2026-08-20", null, "18:00"), self(ids.huy))).rejects.toThrow("attendance_request_duplicate");
    await expect(decideAttendanceRequest(ids.nhu, filed.approvalRequestId, { action: "approve", comment: null })).rejects.toThrow("approval_not_assignee");
    const decided = await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect(decided.attendanceRequest.status).toBe("approved");
    const written = await db().select().from(schema.punch).where(and(eq(schema.punch.personId, ids.huy), eq(schema.punch.source, "request")));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ direction: "out", at: at("2026-08-20", "17:30"), deviceInfo: { requestId: filed.attendanceRequest.id } });
    expect(await dayOf(ids.huy, "2026-08-20")).toMatchObject({ missingPunch: false, workedMinutes: 480, status: "present" });
  });

  it("holds the person to the monthly cap; HR files beyond it; a cancelled correction stops counting", async () => {
    await expect(submitAttendanceRequest(ids.huy, correction("2026-08-21", null, null), self(ids.huy))).rejects.toThrow("correction_needs_time");
    await expect(submitAttendanceRequest(ids.huy, correction("2026-08-21", "09:00", "08:00"), self(ids.huy))).rejects.toThrow("correction_out_before_in");
    const second = await submitAttendanceRequest(ids.huy, correction("2026-08-21", "08:30", null), self(ids.huy));
    await expect(submitAttendanceRequest(ids.huy, correction("2026-08-24", "08:30", null), self(ids.huy))).rejects.toMatchObject({ message: "correction_cap_reached", details: { cap: 2, used: 2 } });
    const byHr = await submitAttendanceRequest(ids.huy, correction("2026-08-24", "08:30", null), { personId: ids.hr, isHr: true });
    expect(byHr.attendanceRequest.filedByPersonId).toBe(ids.hr);
    // HR filed it, so HR (the requester) takes it back; Huy takes back his own.
    expect((await cancelAttendanceRequest(byHr.attendanceRequest.id, { personId: ids.hr, isHr: true }, null)).after.status).toBe("withdrawn");
    await expect(cancelAttendanceRequest(second.attendanceRequest.id, self(ids.nhu), null)).rejects.toThrow("attendance_cancel_not_allowed");
    expect((await cancelAttendanceRequest(second.attendanceRequest.id, self(ids.huy), null)).after.status).toBe("withdrawn");
    // One approved correction is left: there is room for one more.
    const third = await submitAttendanceRequest(ids.huy, correction("2026-08-25", "08:30", null), self(ids.huy));
    await cancelAttendanceRequest(third.attendanceRequest.id, self(ids.huy), null);
  });

  it("overtime belongs to working days, holiday work to days off — the wrong form is refused", async () => {
    await expect(submitAttendanceRequest(ids.huy, overtime("2026-08-16", "09:00", "13:00", "pay"), self(ids.huy))).rejects.toThrow("overtime_use_holiday_work");
    await expect(submitAttendanceRequest(ids.huy, holidayWork("2026-08-27", "17:30", "19:30"), self(ids.huy))).rejects.toThrow("holiday_work_not_day_off");
    await expect(submitAttendanceRequest(ids.huy, overtime("2026-08-27", "17:30", "17:30", "pay"), self(ids.huy))).rejects.toThrow("overtime_window_invalid");
    await expect(submitAttendanceRequest(ids.huy, { ...overtime("2026-08-27", "17:30", "19:30", "pay"), compensation: null }, self(ids.huy))).rejects.toThrow("overtime_compensation_required");
  });

  it("approved overtime turns unapproved minutes into weekday overtime, as time off when asked", async () => {
    const filed = await submitAttendanceRequest(ids.huy, overtime("2026-08-27", "17:30", "19:30", "time_off"), self(ids.huy));
    expect(filed.warnings).toEqual([]);
    await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect(await dayOf(ids.huy, "2026-08-27")).toMatchObject({ otWeekdayMinutes: 120, otUnapprovedMinutes: 0, otTimeOffMinutes: 120, workedMinutes: 480 });
  });

  it("approved rest-day work counts at the rest-day category", async () => {
    const filed = await submitAttendanceRequest(ids.huy, holidayWork("2026-08-16", "09:00", "13:00"), self(ids.huy));
    await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    const day = await dayOf(ids.huy, "2026-08-16");
    expect(day).toMatchObject({ otRestDayMinutes: 240, otTimeOffMinutes: 120 - 120 });
    expect(day.anomalies).not.toContain("worked_on_day_off");
  });

  it("a day worked from home is credited without punches; a rejected request changes nothing", async () => {
    const rejected = await submitAttendanceRequest(ids.huy, remote("2026-08-12", "2026-08-12", "wfh"), self(ids.huy));
    await expect(decideAttendanceRequest(ids.lead, rejected.approvalRequestId, { action: "reject", comment: null })).rejects.toThrow("approval_comment_required");
    expect((await decideAttendanceRequest(ids.lead, rejected.approvalRequestId, { action: "reject", comment: "Hôm đó có lịch quay" })).attendanceRequest.status).toBe("rejected");
    expect((await dayOf(ids.huy, "2026-08-12")).status).toBe("absent");
    const filed = await submitAttendanceRequest(ids.huy, remote("2026-08-12", "2026-08-12", "wfh"), self(ids.huy));
    await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect(await dayOf(ids.huy, "2026-08-12")).toMatchObject({ wfhMinutes: 480, absenceMinutes: 0, status: "remote" });
  });

  it("an approved off-site day declares its place for check-in", async () => {
    await expect(submitAttendanceRequest(ids.nhu, remote("2026-08-13", "2026-08-13", "off_site"), self(ids.nhu))).rejects.toThrow("remote_needs_location");
    const filed = await submitAttendanceRequest(ids.nhu, remote("2026-08-13", "2026-08-14", "off_site", { name: "Phim trường Thủ Đức", latitude: 10.85, longitude: 106.77 }), self(ids.nhu));
    expect(await declaredOffSiteLocations(db(), ids.nhu, "2026-08-13")).toEqual([]);
    await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect(await declaredOffSiteLocations(db(), ids.nhu, "2026-08-14")).toMatchObject([{ latitude: 10.85, longitude: 106.77, radiusM: 300, rule: "gps", offSite: true }]);
    expect(await declaredOffSiteLocations(db(), ids.nhu, "2026-08-17")).toEqual([]);
    // She still clocked in at the office those days; punches decide as usual.
    expect(await dayOf(ids.nhu, "2026-08-13")).toMatchObject({ workedMinutes: 480 });
  });

  it("overtime on an untracked Saturday counts once the line manager confirms the hours — never one's own", async () => {
    const filed = await submitAttendanceRequest(ids.nhu, overtime("2026-08-15", "09:00", "12:00", "pay"), self(ids.nhu));
    await decideAttendanceRequest(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect((await dayOf(ids.nhu, "2026-08-15")).otWeekdayMinutes).toBe(0);
    await expect(confirmWorkedMinutes(filed.attendanceRequest.id, ids.nhu, 180)).rejects.toThrow("confirm_own_hours");
    await confirmWorkedMinutes(filed.attendanceRequest.id, ids.lead, 180);
    expect(await dayOf(ids.nhu, "2026-08-15")).toMatchObject({ otWeekdayMinutes: 180, creditedMinutes: 480 });
  });
});

describe("monthly timesheet: confirm → approve → lock (FR-ATT-14)", () => {
  it("the employee confirms, the line manager approves or sends back; HR may approve without the confirmation", async () => {
    expect((await confirmMonth(ids.huy, MONTH)).after.status).toBe("confirmed");
    await expect(confirmMonth(ids.huy, MONTH)).rejects.toThrow("timesheet_not_open");
    expect((await reopenMonth(ids.huy, MONTH, ids.lead, "Kiểm tra lại ngày 27")).after).toMatchObject({ status: "open", confirmedAt: null });
    await confirmMonth(ids.huy, MONTH);
    expect((await approveMonth(ids.huy, MONTH, { personId: ids.lead, isHr: false })).after).toMatchObject({ status: "approved", approvedByPersonId: ids.lead });
    await expect(approveMonth(ids.nhu, MONTH, { personId: ids.lead, isHr: false })).rejects.toThrow("timesheet_not_confirmed");
    expect((await approveMonth(ids.nhu, MONTH, { personId: ids.hr, isHr: true })).after.status).toBe("approved");
    await expect(confirmMonth(ids.huy, "2099-01")).rejects.toThrow("timesheet_month_not_over");
  });

  it("shows a manager the months of their reports only", async () => {
    const mine = await listMonthsToApprove({ personId: ids.lead, principal: principal(ids.lead) }, MONTH);
    expect(mine.map((row) => [row.fullName, row.status, row.canApprove])).toEqual([["Huy", "approved", true], ["Nhu", "approved", true]]);
    expect(await listMonthsToApprove({ personId: ids.huy, principal: principal(ids.huy) }, MONTH)).toEqual([]);
    const hr = await listMonthsToApprove({ personId: ids.hr, principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]) }, MONTH);
    expect(hr.map((row) => row.fullName)).toEqual(["Huy", "Long", "Nhu"]);
  });

  it("refuses the lock while something blocks it, and says what", async () => {
    const overview = await getPeriodOverview(ids.media, MONTH);
    expect(overview.counts).toEqual({ open: 1, confirmed: 0, approved: 2, locked: 0 });
    expect(overview.issues).toEqual([{ personId: ids.lead, code: "not_approved", count: 1, blocking: true }]);
    await expect(lockPeriod(ids.media, MONTH, ids.hr)).rejects.toMatchObject({ message: "timesheet_lock_blocked", details: { issues: [{ personId: ids.lead, code: "not_approved" }] } });
    expect(await getLockedTimesheets(ids.media, MONTH)).toBeNull();
    expect(await isPeriodLocked(ids.media, MONTH)).toBe(false);
  });

  it("locks with an override that is written down; days freeze, totals are snapshotted, time off in lieu reaches the leave ledger", async () => {
    const result = await lockPeriod(ids.media, MONTH, ids.hr, { overrideReason: "Trưởng nhóm đi công tác, đã xác nhận qua điện thoại" });
    expect(result).toMatchObject({ people: 3, toilPosted: [{ personId: ids.huy, minutes: 120, amountCenti: 25 }], exceptions: [{ personId: ids.lead, code: "not_approved" }] });
    expect(result.period).toMatchObject({ status: "locked", lockedByPersonId: ids.hr, exceptions: [{ personId: ids.lead, code: "not_approved", count: 1 }] });
    expect(await isPeriodLocked(ids.media, MONTH)).toBe(true);
    expect(await isPeriodLocked(ids.creative, MONTH)).toBe(false);
    await expect(lockPeriod(ids.media, MONTH, ids.hr)).rejects.toThrow("timesheet_period_locked");
    const grants = await db().select().from(schema.leaveLedgerEntry).where(and(eq(schema.leaveLedgerEntry.personId, ids.huy), eq(schema.leaveLedgerEntry.leaveTypeId, ids.comp)));
    expect(grants.map((row) => [row.kind, row.amountCenti, row.effectiveDate])).toEqual([["grant", 25, "2026-08-31"]]);
    expect((await getTimesheetDays([ids.huy, ids.nhu, ids.lead], "2026-08-01", "2026-08-31")).every((day) => day.lockedAt !== null)).toBe(true);
  });

  it("a locked month stays exactly as it was, whatever arrives afterwards", async () => {
    const before = await dayOf(ids.huy, "2026-08-05");
    await db().insert(schema.punch).values({ personId: ids.huy, entityId: ids.media, at: at("2026-08-05", "21:00"), direction: "out", source: "device", flags: [] });
    const outcome = await recomputeDays([ids.huy], "2026-08-01", "2026-08-31");
    expect(outcome).toMatchObject({ written: 0, lockedSkipped: 31 });
    expect(await dayOf(ids.huy, "2026-08-05")).toEqual(before);
    await expect(submitAttendanceRequest(ids.huy, correction("2026-08-05", null, "17:30"), { personId: ids.hr, isHr: true })).rejects.toThrow("attendance_period_locked");
    await expect(submitAttendanceRequest(ids.huy, overtime("2026-08-05", "17:30", "21:00", "pay"), self(ids.huy))).rejects.toThrow("attendance_period_locked");
    await expect(reopenMonth(ids.huy, MONTH, ids.hr, "Mở lại")).rejects.toThrow("timesheet_not_open");
  });
});

describe("what payroll reads", () => {
  it("getLockedTimesheets gives the frozen totals — checked by hand for Huy's August", async () => {
    const locked = await getLockedTimesheets(ids.media, MONTH);
    expect(locked).toMatchObject({ entityId: ids.media, month: MONTH, lockedByPersonId: ids.hr, overrideReason: "Trưởng nhóm đi công tác, đã xác nhận qua điện thoại" });
    expect(locked!.people.map((row) => row.employeeCode)).toEqual(["SZM-0002", "SZM-0003", "SZM-0004"]);
    const huy = locked!.people.find((row) => row.personId === ids.huy)!;
    // 21 weekdays + 5 untracked Saturdays asked; 20 days in the office, 1 from home, 5 Saturdays
    // credited; 2 h weekday overtime taken as time off, 4 h on a Sunday to be paid.
    expect(huy).toMatchObject({
      standardDays: 26,
      standardMinutes: 26 * 480,
      paidDaysCenti: 2600,
      unpaidDaysCenti: 0,
      workedMinutes: 20 * 480,
      creditedMinutes: 6 * 480,
      leavePaidMinutes: 0,
      leaveUnpaidMinutes: 0,
      absenceMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      overtime: { weekday: { day: 120, night: 0 }, restDay: { day: 240, night: 0 }, holiday: { day: 0, night: 0 }, totalMinutes: 360, timeOffMinutes: 120, payableMinutes: 240 },
    });
    const nhu = locked!.people.find((row) => row.personId === ids.nhu)!;
    expect(nhu).toMatchObject({ standardDays: 26, paidDaysCenti: 2600, workedMinutes: 21 * 480, overtime: { weekday: { day: 180, night: 0 }, totalMinutes: 180, payableMinutes: 180 } });
    // Leave speaks the same units: days in hundredths, by entity and date range. Nobody took leave here.
    expect(await getLeaveUsage({ entityId: ids.media }, "2026-08-01", "2026-08-31")).toEqual([]);
  });

  it("an adjustment to a locked month never edits it and reaches the next payroll as a retro item — once", async () => {
    await expect(createAdjustment({ personId: ids.lan, month: MONTH, date: null, deltas: { workedMinutes: 60 }, reason: "Chưa khoá" }, ids.hr)).rejects.toThrow("adjustment_month_not_locked");
    await expect(createAdjustment({ personId: ids.huy, month: MONTH, date: "2026-09-01", deltas: { workedMinutes: 60 }, reason: "Sai ngày" }, ids.hr)).rejects.toThrow("adjustment_date_outside_month");
    await expect(createAdjustment({ personId: ids.huy, month: MONTH, date: null, deltas: { workedMinutes: 0 }, reason: "Không có gì" }, ids.hr)).rejects.toThrow("adjustment_empty");
    const before = await dayOf(ids.huy, "2026-08-05");
    const row = await createAdjustment({ personId: ids.huy, month: MONTH, date: "2026-08-05", deltas: { otWeekdayMinutes: 210, otWeekdayNightMinutes: 0 }, reason: "Làm thêm đến 21:00 ngày 5/8, máy chấm công nhập muộn" }, ids.hr);
    expect(row).toMatchObject({ entityId: ids.media, deltas: { otWeekdayMinutes: 210 }, status: "active" });
    expect(await dayOf(ids.huy, "2026-08-05")).toEqual(before);
    expect(await listAdjustmentsForPayroll(ids.media, MONTH)).toEqual([]);
    expect((await listAdjustmentsForPayroll(ids.media, "2026-09")).map((item) => item.id)).toEqual([row.id]);
    expect(await listAdjustmentsForPayroll(ids.creative, "2026-09")).toEqual([]);

    const voided = await createAdjustment({ personId: ids.nhu, month: MONTH, date: null, deltas: { paidDaysCenti: -50 }, reason: "Nhập nhầm người" }, ids.hr);
    await voidAdjustment(voided.id, ids.hr, "Nhập nhầm người");
    expect((await listAdjustmentsForPayroll(ids.media, "2026-09")).map((item) => item.id)).toEqual([row.id]);

    expect(await db().transaction((tx) => markAdjustmentsTaken(tx, [row.id], "2026-09"))).toBe(1);
    await expect(voidAdjustment(row.id, ids.hr, "Muộn rồi")).rejects.toThrow("adjustment_in_payroll");
    // September's payroll still sees what it took; October's does not see it again.
    expect((await listAdjustmentsForPayroll(ids.media, "2026-09")).map((item) => item.id)).toEqual([row.id]);
    expect(await listAdjustmentsForPayroll(ids.media, "2026-10")).toEqual([]);
  });
});

describe("HR anomaly console (FR-ATT-15)", () => {
  it("lists what is open in HR's reach only, locked months left out", async () => {
    await db().insert(schema.punch).values({ personId: ids.lan, entityId: ids.creative, at: at("2026-08-10", "12:30"), direction: "out", source: "app", flags: ["outside_geofence"], reviewStatus: "pending" });
    const mediaHr = principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]);
    const forMedia = await listAnomalies(mediaHr, MONTH);
    expect(forMedia.lines).toEqual([]);
    expect(forMedia.people.map((row) => row.fullName)).toEqual(["Huy", "Long", "Nhu"]);
    const group = await listAnomalies(principal(ids.owner, [{ role: "owner", scope: { type: "group" } }]), MONTH);
    expect(group.lines.map((row) => [row.fullName, row.kind, row.blocking])).toEqual([["Lan", "punch_to_review", true], ["Lan", "month_not_confirmed", true]]);
    expect((await listAnomalies(principal(ids.huy), MONTH)).lines).toEqual([]);
  });
});

describe("month-ready reminder", () => {
  it("speaks on the 1st only, and only to people whose month is still open", async () => {
    expect(await remindMonthReady("2026-09-02")).toEqual({ told: 0 });
    // Media's August is locked; in Creative, Lan has days and an open month.
    expect(await remindMonthReady("2026-09-01")).toEqual({ told: 1 });
    const [notice] = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.lan), eq(schema.notification.kind, "attendance.month_ready")));
    expect(notice).toMatchObject({ link: "/attendance?month=2026-08" });
  });
});
