import { describe, expect, it } from "vitest";
import { can, canImpersonate, canReadTier, entityReach, matchesReach, permissionReach, reachesNothing, readableTier, tierReach, type Grant, type Principal } from "./policy";
import { ROLES, TIERS } from "./roles";

const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";
const DESIGN = "dept-design";
// Design holds a big team, which holds a small one: the depth the tree is allowed (FR-PLT-16).
const SOCIAL = "team-social";
const EDITING = "team-editing";
// A person's chain, root first, as `person.org_unit_path` stores it.
const chain = [DESIGN, SOCIAL, EDITING];

function principal(grants: Grant[], overrides: Partial<Principal> = {}): Principal {
  return { personId: "me", workforceType: "employee", grants, ...overrides };
}

const lan = { personId: "lan", entityId: ENTITY_A, unitPath: [DESIGN], managerId: "manager-1" };

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

describe("work and ops permissions (Phase 3)", () => {
  it("lets leaders run work management in their scope, and nobody else by role", () => {
    const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);
    expect(can(head, "work:manage", { unitPath: [DESIGN], entityId: ENTITY_A })).toBe(true);
    expect(can(head, "work:manage", { unitPath: ["dept-video"], entityId: ENTITY_A })).toBe(false);
    expect(can(principal([{ role: "entity_director", scope: { type: "entity", id: ENTITY_A } }]), "work:manage", { entityId: ENTITY_A })).toBe(true);
    expect(can(principal([{ role: "entity_director", scope: { type: "entity", id: ENTITY_A } }]), "work:manage", { entityId: ENTITY_B })).toBe(false);
    for (const role of ["hr_admin", "hr_staff", "payroll", "finance", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: { type: "group" } }]), "work:manage")).toBe(false);
  });

  it("gives the compliance tracker to HR, C&B and finance; executives and the auditor only read it", () => {
    const group = { type: "group" } as const;
    for (const role of ["hr_admin", "hr_staff", "payroll", "finance"] as const) expect(can(principal([{ role, scope: group }]), "ops:manage")).toBe(true);
    for (const role of ["c_level", "entity_director", "auditor"] as const) {
      expect(can(principal([{ role, scope: group }]), "ops:read")).toBe(true);
      expect(can(principal([{ role, scope: group }]), "ops:manage")).toBe(false);
    }
    for (const role of ["department_head", "recruiter", "asset_admin"] as const) {
      expect(can(principal([{ role, scope: group }]), "ops:read")).toBe(false);
      expect(can(principal([{ role, scope: group }]), "ops:manage")).toBe(false);
    }
    expect(can(principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]), "ops:manage", { entityId: ENTITY_B })).toBe(false);
  });

  it("lets HR run performance, leaders set unit goals and read their people, the auditor only read", () => {
    const group = { type: "group" } as const;
    for (const role of ["hr_admin", "hr_staff"] as const) expect(can(principal([{ role, scope: group }]), "performance:manage")).toBe(true);
    for (const role of ["c_level", "entity_director", "department_head"] as const) {
      expect(can(principal([{ role, scope: group }]), "performance:goals")).toBe(true);
      expect(can(principal([{ role, scope: group }]), "performance:read")).toBe(true);
      expect(can(principal([{ role, scope: group }]), "performance:manage")).toBe(false);
    }
    expect(can(principal([{ role: "auditor", scope: group }]), "performance:read")).toBe(true);
    expect(can(principal([{ role: "auditor", scope: group }]), "performance:goals")).toBe(false);
    for (const role of ["payroll", "finance", "recruiter", "asset_admin"] as const) {
      for (const permission of ["performance:manage", "performance:goals", "performance:read"] as const) expect(can(principal([{ role, scope: group }]), permission)).toBe(false);
    }
    // A department head's grant covers the department's goal, not the group's or another department's.
    const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);
    expect(can(head, "performance:goals", { unitPath: [DESIGN], entityId: ENTITY_A })).toBe(true);
    expect(can(head, "performance:goals", {})).toBe(false);
    expect(can(head, "performance:goals", { unitPath: ["dept-other"] })).toBe(false);
  });

  it("lets HR run the knowledge base, and leaders and HR post announcements within their scope", () => {
    const group = { type: "group" } as const;
    for (const role of ["hr_admin", "hr_staff"] as const) expect(can(principal([{ role, scope: group }]), "kb:manage")).toBe(true);
    for (const role of ["c_level", "entity_director", "department_head", "payroll", "finance", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: group }]), "kb:manage")).toBe(false);
    for (const role of ["c_level", "entity_director", "hr_admin", "hr_staff", "department_head"] as const) expect(can(principal([{ role, scope: group }]), "comms:manage")).toBe(true);
    for (const role of ["payroll", "finance", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: group }]), "comms:manage")).toBe(false);
    // An entity's HR runs that entity's spaces, not the group-wide ones and not another entity's.
    const hr = principal([{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }]);
    expect(can(hr, "kb:manage", { entityId: ENTITY_A })).toBe(true);
    expect(can(hr, "kb:manage", { entityId: null })).toBe(false);
    expect(can(hr, "kb:manage", { entityId: ENTITY_B })).toBe(false);
    // A department head announces to the department, not to the entity.
    const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);
    expect(can(head, "comms:manage", { unitPath: [DESIGN] })).toBe(true);
    expect(can(head, "comms:manage", { entityId: ENTITY_A })).toBe(false);
  });

  it("splits project money from project work (Phase 10): fees, cost rates, portfolio", () => {
    const group = { type: "group" } as const;
    // Fees and the billing queue: leaders and finance; never HR, payroll clerks or department heads.
    for (const role of ["c_level", "entity_director", "finance"] as const) expect(can(principal([{ role, scope: group }]), "pjm:commercial")).toBe(true);
    for (const role of ["hr_admin", "hr_staff", "payroll", "department_head", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: group }]), "pjm:commercial")).toBe(false);
    // Cost rates come from salaries: C-level and finance only — not an entity director (restricted tier).
    for (const role of ["c_level", "finance"] as const) expect(can(principal([{ role, scope: group }]), "pjm:cost")).toBe(true);
    for (const role of ["entity_director", "hr_admin", "hr_staff", "payroll", "department_head", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: group }]), "pjm:cost")).toBe(false);
    // Finance reads the projects it invoices (owner's call, 2026-09-23): without this the billing
    // queue named projects its readers could not open. Payroll and HR have no business in them.
    for (const role of ["c_level", "entity_director", "department_head", "finance"] as const) expect(can(principal([{ role, scope: group }]), "pjm:portfolio")).toBe(true);
    for (const role of ["hr_admin", "hr_staff", "payroll", "recruiter", "asset_admin", "auditor"] as const) expect(can(principal([{ role, scope: group }]), "pjm:portfolio")).toBe(false);
    // A department head's portfolio is the department's, not the entity's.
    const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);
    expect(can(head, "pjm:portfolio", { unitPath: [DESIGN] })).toBe(true);
    expect(can(head, "pjm:portfolio", { entityId: ENTITY_A })).toBe(false);
  });
});

