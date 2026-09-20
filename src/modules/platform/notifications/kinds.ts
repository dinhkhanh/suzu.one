// The catalogue of notifications. Plain module: shared by the server and the preferences screen.
// Wording lives in messages/*.json under `notifications.kinds.<kind>` (dots become underscores).

export const CATEGORIES = ["security", "system", "hr", "approvals", "tasks", "attendance", "ops", "kb", "comms", "payroll"] as const;
export type Category = (typeof CATEGORIES)[number];

export const EMAIL_CHANNELS = ["instant", "digest", "off"] as const;
export type EmailChannel = (typeof EMAIL_CHANNELS)[number];

export type ChannelChoice = { inApp: boolean; email: EmailChannel; /** Web push to the devices the person subscribed. */ push: boolean };

export const CATEGORY_DEFINITIONS: Record<Category, { defaults: ChannelChoice; /** Cannot be turned down by the recipient. */ mandatory: boolean }> = {
  security: { defaults: { inApp: true, email: "instant", push: true }, mandatory: true },
  system: { defaults: { inApp: true, email: "instant", push: false }, mandatory: false },
  // Deadlines HR and managers act on: contracts running out, probation ending, documents expiring.
  hr: { defaults: { inApp: true, email: "digest", push: false }, mandatory: false },
  // A request waits for you, or yours was answered: worth an email straight away.
  approvals: { defaults: { inApp: true, email: "instant", push: true }, mandatory: false },
  // Work handed to you. In the app at once; by email once a day, so a checklist is one email.
  tasks: { defaults: { inApp: true, email: "digest", push: true }, mandatory: false },
  // The monthly timesheet: ready to confirm, waiting for the manager, sent back, corrected after the lock.
  attendance: { defaults: { inApp: true, email: "digest", push: true }, mandatory: false },
  // Compliance obligations: assigned, coming due, overdue, escalated (FR-OPS-08).
  ops: { defaults: { inApp: true, email: "digest", push: false }, mandatory: false },
  // Knowledge base: a policy to read and confirm, the reminders, a page whose review date has passed.
  kb: { defaults: { inApp: true, email: "digest", push: false }, mandatory: false },
  // Announcements and kudos (Phase 4): in the app and on the phone at once, by email once a day.
  comms: { defaults: { inApp: true, email: "digest", push: true }, mandatory: false },
  // Payroll (Phase 5): something to decide or a payslip to read. Never an amount — a notification
  // is read on lock screens and in mailboxes.
  payroll: { defaults: { inApp: true, email: "instant", push: true }, mandatory: false },
};

export const KINDS = {
  "security.work_email_changed": "security",
  "security.role_granted": "security",
  "security.role_revoked": "security",
  "system.job_failed": "system",
  "system.rule_proposed": "system",
  "hr.contract_expiring": "hr",
  "hr.probation_ending": "hr",
  "hr.document_expiring": "hr",
  "hr.resignation_approved": "hr",
  "approvals.requested": "approvals",
  "approvals.decided": "approvals",
  "approvals.commented": "approvals",
  "approvals.delegated_to_you": "approvals",
  // HR called off someone's approved leave: the person is told, the days are back in the balance.
  "approvals.leave_cancelled": "approvals",
  "tasks.assigned": "tasks",
  // Work management (Phase 3): a task in a project, with a link straight to it.
  "tasks.work_assigned": "tasks",
  // What happens on tasks I follow (FR-WRK-17), and the daily reminders of the work-reminders job.
  "tasks.mentioned": "tasks",
  "tasks.commented": "tasks",
  "tasks.status_changed": "tasks",
  "tasks.due_soon": "tasks",
  "tasks.overdue": "tasks",
  // The review step and the leader's nudge (FR-WRK-07, 08).
  "tasks.review_requested": "tasks",
  "tasks.review_decided": "tasks",
  "tasks.nudge": "tasks",
  "tasks.intake_submitted": "tasks",
  "attendance.month_ready": "attendance",
  "attendance.month_waiting": "attendance",
  "attendance.month_reopened": "attendance",
  "attendance.adjusted": "attendance",
  "attendance.nudge": "attendance",
  "ops.assigned": "ops",
  "ops.reminder": "ops",
  "ops.overdue": "ops",
  "ops.escalated": "ops",
  "kb.ack_requested": "kb",
  "kb.ack_reminder": "kb",
  "kb.review_due": "kb",
  "comms.announcement": "comms",
  "comms.kudos_received": "comms",
  // Rule governance (FR-PLT-39) for pay components and pay policies, and a move between pay profiles: to the owners.
  "payroll.rule_proposed": "payroll",
  "payroll.profile_proposed": "payroll",
  // A month's payslip is out, a question about one was asked or answered, cash is waiting to be
  // confirmed (FR-PAY-32, 39). The month and a link — never a figure.
  "payroll.payslip_published": "payroll",
  "payroll.payslip_query_raised": "payroll",
  "payroll.payslip_query_answered": "payroll",
  "payroll.cash_receipt_due": "payroll",
} as const satisfies Record<string, Category>;
export type Kind = keyof typeof KINDS;

export const messageKey = (kind: string) => kind.replaceAll(".", "_");

/** What the person chose, unless the category is mandatory or they chose nothing. */
export function effectiveChoice(category: Category, stored: { inApp: boolean; email: EmailChannel; push?: boolean | null } | undefined): ChannelChoice {
  const definition = CATEGORY_DEFINITIONS[category];
  if (definition.mandatory || !stored) return definition.defaults;
  // Choices saved before push existed say nothing about it: the category's default applies.
  return { inApp: stored.inApp, email: stored.email, push: stored.push ?? definition.defaults.push };
}

/**
 * Some params are keys, not text (a role, a scope type): they are put into words in the reader's
 * language when the notification is shown. `lookup` takes a full message key.
 */
export function resolveParams(params: Record<string, string | number>, lookup: (key: string) => string): Record<string, string | number> {
  const resolved = { ...params };
  if (typeof params.role === "string") resolved.role = lookup(`roles.${params.role}`);
  // The request builder's types are named in the database, not here: what the notification was
  // given already reads as a name, so a missing message key leaves it alone rather than showing one.
  if (typeof params.requestType === "string") {
    const key = `approvals.types.${params.requestType}`;
    const found = lookup(key);
    resolved.requestType = found === key ? params.requestType : found;
  }
  if (typeof params.outcome === "string") resolved.outcome = lookup(`approvals.status.${params.outcome}`);
  if (typeof params.scopeType === "string") {
    const scopeType = lookup(`rbac.scope.${params.scopeType}`);
    resolved.scope = params.scopeName ? `${scopeType}: ${params.scopeName}` : scopeType;
  }
  return resolved;
}
