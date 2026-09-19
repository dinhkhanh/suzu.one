// The catalogue of notifications. Plain module: shared by the server and the preferences screen.
// Wording lives in messages/*.json under `notifications.kinds.<kind>` (dots become underscores).

export const CATEGORIES = ["security", "system", "hr", "approvals", "tasks"] as const;
export type Category = (typeof CATEGORIES)[number];

export const EMAIL_CHANNELS = ["instant", "digest", "off"] as const;
export type EmailChannel = (typeof EMAIL_CHANNELS)[number];

export type ChannelChoice = { inApp: boolean; email: EmailChannel };

export const CATEGORY_DEFINITIONS: Record<Category, { defaults: ChannelChoice; /** Cannot be turned down by the recipient. */ mandatory: boolean }> = {
  security: { defaults: { inApp: true, email: "instant" }, mandatory: true },
  system: { defaults: { inApp: true, email: "instant" }, mandatory: false },
  // Deadlines HR and managers act on: contracts running out, probation ending, documents expiring.
  hr: { defaults: { inApp: true, email: "digest" }, mandatory: false },
  // A request waits for you, or yours was answered: worth an email straight away.
  approvals: { defaults: { inApp: true, email: "instant" }, mandatory: false },
  // Work handed to you. In the app at once; by email once a day, so a checklist is one email.
  tasks: { defaults: { inApp: true, email: "digest" }, mandatory: false },
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
} as const satisfies Record<string, Category>;
export type Kind = keyof typeof KINDS;

export const messageKey = (kind: string) => kind.replaceAll(".", "_");

/** What the person chose, unless the category is mandatory or they chose nothing. */
export function effectiveChoice(category: Category, stored: ChannelChoice | undefined): ChannelChoice {
  const definition = CATEGORY_DEFINITIONS[category];
  return definition.mandatory || !stored ? definition.defaults : stored;
}

/**
 * Some params are keys, not text (a role, a scope type): they are put into words in the reader's
 * language when the notification is shown. `lookup` takes a full message key.
 */
export function resolveParams(params: Record<string, string | number>, lookup: (key: string) => string): Record<string, string | number> {
  const resolved = { ...params };
  if (typeof params.role === "string") resolved.role = lookup(`roles.${params.role}`);
  if (typeof params.requestType === "string") resolved.requestType = lookup(`approvals.types.${params.requestType}`);
  if (typeof params.outcome === "string") resolved.outcome = lookup(`approvals.status.${params.outcome}`);
  if (typeof params.scopeType === "string") {
    const scopeType = lookup(`rbac.scope.${params.scopeType}`);
    resolved.scope = params.scopeName ? `${scopeType}: ${params.scopeName}` : scopeType;
  }
  return resolved;
}
