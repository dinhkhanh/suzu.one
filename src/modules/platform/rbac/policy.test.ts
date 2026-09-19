import { describe, expect, it } from "vitest";
import { can, canReadTier, readableTier, type Grant, type Principal } from "./policy";

const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";
const DESIGN = "dept-design";

function principal(grants: Grant[], overrides: Partial<Principal> = {}): Principal {
  return { personId: "me", workforceType: "employee", grants, ...overrides };
}

const lan = { personId: "lan", entityId: ENTITY_A, departmentId: DESIGN, managerId: "manager-1" };

describe("can", () => {
  it("gives the owner everything, everywhere", () => {
    const owner = principal([{ role: "owner", scope: { type: "group" } }]);
    expect(can(owner, "payroll:rules", { entityId: ENTITY_B })).toBe(true);
    expect(can(owner, "rbac:manage")).toBe(true);
  });

  it("confines an entity-scoped role to its entity", () => {
    const hr = principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]);
    expect(can(hr, "person:manage", { entityId: ENTITY_A })).toBe(true);
    expect(can(hr, "person:manage", { entityId: ENTITY_B })).toBe(false);
  });

  it("supports several role + scope pairs on one person", () => {
    const mixed = principal([
      { role: "hr_staff", scope: { type: "entity", id: ENTITY_A } },
      { role: "recruiter", scope: { type: "entity", id: ENTITY_B } },
    ]);
    expect(can(mixed, "recruit:manage", { entityId: ENTITY_B })).toBe(true);
    expect(can(mixed, "person:manage", { entityId: ENTITY_B })).toBe(false);
  });

  it("treats an empty target as group-level: only group-wide grants cover it", () => {
    const entityHr = principal([{ role: "hr_admin", scope: { type: "entity", id: ENTITY_A } }]);
    const groupHr = principal([{ role: "hr_admin", scope: { type: "group" } }]);
    expect(can(entityHr, "org:manage", {})).toBe(false);
    expect(can(groupHr, "org:manage", {})).toBe(true);
  });

  it("denies by default", () => {
    expect(can(principal([]), "org:read", { entityId: ENTITY_A })).toBe(false);
    expect(can(principal([]), "org:read")).toBe(false);
  });

  it("separates the payroll duties: HR proposes, CEO approves, finance pays, only the owner sets rules", () => {
    const group = { type: "group" } as const;
    const hrLead = principal([{ role: "hr_admin", scope: group }]);
    const ceo = principal([{ role: "c_level", scope: group }]);
    const accountant = principal([{ role: "finance", scope: group }]);
    for (const [who, propose, approve, pay] of [
      [hrLead, true, false, false],
      [ceo, false, true, false],
      [accountant, false, false, true],
    ] as const) {
      expect(can(who, "payroll:propose")).toBe(propose);
      expect(can(who, "payroll:approve")).toBe(approve);
      expect(can(who, "payroll:pay")).toBe(pay);
      expect(can(who, "payroll:rules")).toBe(false);
    }
  });
});

describe("readableTier", () => {
  it("lets everyone read their own compensation", () => {
    expect(readableTier(principal([], { personId: "lan" }), lan)).toBe("compensation");
  });

  it("gives colleagues only the internal directory tier", () => {
    expect(readableTier(principal([]), lan)).toBe("public_internal");
  });

  it("gives a line manager personal data but never compensation", () => {
    const manager = principal([], { personId: "manager-1" });
    expect(readableTier(manager, lan)).toBe("personal");
    expect(canReadTier(manager, lan, "restricted")).toBe(false);
    expect(canReadTier(manager, lan, "compensation")).toBe(false);
  });

  it("gives a department head personal data for their department only", () => {
    const head = principal([{ role: "department_head", scope: { type: "department", id: DESIGN } }]);
    expect(readableTier(head, lan)).toBe("personal");
    expect(readableTier(head, { ...lan, departmentId: "dept-video" })).toBe("public_internal");
  });

  it("limits HR staff to restricted data and keeps compensation for payroll roles", () => {
    const hr = principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]);
    const payroll = principal([{ role: "payroll", scope: { type: "entity", id: ENTITY_A } }]);
    expect(readableTier(hr, lan)).toBe("restricted");
    expect(readableTier(payroll, lan)).toBe("compensation");
    expect(readableTier(payroll, { ...lan, entityId: ENTITY_B })).toBe("public_internal");
  });

  it("does not let roles without person:read raise the tier", () => {
    const recruiter = principal([{ role: "recruiter", scope: { type: "group" } }]);
    expect(readableTier(recruiter, lan)).toBe("public_internal");
  });

  it("gives collaborators no directory access, only themselves", () => {
    const freelancer = principal([], { personId: "ctv", workforceType: "collaborator" });
    expect(readableTier(freelancer, lan)).toBeNull();
    expect(canReadTier(freelancer, lan, "public_internal")).toBe(false);
    expect(readableTier(freelancer, { personId: "ctv" })).toBe("compensation");
  });
});
