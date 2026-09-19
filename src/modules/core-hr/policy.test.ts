import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canBrowsePeople, canEditPerson, canFilterByPersonalFacts, canHireInto, canReassign } from "./policy";

const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";

function principal(grants: Grant[], overrides: Partial<Principal> = {}): Principal {
  return { personId: "me", workforceType: "employee", grants, ...overrides };
}

const owner = principal([{ role: "owner", scope: { type: "group" } }]);
const hrOfA = principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]);
const head = principal([{ role: "department_head", scope: { type: "department", id: "dept-design" } }]);

describe("core HR policy", () => {
  it("keeps collaborators out of the people list", () => {
    expect(canBrowsePeople(principal([]))).toBe(true);
    expect(canBrowsePeople(principal([], { workforceType: "collaborator" }))).toBe(false);
  });

  it("offers personal-fact filters to people readers only", () => {
    expect(canFilterByPersonalFacts(principal([]))).toBe(false);
    expect(canFilterByPersonalFacts(head)).toBe(true);
    // Holds person:read, but only at the directory tier.
    expect(canFilterByPersonalFacts(principal([{ role: "asset_admin", scope: { type: "group" } }]))).toBe(false);
  });

  it("lets entity HR hire into its own entity only; readers cannot hire", () => {
    expect(canHireInto(hrOfA, { entityId: ENTITY_A })).toBe(true);
    expect(canHireInto(hrOfA, { entityId: ENTITY_B })).toBe(false);
    expect(canHireInto(head, { entityId: ENTITY_A, departmentId: "dept-design" })).toBe(false);
    expect(canHireInto(principal([]), { entityId: ENTITY_A })).toBe(false);
  });

  it("needs authority over both ends of a reassignment", () => {
    expect(canReassign(hrOfA, { entityId: ENTITY_A }, { entityId: ENTITY_A, departmentId: "dept-video" })).toBe(true);
    expect(canReassign(hrOfA, { entityId: ENTITY_B }, { entityId: ENTITY_A })).toBe(false);
  });

  it("does not let HR take over a role holder's account by re-pointing their work email", () => {
    const target = { entityId: ENTITY_A };
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: false, targetHoldsRoles: true })).toBe(true);
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: true, targetHoldsRoles: false })).toBe(true);
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: true, targetHoldsRoles: true })).toBe(false);
    expect(canEditPerson(owner, target, { changesWorkEmail: true, targetHoldsRoles: true })).toBe(true);
  });
});