describe("unit scopes reach down the tree (FR-PLT-16)", () => {
  const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);

  it("covers a small team several levels below the unit the grant names", () => {
    expect(can(head, "work:manage", { unitPath: chain, entityId: ENTITY_A })).toBe(true);
    expect(can(head, "work:manage", { unitPath: [DESIGN, SOCIAL], entityId: ENTITY_A })).toBe(true);
    // Sideways, not downwards: another department's small team is out of reach.
    expect(can(head, "work:manage", { unitPath: ["dept-video", "team-shoot"], entityId: ENTITY_A })).toBe(false);
  });

  it("does not reach upwards: the head of a small team is not the head of its department", () => {
    const teamLead = principal([{ role: "department_head", scope: { type: "unit", id: EDITING } }]);
    expect(can(teamLead, "work:manage", { unitPath: chain, entityId: ENTITY_A })).toBe(true);
    expect(can(teamLead, "work:manage", { unitPath: [DESIGN], entityId: ENTITY_A })).toBe(false);
    expect(can(teamLead, "work:manage", { unitPath: [DESIGN, SOCIAL], entityId: ENTITY_A })).toBe(false);
  });

  it("matches a target that knows only its own unit, because the grant carries its subtree", () => {
    // What a job opening or a work team can say about itself: one unit id, no chain.
    const withSubtree = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN, covers: chain } }]);
    expect(can(withSubtree, "work:manage", { unitPath: [EDITING] })).toBe(true);
    expect(can(withSubtree, "work:manage", { unitPath: ["team-shoot"] })).toBe(false);
    // Without the subtree the grant reaches the one unit it names.
    expect(can(head, "work:manage", { unitPath: [EDITING] })).toBe(false);
    expect(can(head, "work:manage", { unitPath: [DESIGN] })).toBe(true);
  });

  it("reads a person below the unit at the role's tier, and a person outside it as a colleague", () => {
    expect(readableTier(head, { ...lan, unitPath: chain })).toBe("personal");
    expect(readableTier(head, { ...lan, unitPath: ["dept-video"] })).toBe("public_internal");
    expect(matchesReach(tierReach(head, "personal"), { ...lan, unitPath: chain })).toBe(true);
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
    const head = principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]);
    expect(readableTier(head, lan)).toBe("personal");
    expect(readableTier(head, { ...lan, unitPath: ["dept-video"] })).toBe("public_internal");
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
      { type: "unit", id: DESIGN },
      { type: "unit", id: TEAM },
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
      { ...lan, unitPath: [DESIGN, TEAM] },
      { ...lan, entityId: ENTITY_B, unitPath: ["dept-video"], managerId: null },
      { personId: "loose", entityId: null, unitPath: [], managerId: null },
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
    const scopes: Grant["scope"][] = [{ type: "group" }, { type: "entity", id: ENTITY_A }, { type: "unit", id: DESIGN }, { type: "unit", id: "team-1" }];
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
    const scopes = [{ type: "group" }, { type: "entity", id: ENTITY_A }, { type: "unit", id: DESIGN }, { type: "unit", id: TEAM }] as const;
    const permissions = ["report:read", "person:manage", "person:read", "audit:read", "payroll:read"] as const;
    const targets = [lan, { ...lan, unitPath: [DESIGN, TEAM] }, { ...lan, entityId: ENTITY_B, unitPath: ["dept-video"] }, { personId: "loose", entityId: null, unitPath: [], managerId: null }];
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
    expect(permissionReach(principal([{ role: "department_head", scope: { type: "unit", id: DESIGN } }]), "report:read")).toMatchObject({ all: false, unitIds: [DESIGN], entityIds: [] });
  });
});

