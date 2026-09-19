import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import { canManageInstance, canManageLibrary, canManageOps, canReadOps, canViewInstance, canWorkInstance, opsReach } from "./policy";

const SZM = "00000000-0000-4000-8000-000000000001";
const SZC = "00000000-0000-4000-8000-000000000002";
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const finance = principal("finance", [{ role: "finance", scope: { type: "group" } }]);
const hrStaff = principal("hr", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const ceo = principal("ceo", [{ role: "c_level", scope: { type: "group" } }]);
const director = principal("director", [{ role: "entity_director", scope: { type: "entity", id: SZC } }]);
const head = principal("head", [{ role: "department_head", scope: { type: "department", id: "d" } }]);
const employee = principal("employee");

const instance = (entityId: string, assigneePersonId: string | null = null, reviewerPersonId: string | null = null) => ({ entityId, assigneePersonId, reviewerPersonId });

describe("ops policy", () => {
  it("reading takes ops:read or ops:manage over the entity", () => {
    expect(canReadOps(owner, SZM)).toBe(true);
    expect(canReadOps(finance, SZC)).toBe(true);
    expect(canReadOps(ceo, SZM)).toBe(true);
    expect(canReadOps(hrStaff, SZM)).toBe(true);
    expect(canReadOps(hrStaff, SZC)).toBe(false);
    expect(canReadOps(director, SZC)).toBe(true);
    expect(canReadOps(director, SZM)).toBe(false);
    expect(canReadOps(head, SZM)).toBe(false);
    expect(canReadOps(employee, SZM)).toBe(false);
  });

  it("navigation: anyone who reads somewhere", () => {
    expect([owner, finance, hrStaff, ceo, director].every((who) => canReadOps(who))).toBe(true);
    expect(canReadOps(head) || canReadOps(employee)).toBe(false);
  });

  it("managing takes ops:manage — readers only read", () => {
    expect(canManageOps(finance, SZM)).toBe(true);
    expect(canManageOps(hrStaff, SZM)).toBe(true);
    expect(canManageOps(hrStaff, SZC)).toBe(false);
    expect(canManageOps(ceo, SZM)).toBe(false);
    expect(canManageOps(director, SZC)).toBe(false);
    expect(canManageInstance(ceo, instance(SZM, "ceo"))).toBe(false);
  });

  it("the library is the group's: an entity-scoped manager may not change it", () => {
    expect(canManageLibrary(owner)).toBe(true);
    expect(canManageLibrary(finance)).toBe(true);
    expect(canManageLibrary(hrStaff)).toBe(false);
    expect(canManageLibrary(ceo)).toBe(false);
  });

  it("the owner of an instance sees and works it without any grant; the reviewer sees it", () => {
    expect(canViewInstance(employee, instance(SZM, "employee"))).toBe(true);
    expect(canWorkInstance(employee, instance(SZM, "employee"))).toBe(true);
    expect(canManageInstance(employee, instance(SZM, "employee"))).toBe(false);
    expect(canViewInstance(employee, instance(SZM, "someone", "employee"))).toBe(true);
    expect(canWorkInstance(employee, instance(SZM, "someone", "employee"))).toBe(false);
    expect(canViewInstance(employee, instance(SZM, "someone"))).toBe(false);
    // The CEO signs the payroll: a reader who is the assignee completes their own step.
    expect(canWorkInstance(ceo, instance(SZM, "ceo"))).toBe(true);
    expect(canWorkInstance(ceo, instance(SZM, "finance"))).toBe(false);
  });

  it("the reach lists the entities read or managed", () => {
    expect(opsReach(owner)).toEqual({ all: true });
    expect(opsReach(ceo)).toEqual({ all: true });
    expect(opsReach(hrStaff)).toEqual({ all: false, entityIds: [SZM] });
    expect(opsReach(director)).toEqual({ all: false, entityIds: [SZC] });
    expect(opsReach(employee)).toEqual({ all: false, entityIds: [] });
  });
});
