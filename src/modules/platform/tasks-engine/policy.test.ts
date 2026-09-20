import { describe, expect, it } from "vitest";
import type { Principal } from "../rbac/policy";
import { canManageTask, canManageTemplates, canMoveTask, canViewTask, movesThroughEngine } from "./policy";

const person = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const task = { kind: "checklist", entityId: "SZM", assigneePersonId: "assignee", subjectPersonId: "subject", createdByPersonId: "creator" };
const hrOf = (entityId: string) => person("hr", [{ role: "hr_staff", scope: { type: "entity", id: entityId } }]);

describe("task policy", () => {
  it("lets the assignee move their own task, and nobody else's", () => {
    expect(canMoveTask(person("assignee"), task)).toBe(true);
    expect(canMoveTask(person("someone"), task)).toBe(false);
    expect(canManageTask(person("assignee"), task)).toBe(false);
  });
  it("lets whoever manages the kind in the task's entity do anything", () => {
    expect(canManageTask(hrOf("SZM"), task)).toBe(true);
    expect(canManageTask(hrOf("SZC"), task)).toBe(false);
    expect(canMoveTask(hrOf("SZM"), task)).toBe(true);
    // A department head reads people but does not manage them.
    expect(canManageTask(person("head", [{ role: "department_head", scope: { type: "entity", id: "SZM" } }]), task)).toBe(false);
  });
  it("has no manager for a kind nobody registered", () => {
    expect(canManageTask(person("owner", [{ role: "owner", scope: { type: "group" } }]), { ...task, kind: "unknown" })).toBe(false);
  });
  it("names a manager for work tasks and obligations, and keeps them out of the generic actions", () => {
    const head = person("head", [{ role: "department_head", scope: { type: "entity", id: "SZM" } }]);
    const finance = person("fin", [{ role: "finance", scope: { type: "entity", id: "SZM" } }]);
    expect(canManageTask(head, { ...task, kind: "work" })).toBe(true);
    expect(canManageTask(hrOf("SZM"), { ...task, kind: "work" })).toBe(false);
    expect(canManageTask(finance, { ...task, kind: "obligation" })).toBe(true);
    expect(canManageTask(head, { ...task, kind: "obligation" })).toBe(false);
    expect(movesThroughEngine(task)).toBe(true);
    expect(movesThroughEngine({ kind: "work" })).toBe(false);
    expect(movesThroughEngine({ kind: "obligation" })).toBe(false);
  });
  it("lets the subject and the creator look, not touch", () => {
    for (const id of ["subject", "creator"]) {
      expect(canViewTask(person(id), task)).toBe(true);
      expect(canMoveTask(person(id), task)).toBe(false);
    }
    expect(canViewTask(person("someone"), task)).toBe(false);
  });
  it("keeps shared templates for group-wide HR, entity templates for that entity's HR", () => {
    const groupHr = person("mai", [{ role: "hr_admin", scope: { type: "group" } }]);
    expect(canManageTemplates(hrOf("SZM"))).toBe(true);
    expect(canManageTemplates(hrOf("SZM"), { entityId: "SZM" })).toBe(true);
    expect(canManageTemplates(hrOf("SZM"), { entityId: null })).toBe(false);
    expect(canManageTemplates(hrOf("SZM"), { entityId: "SZC" })).toBe(false);
    expect(canManageTemplates(groupHr, { entityId: null })).toBe(true);
    expect(canManageTemplates(person("huy"))).toBe(false);
  });
});
