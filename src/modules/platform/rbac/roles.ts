// Role catalogue (SRS §2). Permissions are `resource:action` strings; "*" grants everything.
// Sensitivity tiers order personal data from least to most sensitive (SRS §2.2).

export const TIERS = ["public_internal", "personal", "restricted", "compensation"] as const;
export type Tier = (typeof TIERS)[number];

export const ROLES = [
  "owner",
  "c_level",
  "entity_director",
  "hr_admin",
  "hr_staff",
  "payroll",
  "finance",
  "department_head",
  "recruiter",
  "asset_admin",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "*"
  | "org:read"
  | "org:manage"
  | "rbac:manage"
  | "audit:read"
  | "person:read"
  | "person:manage"
  | "attendance:manage"
  | "leave:manage"
  | "payroll:read"
  | "payroll:propose"
  | "payroll:approve"
  | "payroll:pay"
  // Statutory parameters, pay components, leave and attendance policies (FR-PLT-39):
  // HR and C&B propose changes; only the owner decides them.
  | "rules:propose"
  | "payroll:rules"
  | "recruit:manage"
  | "asset:manage"
  | "report:read"
  // Work management (Phase 3): create teams and clients, run any non-private project in scope.
  // Day-to-day rights come from team and project membership, not from a role.
  | "work:manage"
  // Operations & compliance tracker: keep the obligation library, complete or reassign any
  // obligation in scope (`ops:manage`); see the compliance calendar and its evidence (`ops:read`).
  | "ops:manage"
  | "ops:read"
  // Performance (Phase 3.5): HR runs goals and KPIs for the people and units in scope
  // (`performance:manage`); leaders set the goals of the units their grant covers
  // (`performance:goals`) and read the individual goals and KPI scores of the people in it
  // (`performance:read`). One's own goals, and those of one's reports, need no permission.
  | "performance:manage"
  | "performance:goals"
  | "performance:read"
  // Phase 8 (FR-PRF-09): deciding the weighting the final yearly result is combined by, and
  // overriding one person's result with a recorded reason. The owner's alone — no role below
  // lists it, so only a "*" grant holds it, exactly like `payroll:rules` for pay rules.
  | "performance:decide"
  // Knowledge base (Phase 4): create and archive spaces, set who views and edits them, publish in
  // controlled spaces and edit anything in the spaces the grant covers. Reading and everyday
  // editing come from a space's access rows, not from a role.
  | "kb:manage"
  // A unit's own space (FR-KB-13): create it, run it, and decide who outside the unit may see it.
  // Held by whoever leads units — over the units their grant covers, and everything below them.
  | "kb:manage_unit"
  // Internal comms (Phase 4): post announcements to the audience the grant covers and see who read them.
  | "comms:manage"
  // Projects & daily work (Phase 10). Hours and plans are ordinary work data, open to whoever the
  // project is open to. Fees, money budgets and the billing queue need `pjm:commercial`; cost rates
  // and profitability — derived from salaries — need `pjm:cost`. `pjm:portfolio` reads every
  // non-private project and its status in scope without being a member.
  | "pjm:commercial"
  | "pjm:cost"
  | "pjm:portfolio";

type RoleDefinition = {
  permissions: readonly Permission[];
  // Highest tier of *other people's* data this role may read within its scope.
  maxTier: Tier;
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  owner: { permissions: ["*"], maxTier: "compensation" },
  c_level: { permissions: ["org:read", "person:read", "report:read", "payroll:read", "payroll:approve", "work:manage", "ops:read", "performance:goals", "performance:read", "comms:manage", "kb:manage_unit", "pjm:commercial", "pjm:cost", "pjm:portfolio"], maxTier: "compensation" },
  entity_director: { permissions: ["org:read", "person:read", "report:read", "work:manage", "ops:read", "performance:goals", "performance:read", "comms:manage", "kb:manage_unit", "pjm:commercial", "pjm:portfolio"], maxTier: "restricted" },
  hr_admin: {
    permissions: ["org:read", "org:manage", "person:read", "person:manage", "attendance:manage", "leave:manage", "payroll:read", "payroll:propose", "rules:propose", "recruit:manage", "report:read", "audit:read", "ops:manage", "performance:manage", "kb:manage", "comms:manage"],
    maxTier: "compensation",
  },
  hr_staff: {
    permissions: ["org:read", "person:read", "person:manage", "attendance:manage", "leave:manage", "recruit:manage", "ops:manage", "performance:manage", "kb:manage", "comms:manage"],
    maxTier: "restricted",
  },
  payroll: { permissions: ["org:read", "person:read", "payroll:read", "payroll:propose", "rules:propose", "report:read", "ops:manage"], maxTier: "compensation" },
  finance: { permissions: ["org:read", "person:read", "payroll:read", "payroll:pay", "report:read", "ops:manage", "pjm:commercial", "pjm:cost", "pjm:portfolio"], maxTier: "compensation" },
  department_head: { permissions: ["org:read", "person:read", "report:read", "work:manage", "performance:goals", "performance:read", "comms:manage", "kb:manage_unit", "pjm:portfolio"], maxTier: "personal" },
  recruiter: { permissions: ["org:read", "recruit:manage"], maxTier: "public_internal" },
  asset_admin: { permissions: ["org:read", "person:read", "asset:manage"], maxTier: "public_internal" },
  auditor: { permissions: ["org:read", "person:read", "payroll:read", "report:read", "audit:read", "ops:read", "performance:read"], maxTier: "compensation" },
};

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
