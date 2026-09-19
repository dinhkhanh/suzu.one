import { describe, expect, it } from "vitest";
import { can, canReadTier, entityReach, matchesReach, permissionReach, reachesNothing, readableTier, tierReach, type Grant, type Principal } from "./policy";
import { ROLES, TIERS } from "./roles";

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

describe("tierReach", () => {
  it("agrees with canReadTier for every role, scope, tier and target", () => {
    const TEAM = "team-ui";
    const scopes = [
      { type: "group" },
      { type: "entity", id: ENTITY_A },
      { type: "department", id: DESIGN },
      { type: "team", id: TEAM },
    ] as const;
    const principals = [
      principal([]),
      principal([], { personId: "manager-1" }),
      principal([], { personId: "ctv", workforceType: "collaborator" }),
      principal([], { personId: "manager-1", workforceType: "collaborator" }),
      ...ROLES.flatMap((role) => scopes.map((scope) => principal([{ role, scope }]))),
    ];
    const targets = [
      lan,
      { ...lan, teamId: TEAM },
      { ...lan, entityId: ENTITY_B, departmentId: "dept-video", managerId: null },
      { personId: "loose", entityId: null, departmentId: null, teamId: null, managerId: null },
    ];
    for (const who of principals) {
      for (const tier of TIERS) {
        const reach = tierReach(who, tier);
        for (const target of targets) {
          expect(matchesReach(reach, target), `${JSON.stringify(who)} ${tier} ${target.personId}`).toBe(canReadTier(who, target, tier));
        }
      }
    }
  });

  it("never reaches compensation through the manager line", () => {
    const manager = principal([], { personId: "manager-1" });
    expect(tierReach(manager, "personal")).toMatchObject({ all: false, managerOf: "manager-1" });
    expect(tierReach(manager, "restricted")).toMatchObject({ all: false, managerOf: null });
    expect(tierReach(manager, "compensation")).toMatchObject({ all: false, managerOf: null });
  });
});

describe("entityReach", () => {
  const grants = (...list: Grant[]): Principal => ({ personId: "viewer", workforceType: "employee", grants: list });

  it("agrees with can() for every role, scope and entity", () => {
    const scopes: Grant["scope"][] = [{ type: "group" }, { type: "entity", id: ENTITY_A }, { type: "department", id: DESIGN }, { type: "team", id: "team-1" }];
    for (const role of ROLES) {
      for (const scope of scopes) {
        const principal = grants({ role, scope });
        const reach = entityReach(principal, "audit:read");
        for (const entityId of [ENTITY_A, ENTITY_B]) {
          const reached = reach.all || reach.entityIds.includes(entityId);
          // Only the entity is known about an audit entry, so that is all can() is told.
          expect(reached, `${role} ${scope.type} ${entityId}`).toBe(can(principal, "audit:read", { entityId }));
        }
      }
    }
  });

  it("gives an entity HR admin their entity only, and someone without the permission nothing", () => {
    expect(entityReach(grants({ role: "hr_admin", scope: { type: "entity", id: ENTITY_A } }), "audit:read")).toEqual({ all: false, entityIds: [ENTITY_A] });
    expect(entityReach(grants({ role: "hr_staff", scope: { type: "group" } }), "audit:read")).toEqual({ all: false, entityIds: [] });
    expect(entityReach(grants({ role: "auditor", scope: { type: "group" } }), "audit:read")).toEqual({ all: true });
  });
});

describe("rule governance (FR-PLT-39)", () => {
  const holder = (role: Grant["role"], scope: Grant["scope"] = { type: "group" }): Principal => ({ personId: "viewer", workforceType: "employee", grants: [{ role, scope }] });

  it("lets HR and C&B propose rule changes but only the owner decide them", () => {
    for (const role of ROLES) {
      expect(can(holder(role), "payroll:rules", {}), role).toBe(role === "owner");
      expect(can(holder(role), "rules:propose", {}), role).toBe(["owner", "hr_admin", "payroll"].includes(role));
    }
  });

  it("treats the rules as group-wide: an entity-scoped grant cannot touch them", () => {
    expect(can(holder("hr_admin", { type: "entity", id: ENTITY_A }), "rules:propose", {})).toBe(false);
  });
});

describe("permissionReach", () => {
  it("agrees with can() for every role, scope, permission and target", () => {
    const TEAM = "team-ui";
    const scopes = [{ type: "group" }, { type: "entity", id: ENTITY_A }, { type: "department", id: DESIGN }, { type: "team", id: TEAM }] as const;
    const permissions = ["report:read", "person:manage", "person:read", "audit:read", "payroll:read"] as const;
    const targets = [lan, { ...lan, teamId: TEAM }, { ...lan, entityId: ENTITY_B, departmentId: "dept-video" }, { personId: "loose", entityId: null, departmentId: null, teamId: null, managerId: null }];
    for (const role of ROLES) {
      for (const scope of scopes) {
        // The viewer is also lan's line manager: that must never widen a permission.
        const who = principal([{ role, scope }], { personId: lan.managerId });
        for (const permission of permissions) {
          const reach = permissionReach(who, permission);
          for (const target of targets) expect(matchesReach(reach, target), `${role} ${scope.type} ${permission} ${target.personId}`).toBe(can(who, permission, target));
        }
      }
    }
  });

  it("is empty without a grant that carries the permission", () => {
    expect(reachesNothing(permissionReach(principal([]), "report:read"))).toBe(true);
    expect(reachesNothing(permissionReach(principal([{ role: "recruiter", scope: { type: "group" } }]), "report:read"))).toBe(true);
    expect(permissionReach(principal([{ role: "department_head", scope: { type: "department", id: DESIGN } }]), "report:read")).toMatchObject({ all: false, departmentIds: [DESIGN], entityIds: [] });
  });
});
