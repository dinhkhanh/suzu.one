import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canActForOwnData, canAnonymise, canSeeRetentionList } from "./policy";

const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";
const principal = (grants: Grant[]): Principal => ({ personId: "me", workforceType: "employee", grants });
const leaverOfA = { personId: "leaver", entityId: ENTITY_A, unitPath: ["dept-design"], managerId: null };

describe("privacy policy", () => {
  it("lets a person export and answer for their own data, never while seeing the app as somebody else", () => {
    expect(canActForOwnData({ impersonator: null })).toBe(true);
    expect(canActForOwnData({ impersonator: { personId: "owner" } })).toBe(false);
  });

  it("shows the retention list to whoever keeps people's records", () => {
    expect(canSeeRetentionList(principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]))).toBe(true);
    expect(canSeeRetentionList(principal([{ role: "owner", scope: { type: "group" } }]))).toBe(true);
    for (const role of ["payroll", "finance", "department_head", "auditor"] as const) expect(canSeeRetentionList(principal([{ role, scope: { type: "group" } }])), role).toBe(false);
    expect(canSeeRetentionList(principal([]))).toBe(false);
  });

  it("lets HR of the person's entity anonymise them — not another entity's HR, not readers, not themselves", () => {
    expect(canAnonymise(principal([{ role: "hr_admin", scope: { type: "entity", id: ENTITY_A } }]), leaverOfA)).toBe(true);
    expect(canAnonymise(principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]), leaverOfA)).toBe(true);
    expect(canAnonymise(principal([{ role: "owner", scope: { type: "group" } }]), leaverOfA)).toBe(true);
    expect(canAnonymise(principal([{ role: "hr_admin", scope: { type: "entity", id: ENTITY_B } }]), leaverOfA)).toBe(false);
    expect(canAnonymise(principal([{ role: "payroll", scope: { type: "group" } }]), leaverOfA)).toBe(false);
    expect(canAnonymise(principal([{ role: "department_head", scope: { type: "unit", id: "dept-design" } }]), leaverOfA)).toBe(false);
    expect(canAnonymise(principal([{ role: "owner", scope: { type: "group" } }]), { ...leaverOfA, personId: "me" })).toBe(false);
    expect(canAnonymise(principal([{ role: "owner", scope: { type: "group" } }]), null)).toBe(false);
  });
});
