import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import {
  canBrowsePeople,
  canChangePhoto,
  canEditCompetencies,
  canManageCompetencies,
  canDecideProfileChange,
  canEditPerson,
  canFilterByPersonalFacts,
  canHireInto,
  canManagePositions,
  canManageRecords,
  canReadRecords,
  canReassign,
  canRemovePerson,
  canSeePhoto,
} from "./policy";

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

  it("lets the person and HR over them change the profile picture — not the line manager", () => {
    expect(canChangePhoto(principal([], { personId: "someone" }), someone)).toBe(true);
    expect(canChangePhoto(hrOfA, someone)).toBe(true);
    expect(canChangePhoto(hrOfA, { ...someone, entityId: ENTITY_B })).toBe(false);
    expect(canChangePhoto(lineManager, someone)).toBe(false);
    expect(canChangePhoto(principal([]), someone)).toBe(false);
    expect(canChangePhoto(owner, null)).toBe(false);
  });

  it("lets the person and HR over them say what the person is good at — not the line manager", () => {
    expect(canEditCompetencies(principal([], { personId: "someone" }), someone)).toBe(true);
    expect(canEditCompetencies(principal([], { personId: "someone", workforceType: "collaborator" }), someone)).toBe(true);
    expect(canEditCompetencies(hrOfA, someone)).toBe(true);
    expect(canEditCompetencies(hrOfA, { ...someone, entityId: ENTITY_B })).toBe(false);
    expect(canEditCompetencies(lineManager, someone)).toBe(false);
    expect(canEditCompetencies(principal([]), someone)).toBe(false);
    expect(canEditCompetencies(owner, null)).toBe(false);
  });

  it("lets whoever keeps people's records correct the shared catalogue — not a manager, not an employee", () => {
    expect(canManageCompetencies(owner)).toBe(true);
    expect(canManageCompetencies(hrOfA)).toBe(true);
    expect(canManageCompetencies(head)).toBe(false);
    expect(canManageCompetencies(lineManager)).toBe(false);
    expect(canManageCompetencies(principal([]))).toBe(false);
  });

  it("shows the picture to whoever sees the directory entry", () => {
    expect(canSeePhoto(principal([]), someone, "active")).toBe(true);
    // Collaborators have no directory.
    expect(canSeePhoto(principal([], { workforceType: "collaborator" }), someone, "active")).toBe(false);
    // Former and future colleagues: personal-tier readers only.
    expect(canSeePhoto(principal([]), someone, "offboarded")).toBe(false);
    expect(canSeePhoto(lineManager, someone, "offboarded")).toBe(true);
    expect(canSeePhoto(hrOfA, someone, "preboarding")).toBe(true);
    expect(canSeePhoto(principal([], { personId: "someone" }), someone, "offboarded")).toBe(true);
    expect(canSeePhoto(owner, null, "active")).toBe(false);
  });

  // CHR-02: a position renamed is renamed for every entity.
  it("leaves the position catalogue to group-wide HR", () => {
    expect(canManagePositions(owner)).toBe(true);
    expect(canManagePositions(principal([{ role: "hr_admin", scope: { type: "group" } }]))).toBe(true);
    expect(canManagePositions(hrOfA)).toBe(false);
    expect(canManagePositions(head)).toBe(false);
    expect(canManagePositions(principal([]))).toBe(false);
  });

  it("lets HR over a person remove one created in error — never themselves, never a manager", () => {
    const target = { personId: "someone", entityId: ENTITY_A, managerId: "boss" };
    expect(canRemovePerson(hrOfA, target)).toBe(true);
    expect(canRemovePerson(hrOfA, { ...target, entityId: ENTITY_B })).toBe(false);
    expect(canRemovePerson(principal([], { personId: "boss" }), target)).toBe(false);
    expect(canRemovePerson(principal([...hrOfA.grants], { personId: "someone" }), target)).toBe(false);
    expect(canRemovePerson(owner, null)).toBe(false);
  });
});
