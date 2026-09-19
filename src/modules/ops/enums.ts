// Value lists of the ops tracker. Plain module: shared by the server, the forms and the seed.

export const OBLIGATION_CATEGORIES = ["internal", "external"] as const;
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number];

export const AUTHORITIES = ["tax", "social_insurance", "labour", "statistics", "trade_union", "licensing", "internal", "other"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const RECURRENCES = ["monthly", "quarterly", "semi_annual", "annual", "event"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export type PeriodicRecurrence = Exclude<Recurrence, "event">;

export const SHIFTS = ["next_working_day", "previous_working_day", "none"] as const;
export type Shift = (typeof SHIFTS)[number];

// What in HR starts an event-driven obligation. The first six are lifecycle event types; the last
// is the end of a long absence, read from the long-leave event's `details.to`.
export const EVENT_TYPES = ["hire", "rehire", "termination", "long_leave", "salary_change", "long_leave_return"] as const;
export type ObligationEventType = (typeof EVENT_TYPES)[number];

export const REVIEW_STATUSES = ["unreviewed", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const EVIDENCE_KEYS = ["file", "reference", "submittedDate", "amount"] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];
export type EvidenceRequirement = Record<EvidenceKey, boolean>;
export const NO_EVIDENCE: EvidenceRequirement = { file: false, reference: false, submittedDate: false, amount: false };

export type Escalation = { managerAfterDays: number; executiveAfterDays: number };
export const DEFAULT_ESCALATION: Escalation = { managerAfterDays: 3, executiveAfterDays: 7 };
export const DEFAULT_REMINDER_LEAD_DAYS = [7, 3, 1];

export type ObligationLink = { url: string; title: string };
export type ChecklistState = Record<string, boolean>;

export const OBLIGATION_KIND = "obligation";
export const OBLIGATION_FILE_OWNER = "obligation_instance";

/** Who owns or reviews an instance: `permission:<p>` | `role:<role>` | `person` (+ the person id) | `none`. */
export const PARTY_RULE = /^(permission:[a-z_]+:[a-z_]+|role:[a-z_]+|person|none)$/;

export const STATUS_COLOURS = ["upcoming", "due_soon", "overdue", "done", "done_late", "cancelled"] as const;
export type StatusColour = (typeof STATUS_COLOURS)[number];
