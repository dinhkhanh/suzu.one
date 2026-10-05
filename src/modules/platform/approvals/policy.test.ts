import { describe, expect, it } from "vitest";
import { canDelegateFor, canOverseeRequests, canReassignTurns, canWithdraw, withdrawnHere } from "./policy";

describe("canWithdraw", () => {
  it("lets the requester take back a type with no row of its own, until it is decided", () => {
    expect(canWithdraw({ type: "resignation", requesterPersonId: "huy", status: "pending" }, "huy")).toBe(true);
    expect(canWithdraw({ type: "request:expense", requesterPersonId: "huy", status: "returned" }, "huy")).toBe(true);
    expect(canWithdraw({ type: "profile_change", requesterPersonId: "huy", status: "approved" }, "huy")).toBe(false);
    expect(canWithdraw({ type: "resignation", requesterPersonId: "huy", status: "pending" }, "mai")).toBe(false);
  });

  it("refuses the types a module takes back through its own cancel action", () => {
    for (const type of ["leave", "salary_change", "attendance_correction", "offer", "hiring", "kb_publish", "project_change", "project_brief", "crm_quote", "something_new"]) {
      expect(withdrawnHere(type)).toBe(false);
      expect(canWithdraw({ type, requesterPersonId: "huy", status: "pending" }, "huy")).toBe(false);
    }
  });
});

describe("moving a turn and delegating for someone else (PLT-02)", () => {
  const owner = { personId: "khanh", workforceType: null, grants: [{ role: "owner" as const, scope: { type: "group" as const } }] };
  const hr = { personId: "mai", workforceType: null, grants: [{ role: "hr_staff" as const, scope: { type: "entity" as const, id: "entity-a" } }] };
  const head = { personId: "long", workforceType: null, grants: [{ role: "department_head" as const, scope: { type: "unit" as const, id: "unit-video" } }] };
  const huy = { personId: "huy", entityId: "entity-a", unitPath: ["unit-video"], managerId: "long" };
  const request = { requesterPersonId: "huy", subjectPersonId: "huy" };

  it("lets whoever holds person:manage over the request's subject reassign, and the owner everywhere", () => {
    expect(canReassignTurns(hr, request, huy)).toBe(true);
    expect(canReassignTurns(owner, request, huy)).toBe(true);
    expect(canReassignTurns(hr, request, { ...huy, entityId: "entity-b" })).toBe(false);
    // The line manager and the department head approve; they do not choose who else does.
    expect(canReassignTurns(head, request, huy)).toBe(false);
    expect(canReassignTurns({ personId: "tam", workforceType: null, grants: [] }, request, huy)).toBe(false);
    // Deny by default: a request whose subject cannot be placed is nobody's to move.
    expect(canReassignTurns(owner, request, null)).toBe(false);
  });

  it("never lets someone choose the approver of a request they filed or are the subject of", () => {
    expect(canReassignTurns(owner, { requesterPersonId: "khanh", subjectPersonId: null }, huy)).toBe(false);
    expect(canReassignTurns(hr, { requesterPersonId: "huy", subjectPersonId: "mai" }, huy)).toBe(false);
    expect(canReassignTurns({ ...hr, personId: null }, request, huy)).toBe(false);
  });

  it("lets HR over a person set a delegation in their name, never in one's own", () => {
    expect(canDelegateFor(hr, huy)).toBe(true);
    expect(canDelegateFor(owner, huy)).toBe(true);
    expect(canDelegateFor(head, huy)).toBe(false);
    expect(canDelegateFor(hr, { ...huy, entityId: "entity-b" })).toBe(false);
    expect(canDelegateFor(hr, { ...huy, personId: "mai" })).toBe(false);
    expect(canDelegateFor(owner, null)).toBe(false);
  });
});

describe("canOverseeRequests", () => {
  const owner = { personId: "khanh", workforceType: null, grants: [{ role: "owner" as const, scope: { type: "group" as const } }] };
  const cLevel = { personId: "an", workforceType: null, grants: [{ role: "c_level" as const, scope: { type: "group" as const } }] };

  it("lets a group owner follow every request, with or without an entity", () => {
    expect(canOverseeRequests(owner)).toBe(true);
    expect(canOverseeRequests(owner, { entityId: "entity-a" })).toBe(true);
    expect(canOverseeRequests(owner, { entityId: null })).toBe(true);
  });

  it("does not open other people's requests to anyone else", () => {
    expect(canOverseeRequests(cLevel)).toBe(false);
    expect(canOverseeRequests(cLevel, { entityId: "entity-a" })).toBe(false);
  });
});
