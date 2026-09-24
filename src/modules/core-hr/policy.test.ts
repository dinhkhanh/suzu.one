import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canBrowsePeople, canDecideProfileChange, canEditPerson, canFilterByPersonalFacts, canHireInto, canManageRecords, canReadRecords, canReassign } from "./policy";

const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";

function principal(grants: Grant[], overrides: Partial<Principal> = {}): Principal {
  return { personId: "me", workforceType: "employee", grants, ...overrides };
}

const owner = principal([{ role: "owner", scope: { type: "group" } }]);
const hrOfA = principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]);
const head = principal([{ role: "department_head", scope: { type: "unit", id: "dept-design" } }]);

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
    expect(canHireInto(head, { entityId: ENTITY_A, unitPath: ["dept-design"] })).toBe(false);
    expect(canHireInto(principal([]), { entityId: ENTITY_A })).toBe(false);
  });

  it("needs authority over both ends of a reassignment", () => {
    expect(canReassign(hrOfA, { entityId: ENTITY_A }, { entityId: ENTITY_A, unitPath: ["dept-video"] })).toBe(true);
    expect(canReassign(hrOfA, { entityId: ENTITY_B }, { entityId: ENTITY_A })).toBe(false);
    // A move to another entity needs HR of both.
    expect(canReassign(hrOfA, { entityId: ENTITY_A }, { entityId: ENTITY_B })).toBe(false);
    const hrOfBoth = principal([...hrOfA.grants, { role: "hr_staff", scope: { type: "entity", id: ENTITY_B } }]);
    expect(canReassign(hrOfBoth, { entityId: ENTITY_A }, { entityId: ENTITY_B })).toBe(true);
    expect(canReassign(owner, { entityId: ENTITY_A }, { entityId: ENTITY_B })).toBe(true);
  });

  it("does not let HR take over a role holder's account by re-pointing their work email", () => {
    const target = { entityId: ENTITY_A };
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: false, targetHoldsRoles: true })).toBe(true);
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: true, targetHoldsRoles: false })).toBe(true);
    expect(canEditPerson(hrOfA, target, { changesWorkEmail: true, targetHoldsRoles: true })).toBe(false);
    expect(canEditPerson(owner, target, { changesWorkEmail: true, targetHoldsRoles: true })).toBe(true);
  });

  // A person in entity A, department "dept-design", reporting to "their-manager".
  const someone = { personId: "someone", entityId: ENTITY_A, unitPath: ["dept-design"], managerId: "their-manager" };
  const hrAdmin = principal([{ role: "hr_admin", scope: { type: "group" } }]);
  const lineManager = principal([], { personId: "their-manager" });

  it("never shows a line manager or department head restricted or compensation records", () => {
    for (const viewer of [lineManager, head]) {
      expect(canReadRecords(viewer, someone, "personal")).toBe(true);
      expect(canReadRecords(viewer, someone, "restricted")).toBe(false);
      expect(canReadRecords(viewer, someone, "compensation")).toBe(false);
    }
    // Being both changes nothing.
    expect(canReadRecords({ ...head, personId: "their-manager" }, someone, "restricted")).toBe(false);
    expect(canReadRecords(principal([]), someone, "personal")).toBe(false);
    expect(canReadRecords(owner, null, "personal")).toBe(false);
  });

  it("lets people read all of their own records, but not write them", () => {
    const self = principal([], { personId: "someone" });
    expect(canReadRecords(self, someone, "compensation")).toBe(true);
    expect(canManageRecords(self, someone, "personal")).toBe(false);
  });

  it("lets HR write only what HR may read: entity HR staff stop at restricted", () => {
    expect(canManageRecords(hrOfA, someone, "restricted")).toBe(true);
    expect(canManageRecords(hrOfA, someone, "compensation")).toBe(false);
    expect(canManageRecords(hrOfA, { ...someone, entityId: ENTITY_B }, "personal")).toBe(false);
    expect(canManageRecords(hrAdmin, someone, "compensation")).toBe(true);
    // Reads compensation, but holds no person:manage.
    expect(canManageRecords(principal([{ role: "finance", scope: { type: "group" } }]), someone, "personal")).toBe(false);
    expect(canManageRecords(lineManager, someone, "personal")).toBe(false);
  });

  it("lets only HR over the person answer their change requests — never the line manager, never the person", () => {
    for (const hasRestricted of [false, true]) {
      expect(canDecideProfileChange(hrOfA, someone, { hasRestricted })).toBe(true);
      expect(canDecideProfileChange(hrAdmin, someone, { hasRestricted })).toBe(true);
      expect(canDecideProfileChange(lineManager, someone, { hasRestricted })).toBe(false);
      expect(canDecideProfileChange(head, someone, { hasRestricted })).toBe(false);
      expect(canDecideProfileChange(hrOfA, { ...someone, entityId: ENTITY_B }, { hasRestricted })).toBe(false);
      // HR staff asking for a change to their own record are not their own approver.
      expect(canDecideProfileChange({ ...hrOfA, personId: "someone" }, someone, { hasRestricted })).toBe(false);
      expect(canDecideProfileChange(owner, null, { hasRestricted })).toBe(false);
    }
  });
});