describe("feedback about the app", () => {
  it("lets HR admins triage it, C-level and entity directors read it, and nobody else near it", () => {
    const target = { ...lan };
    expect(can(principal([{ role: "hr_admin", scope: { type: "entity", id: ENTITY_A } }]), "feedback:manage", target)).toBe(true);
    expect(can(principal([{ role: "hr_admin", scope: { type: "entity", id: ENTITY_B } }]), "feedback:manage", target)).toBe(false);
    for (const role of ["c_level", "entity_director"] as const) {
      const reader = principal([{ role, scope: { type: "group" } }]);
      expect(can(reader, "feedback:read", target), role).toBe(true);
      expect(can(reader, "feedback:manage", target), role).toBe(false);
    }
    for (const role of ["hr_staff", "payroll", "finance", "department_head", "recruiter", "asset_admin", "auditor"] as const) {
      const other = principal([{ role, scope: { type: "group" } }]);
      expect(can(other, "feedback:manage", target), role).toBe(false);
      expect(can(other, "feedback:read", target), role).toBe(false);
    }
  });
});

describe("canImpersonate", () => {
  const plainLan = { ...lan, grants: [] as Grant[] };
  const hrLan = { ...lan, grants: [{ role: "hr_staff", scope: { type: "entity", id: ENTITY_A } }] as Grant[] };
  const owner = principal([{ role: "owner", scope: { type: "group" } }]);

  it("lets the owner see the app as anyone, role holder or not", () => {
    expect(canImpersonate(owner, plainLan)).toBe(true);
    expect(canImpersonate(owner, hrLan)).toBe(true);
    expect(canImpersonate(owner, { ...hrLan, grants: [{ role: "owner", scope: { type: "group" } }] })).toBe(true);
  });

  it("never as oneself", () => {
    expect(canImpersonate(owner, { ...plainLan, personId: "me" })).toBe(false);
    expect(canImpersonate(principal([], { personId: null }), plainLan)).toBe(false);
  });

  it("gives the support role people without a role, inside its scope only", () => {
    const support = principal([{ role: "support", scope: { type: "unit", id: DESIGN } }]);
    expect(canImpersonate(support, plainLan)).toBe(true);
    expect(canImpersonate(support, { ...plainLan, unitPath: [SOCIAL] })).toBe(false);
    expect(canImpersonate(principal([{ role: "support", scope: { type: "entity", id: ENTITY_B } }]), plainLan)).toBe(false);
  });

  it("refuses a role holder to anyone without '*' over them: borrowing would be a promotion", () => {
    const support = principal([{ role: "support", scope: { type: "group" } }]);
    expect(canImpersonate(support, hrLan)).toBe(false);
    // An owner grant on another entity is not "*" over Lan.
    expect(canImpersonate(principal([{ role: "owner", scope: { type: "entity", id: ENTITY_B } }, { role: "support", scope: { type: "group" } }]), hrLan)).toBe(false);
  });

  it("is held by no role but support, and by the owner", () => {
    for (const role of ROLES) expect(can(principal([{ role, scope: { type: "group" } }]), "auth:impersonate", lan), role).toBe(role === "owner" || role === "support");
    expect(canImpersonate(principal([{ role: "hr_admin", scope: { type: "group" } }]), plainLan)).toBe(false);
  });
});
