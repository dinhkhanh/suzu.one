// Value lists shared by the server and the screens. A plain module on purpose: constants exported
// from a "use client" file are client references on the server.

export const ACCOUNT_SIZES = ["micro", "small", "medium", "large", "enterprise"] as const;
export type AccountSize = (typeof ACCOUNT_SIZES)[number];

export const ACCOUNT_TIERS = ["a", "b", "c"] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];

/** FR-CRM-01. Proposed from the facts (engine/lifecycle.ts) unless set by hand. */
export const LIFECYCLES = ["prospect", "active", "dormant", "churned"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Where an account, a lead or a deal came from. */
export const SOURCES = ["referral", "website", "event", "social", "cold", "existing", "other"] as const;
export type Source = (typeof SOURCES)[number];

export const DECISION_ROLES = ["decision_maker", "approver", "influencer", "user", "finance"] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];

export const CONTACT_CHANNELS = ["email", "phone", "zalo", "meeting"] as const;

/** Where a contact's details came from, and on what basis we keep them (PDPL). Both required. */
export const CONTACT_SOURCES = ["business_card", "referral", "client_sent", "public", "event", "other"] as const;
export const LAWFUL_BASES = ["contract", "consent", "legitimate_interest"] as const;
export const CONTACT_STATUSES = ["active", "left"] as const;

/** FR-CRM-06. `task` is a follow-up with no channel ("send the proposal"). */
export const ACTIVITY_KINDS = ["call", "meeting", "email", "message", "note", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "disqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** A lead still being worked. */
export const isOpenLead = (status: LeadStatus): boolean => status === "new" || status === "contacted" || status === "qualified";

export const STAGE_CATEGORIES = ["open", "won", "lost"] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];
export type DealStatus = StageCategory;

/** What a deal must have to enter a stage (FR-CRM-12). */
export const STAGE_GATES = ["contacts", "close_date", "value", "quote_accepted", "contract_signed", "pitch_project"] as const;
export type StageGate = (typeof STAGE_GATES)[number];

export const SERVICE_LINES = ["social", "video", "kol", "event", "media", "design", "other"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const LOST_REASONS = ["price", "scope", "timing", "competitor", "no_decision", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const QUOTE_STATUSES = ["draft", "in_approval", "approved", "sent", "accepted", "rejected", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const CONTRACT_KINDS = ["service", "framework", "appendix"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
/** Stored statuses; "active", "expired" and "upcoming" are read from the dates (engine/contract.ts). */
export const CONTRACT_STATUSES = ["draft", "signed", "terminated"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const INVOICE_STATUSES = ["draft", "open", "paid", "written_off", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const PAYMENT_METHODS = ["transfer", "cash", "offset", "other"] as const;

/** Receivables aging buckets (FR-CRM-32): days past due. */
export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const SERVICE_UNITS = ["item", "post", "video", "month", "day", "hour", "package"] as const;

export const COMMISSION_EARNERS = ["deal_owner", "account_manager", "split"] as const;
export type CommissionEarner = (typeof COMMISSION_EARNERS)[number];
export const COMMISSION_STATEMENT_STATUSES = ["draft", "confirmed", "in_payroll"] as const;
