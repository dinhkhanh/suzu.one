import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canAssignSchedule, canManageAttendanceConfig, canOpenAttendanceSettings } from "./policy";

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
