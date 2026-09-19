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
  | "ops:read";

type RoleDefinition = {
  permissions: readonly Permission[];
  // Highest tier of *other people's* data this role may read within its scope.
  maxTier: Tier;
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  owner: { permissions: ["*"], maxTier: "compensation" },
  c_level: { permissions: ["org:read", "person:read", "report:read", "payroll:read", "payroll:approve", "work:manage", "ops:read"], maxTier: "compensation" },
  entity_director: { permissions: ["org:read", "person:read", "report:read", "work:manage", "ops:read"], maxTier: "restricted" },
  hr_admin: {
    permissions: ["org:read", "org:manage", "person:read", "person:manage", "attendance:manage", "leave:manage", "payroll:read", "payroll:propose", "rules:propose", "recruit:manage", "report:read", "audit:read", "ops:manage"],
    maxTier: "compensation",
  },
  hr_staff: {
    permissions: ["org:read", "person:read", "person:manage", "attendance:manage", "leave:manage", "recruit:manage", "ops:manage"],
    maxTier: "restricted",
  },
  payroll: { permissions: ["org:read", "person:read", "payroll:read", "payroll:propose", "rules:propose", "report:read", "ops:manage"], maxTier: "compensation" },
  finance: { permissions: ["org:read", "person:read", "payroll:read", "payroll:pay", "report:read", "ops:manage"], maxTier: "compensation" },
  department_head: { permissions: ["org:read", "person:read", "report:read", "work:manage"], maxTier: "personal" },
  recruiter: { permissions: ["org:read", "recruit:manage"], maxTier: "public_internal" },
  asset_admin: { permissions: ["org:read", "person:read", "asset:manage"], maxTier: "public_internal" },
  auditor: { permissions: ["org:read", "person:read", "payroll:read", "report:read", "audit:read", "ops:read"], maxTier: "compensation" },
};

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
