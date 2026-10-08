// Role catalogue (SRS §2). Permissions are `resource:action` strings; "*" grants everything.
// Sensitivity tiers order personal data from least to most sensitive (SRS §2.2).

export const TIERS = ["public_internal", "personal", "restricted", "compensation"] as const;
export type Tier = (typeof TIERS)[number];

export const ROLES = ["owner", "c_level", "entity_director", "hr_admin", "hr_staff", "payroll", "finance", "department_head", "recruiter", "asset_admin", "auditor", "support", "sales", "marketing"] as const;
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
  // The face kiosk (FR-ATT-06): opening a kiosk on a wall tablet for the entities of the grant, and
  // enrolling people's faces for it. Biometric data, so held by HR's administrators and the people
  // above them — not by every HR staffer who keeps attendance.
  | "attendance:kiosk"
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
  | "pjm:portfolio"
  // CRM (Phase 11). An account's own people — its account manager, sales owner and team, the owners
  // of its deals, the people of its open projects — work it without any permission. `crm:sell`
  // holds a pipeline over the entities of the grant: owns leads and deals, creates accounts and
  // quotes, reads the contacts and deal values there. `crm:manage` runs the pipeline: stages, the
  // rate card, quote thresholds, every account and deal in scope, reassigning them. Invoices and
  // payments stay with `pjm:commercial` (finance); cost and margin with `pjm:cost`.
  | "crm:sell"
  | "crm:manage"
  // Feedback about SuZu One itself: triage it — status, priority, the reply the submitter reads and
  // the internal note (`feedback:manage`); read the inbox without changing it (`feedback:read`).
  // Anyone may send feedback and read their own; neither needs a permission.
  | "feedback:manage"
  | "feedback:read"
  // Brand kits (FR-BRD-01): keep each brand's logos, brochures and guidelines, and decide what the
  // public domain hands out. Over the kits of the entities the grant covers; a group grant also
  // reaches the kits of brands that belong to the whole group.
  | "brand:manage"
  // Seeing the app as somebody else (FR-PLT-40): the holder's session acts as a person the grant
  // covers — their pages, their grants, their name on what they do — while the audit log keeps the
  // holder's own account on every entry. `canImpersonate` adds the rule that only a "*" holder may
  // borrow the identity of someone who holds a role: anyone else could otherwise climb the ladder.
  | "auth:impersonate"
  // Oversight: reading everything a feature holds without being one of the people it belongs to —
  // the owner's view of the whole company (decision of 2026-09-28). One permission per feature, so
  // that a role can later be given one feature's view without the rest. Each opens what the
  // feature's ordinary rules keep to its members, authors or reporting line; none of them lets the
  // holder act, and none lifts a rule about acting on one's own record. No role below lists any
  // of them, so today only a "*" grant — the owner — holds them.
  // Every request in the company: the "All requests" list, any request's page, the morning digest.
  | "approval:oversee"
  // Private team backlogs, and the hours logged on a private project's tasks.
  | "work:oversee"
  // Every project's kick-off brief and change requests, and every project's document space.
  | "pjm:oversee"
  // Every knowledge-base space and page, whatever its access rows say.
  | "kb:oversee"
  // Everybody's daily plans, reports, timesheets, time entries and utilisation.
  | "daily:oversee"
  // Managers' private 1:1 notes and review forms still in draft.
  | "performance:oversee"
  // Interview scorecards still in draft, and the others' cards before one's own is in.
  | "recruit:oversee";

type RoleDefinition = {
  permissions: readonly Permission[];
  // Highest tier of *other people's* data this role may read within its scope.
  maxTier: Tier;
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  owner: { permissions: ["*"], maxTier: "compensation" },
  c_level: {
    permissions: [
      "org:read",
      "person:read",
      "attendance:kiosk",
      "report:read",
      "payroll:read",
      "payroll:approve",
      "work:manage",
      "ops:read",
      "performance:goals",
      "performance:read",
      "comms:manage",
      "kb:manage_unit",
      "pjm:commercial",
      "pjm:cost",
      "pjm:portfolio",
      "crm:sell",
      "crm:manage",
      "feedback:read",
    ],
    maxTier: "compensation",
  },
  entity_director: {
    permissions: [
      "org:read",
      "person:read",
      "attendance:kiosk",
      "report:read",
      "work:manage",
      "ops:read",
      "performance:goals",
      "performance:read",
      "comms:manage",
      "kb:manage_unit",
      "pjm:commercial",
      "pjm:portfolio",
      "crm:sell",
      "crm:manage",
      "feedback:read",
    ],
    maxTier: "restricted",
  },
  hr_admin: {
    permissions: [
      "org:read",
      "org:manage",
      "person:read",
      "person:manage",
      "attendance:manage",
      "attendance:kiosk",
      "leave:manage",
      "payroll:read",
      "payroll:propose",
      "rules:propose",
      "recruit:manage",
      "report:read",
      "audit:read",
      "ops:manage",
      "performance:manage",
      "kb:manage",
      "comms:manage",
      "feedback:manage",
    ],
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
  // Whoever helps people with the app (FR-PLT-40): sees the directory to find them, then sees what
  // they see. Given by the owner on Admin → Access, over a unit, an entity or the group; it never
  // reaches a role holder (`canImpersonate`), and the step-up proof does not travel with it, so a
  // support person sees no payslip that their own grants would not show them.
  support: { permissions: ["org:read", "person:read", "auth:impersonate"], maxTier: "public_internal" },
  // Business development and account executives (CRM, Phase 11): a pipeline over the grant's
  // entities. No person data beyond the directory, and no money but the deals' own values.
  sales: { permissions: ["org:read", "crm:sell"], maxTier: "public_internal" },
  // Whoever keeps the group's brands (FR-BRD-01): the brand kits and what the public may download.
  // Nothing about people beyond the directory.
  marketing: { permissions: ["org:read", "brand:manage"], maxTier: "public_internal" },
};

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
