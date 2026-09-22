// The catalogue of notifications. Plain module: shared by the server and the preferences screen.
// Wording lives in messages/*.json under `notifications.kinds.<kind>` (dots become underscores).

export const CATEGORIES = ["security", "system", "hr", "approvals", "tasks", "attendance", "ops", "kb", "comms", "payroll", "recruit", "performance", "projects", "daily"] as const;
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
  // Recruitment (Phase 7): a head was approved, an interview is on, a scorecard is waiting. Time
  // matters in hiring — a candidate who waits three days for an answer takes the other offer — so
  // these go out instantly. Never a figure: a salary expectation is compensation-tier.
  recruit: { defaults: { inApp: true, email: "instant", push: true }, mandatory: false },
  // Performance (Phase 8): somebody asked you for 360 feedback, your review is out, your yearly
  // result is published. A deadline to meet or a page to read — never a score and never an amount:
  // the figure is personal tier and the bonus it drives is compensation.
  performance: { defaults: { inApp: true, email: "digest", push: false }, mandatory: false },
  // Projects (Phase 10): a status update, a milestone coming due, a budget or quota running out,
  // a change request or acceptance to act on, a billing item for finance. Never a fee or an amount.
  projects: { defaults: { inApp: true, email: "digest", push: false }, mandatory: false },
  // The day (Phase 10): plan and report reminders, a lead's comment on a report, timesheets.
  // On the phone, not in the mailbox: a reminder by email tomorrow is no reminder.
  daily: { defaults: { inApp: true, email: "off", push: true }, mandatory: false },
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
  // FR-PLT-23: a request has been waiting for your answer; and, when it still is, the nudge that
  // goes over your head. Neither carries anything but the type, the one-line summary and the wait.
  "approvals.sla_reminder": "approvals",
  "approvals.sla_escalated": "approvals",
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
  // Recruitment (FR-REC-01): a hiring request cleared its flow, so there is a head to advertise.
  // The title and the count — never the budget.
  "recruit.hiring_approved": "recruit",
  // Interviews (FR-REC-06): you are in the room on Thursday, or you are no longer.
  "recruit.interview_scheduled": "recruit",
  "recruit.interview_cancelled": "recruit",
  // A take-home came back (FR-REC-07) — told to whoever sent the brief.
  "recruit.assignment_received": "recruit",
  // An offer cleared its flow and may go out (FR-REC-08). The offer's number and the job title —
  // never the amount, which is the whole point of the offer and the one thing a notification
  // read on a lock screen must not carry.
  "recruit.offer_approved": "recruit",
  // The candidate said yes: somebody has to put them on the books before they turn up (FR-REC-09).
  "recruit.offer_accepted": "recruit",
  // Performance reviews (FR-PRF-03, 08, 09). The person's name, the cycle's name and a link —
  // never the rating, which is personal-tier content and belongs on the page behind the link.
  "performance.peer_requested": "performance",
  "performance.review_released": "performance",
  "performance.result_published": "performance",
  // The owner has a weighting version to decide (FR-PRF-09 is configuration, not code).
  "performance.rule_proposed": "performance",
  // Phase 10 — tasks: blocked on you, a hand-off to accept or that came back, triage, cover, exit
  // handover, a client decision recorded, a post due to go out, an automation's message.
  "tasks.blocked": "tasks",
  "tasks.unblocked": "tasks",
  "tasks.handoff_received": "tasks",
  "tasks.handoff_accepted": "tasks",
  "tasks.handoff_returned": "tasks",
  "tasks.triage_new": "tasks",
  "tasks.cover_requested": "tasks",
  "tasks.cover_handed_back": "tasks",
  "tasks.exit_handover": "tasks",
  "tasks.client_decision": "tasks",
  "tasks.publish_due": "tasks",
  "tasks.publish_missed": "tasks",
  "tasks.automation": "tasks",
  // Phase 10 — projects.
  "projects.status_posted": "projects",
  "projects.status_due": "projects",
  "projects.milestone_due": "projects",
  "projects.milestone_missed": "projects",
  "projects.budget_alert": "projects",
  "projects.quota_alert": "projects",
  "projects.change_decided": "projects",
  "projects.acceptance_signed": "projects",
  "projects.billing_ready": "projects",
  "projects.billing_invoiced": "projects",
  "projects.booking_changed": "projects",
  "projects.kpi_proposed": "projects",
  // Phase 10 — the day.
  "daily.plan_reminder": "daily",
  "daily.report_reminder": "daily",
  "daily.report_nudge": "daily",
  "daily.report_commented": "daily",
  "daily.weekly_report": "daily",
  "daily.timesheet_reminder": "daily",
  "daily.timesheet_submitted": "daily",
  "daily.timesheet_decided": "daily",
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
