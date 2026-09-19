import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canAssignSchedule, canManageAttendanceConfig, canManageLocation, canOpenAttendanceSettings, canManageDevices, canReviewPunchOf, canSeePunchDetailOf, canSeeTimesheetOf } from "./policy";

const principal = (grants: Grant[]): Principal => ({ personId: "me", workforceType: "employee", grants });
const hrAdmin = principal([{ role: "hr_admin", scope: { type: "group" } }]);
const mediaHr = principal([{ role: "hr_staff", scope: { type: "entity", id: "media" } }]);
const head = principal([{ role: "department_head", scope: { type: "department", id: "video" } }]);
const employee = principal([]);
const huy = { personId: "huy", entityId: "media", departmentId: "video", managerId: "long" };
const lan = { personId: "lan", entityId: "creative", departmentId: "design", managerId: "chi" };

describe("attendance configuration", () => {
  it("opens the settings for HR only", () => {
    expect([hrAdmin, mediaHr, head, employee].map(canOpenAttendanceSettings)).toEqual([true, true, false, false]);
  });

  it("keeps the group's calendar, shifts and schedules for a group-wide grant", () => {
    expect(canManageAttendanceConfig(hrAdmin, null)).toBe(true);
    expect(canManageAttendanceConfig(mediaHr, null)).toBe(false);
    expect(canManageAttendanceConfig(mediaHr, "media")).toBe(true);
    expect(canManageAttendanceConfig(mediaHr, "creative")).toBe(false);
    expect(canManageAttendanceConfig(head, "media")).toBe(false);
  });

  it("lets an entity's HR assign schedules inside the entity only", () => {
    expect(canAssignSchedule(mediaHr, { scope: "entity", entityId: "media", departmentId: null }, null)).toBe(true);
    expect(canAssignSchedule(mediaHr, { scope: "entity", entityId: "creative", departmentId: null }, null)).toBe(false);
    // A shared department as a whole is not one entity's to configure; narrowed to the entity it is.
    expect(canAssignSchedule(mediaHr, { scope: "department", entityId: null, departmentId: "video" }, null)).toBe(false);
    expect(canAssignSchedule(mediaHr, { scope: "department", entityId: "media", departmentId: "video" }, null)).toBe(true);
    expect(canAssignSchedule(hrAdmin, { scope: "department", entityId: null, departmentId: "video" }, null)).toBe(true);
    expect(canAssignSchedule(mediaHr, { scope: "person", entityId: null, departmentId: null }, huy)).toBe(true);
    expect(canAssignSchedule(mediaHr, { scope: "person", entityId: null, departmentId: null }, lan)).toBe(false);
    expect(canAssignSchedule(mediaHr, { scope: "person", entityId: null, departmentId: null }, null)).toBe(false);
  });

  it("gives a line manager or department head no say over schedules", () => {
    expect(canAssignSchedule(head, { scope: "person", entityId: null, departmentId: null }, huy)).toBe(false);
    expect(canAssignSchedule(principal([]), { scope: "person", entityId: null, departmentId: null }, { ...huy, managerId: "me" })).toBe(false);
  });
});

describe("check-in data", () => {
  const manager = principal([]);
  const myReport = { ...huy, managerId: "me" };
  const myself = { ...huy, personId: "me" };

  it("keeps work locations with the entity's HR", () => {
    expect([hrAdmin, mediaHr, head, employee].map((who) => canManageLocation(who, "media"))).toEqual([true, true, false, false]);
    expect(canManageLocation(mediaHr, "creative")).toBe(false);
  });

  it("shows where someone checked in to the person, the line manager and HR in scope — not to colleagues or a department head", () => {
    expect(canSeePunchDetailOf(employee, myself)).toBe(true);
    expect(canSeePunchDetailOf(manager, myReport)).toBe(true);
    expect(canSeePunchDetailOf(mediaHr, huy)).toBe(true);
    expect(canSeePunchDetailOf(mediaHr, lan)).toBe(false);
    expect(canSeePunchDetailOf(employee, huy)).toBe(false);
    expect(canSeePunchDetailOf(head, huy)).toBe(false);
  });

  it("lets the line manager or HR review a flagged punch, never the person themselves", () => {
    expect(canReviewPunchOf(manager, myReport)).toBe(true);
    expect(canReviewPunchOf(mediaHr, huy)).toBe(true);
    expect(canReviewPunchOf(hrAdmin, lan)).toBe(true);
    expect(canReviewPunchOf(mediaHr, lan)).toBe(false);
    expect(canReviewPunchOf(employee, huy)).toBe(false);
    expect(canReviewPunchOf(head, huy)).toBe(false);
    expect(canReviewPunchOf(hrAdmin, { ...myself, entityId: "media" })).toBe(false);
  });
});

describe("timesheets and time clocks", () => {
  const long = principal([]);
  long.personId = "long";
  const colleague = principal([]);
  colleague.personId = "nhu";

  it("shows a timesheet to the person, the line manager, the department head and HR in scope — never colleagues", () => {
    const me = principal([]);
    me.personId = "huy";
    expect([me, long, head, mediaHr, hrAdmin].map((viewer) => canSeeTimesheetOf(viewer, huy))).toEqual([true, true, true, true, true]);
    expect([colleague, employee].map((viewer) => canSeeTimesheetOf(viewer, huy))).toEqual([false, false]);
    expect([head, mediaHr].map((viewer) => canSeeTimesheetOf(viewer, lan))).toEqual([false, false]);
  });

  it("keeps clocks, ID maps, log imports and the recompute with the entity's HR", () => {
    expect([hrAdmin, mediaHr, head, employee].map((viewer) => canManageDevices(viewer, "media"))).toEqual([true, true, false, false]);
    expect(canManageDevices(mediaHr, "creative")).toBe(false);
  });
});
