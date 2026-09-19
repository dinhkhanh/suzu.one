// Who may do what with leave: own requests need nothing, the rest is `leave:manage` in scope,
// and the reason for someone's absence is personal-tier.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canFileLeaveFor, canManageLeaveConfig, canManageLeaveOf, canOpenLeaveAdmin, canSeeBalancesOf, seesLeaveTypeOf } from "./policy";

const MEDIA = "entity-media";
const CREATIVE = "entity-creative";
const VIDEO = "department-video";
const principal = (personId: string, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });

const huy = { personId: "huy", entityId: MEDIA, departmentId: VIDEO, teamId: null, managerId: "long" };
const employee = principal("huy");
const colleague = principal("linh");
const manager = principal("long", [{ role: "department_head", scope: { type: "department", id: VIDEO } }]);
const plainManager = principal("long");
const mediaHr = principal("bao", [{ role: "hr_staff", scope: { type: "entity", id: MEDIA } }]);
const creativeHr = principal("chi", [{ role: "hr_staff", scope: { type: "entity", id: CREATIVE } }]);
const hrAdmin = principal("mai", [{ role: "hr_admin", scope: { type: "group" } }]);
const finance = principal("tuan", [{ role: "finance", scope: { type: "group" } }]);
const owner = principal("khanh", [{ role: "owner", scope: { type: "group" } }]);

describe("leave administration", () => {
  it("opens for whoever holds leave:manage somewhere", () => {
    expect([employee, manager, finance].map(canOpenLeaveAdmin)).toEqual([false, false, false]);
    expect([mediaHr, hrAdmin, owner].map(canOpenLeaveAdmin)).toEqual([true, true, true]);
  });

  it("keeps group-wide types and policies for a group-wide grant", () => {
    expect(canManageLeaveConfig(mediaHr, MEDIA)).toBe(true);
    expect(canManageLeaveConfig(mediaHr, CREATIVE)).toBe(false);
    expect(canManageLeaveConfig(mediaHr, null)).toBe(false);
    expect(canManageLeaveConfig(hrAdmin, null)).toBe(true);
    expect(canManageLeaveConfig(manager, MEDIA)).toBe(false);
  });
});

describe("someone's leave", () => {
  it("is HR's within their scope: adjust, cancel, file on behalf", () => {
    expect(canManageLeaveOf(mediaHr, huy)).toBe(true);
    expect(canManageLeaveOf(creativeHr, huy)).toBe(false);
    expect(canManageLeaveOf(manager, huy)).toBe(false);
    expect(canManageLeaveOf(employee, huy)).toBe(false);
  });

  it("is filed by the person themselves or by their HR — not by the manager or a colleague", () => {
    expect(canFileLeaveFor(employee, huy)).toBe(true);
    expect(canFileLeaveFor(mediaHr, huy)).toBe(true);
    expect(canFileLeaveFor(plainManager, huy)).toBe(false);
    expect(canFileLeaveFor(colleague, huy)).toBe(false);
    expect(canFileLeaveFor(creativeHr, huy)).toBe(false);
  });

  it("shows balances to the person, the line manager and HR", () => {
    expect([employee, plainManager, mediaHr, owner].map((viewer) => canSeeBalancesOf(viewer, huy))).toEqual([true, true, true, true]);
    expect([colleague, creativeHr, finance].map((viewer) => canSeeBalancesOf(viewer, huy))).toEqual([false, false, false]);
  });

  it("tells why someone is away only to those who read their personal data", () => {
    expect([employee, plainManager, manager, mediaHr, hrAdmin].map((viewer) => seesLeaveTypeOf(viewer, huy))).toEqual([true, true, true, true, true]);
    expect([colleague, creativeHr].map((viewer) => seesLeaveTypeOf(viewer, huy))).toEqual([false, false]);
    expect(seesLeaveTypeOf(principal("anh", [], "collaborator"), huy)).toBe(false);
  });
});
