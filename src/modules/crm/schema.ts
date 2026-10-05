// CRM (Phase 11, SRS §4.15) — the selling side of the same records. An account is the work
// module's `work_client` row (a client; its brands hang under it); everything here points at that
// row's id instead of keeping a second client list. Deals become PJM projects, billing items become
// invoices, and people are HR's people.
//
// Money is integer VND. Deal values, quotes and contract values are commercial (crm:sell / crm:manage
// / pjm:commercial, and the deal's and account's own people); nothing salary-derived lives here —
// cost comes from payroll's `loadedCostRates` at read time, under `pjm:cost`. Contact details are
// personal data of people outside the company (PDPL): never cached, never sent to the AI model.
import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CalendarDeliveryStatus } from "../platform/calendar/enums";
import { entity } from "../platform/org/schema";
import { storedFile } from "../platform/files/schema";
import { person } from "../platform/people/schema";
import { projectBillingItem } from "../projects/schema";
import { registerDayActivitySource } from "../platform/day-activity/registry";
import { registerOwnershipProvider } from "../platform/ownership/registry";
import { type HandoffNote, workClient, workProject, workTeam } from "../work/schema";

// A leaver's accounts, deals, leads and follow-ups are part of their work handover (FR-CRM-40): the
// work module lists them through the platform's registry without importing the CRM. Registered
// beside the tables, which every database access loads; the provider itself loads when first asked.
registerOwnershipProvider("crm", () => import("./ownership").then((module) => module.crmOwnership));
// And the calls, meetings and deals of a person's day are part of their end-of-day report (FR-CRM-43).
registerDayActivitySource("crm", () => import("./day").then((module) => module.crmDay));

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Accounts and contacts (FR-CRM-01..03) ───────────────────────────────────────────────────

// The CRM half of a client (never of a brand, which reads its client's): 1:1 with work_client.
export const crmAccount = pgTable(
  "crm_account",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => workClient.id, { onDelete: "cascade" }),
    legalName: text("legal_name"),
    // Mã số thuế: 10 digits, or 10-3 for a branch. Checked by the action, indexed for the duplicate guard.
    taxCode: text("tax_code"),
    address: text("address"),
    website: text("website"),
    industry: text("industry"),
    // micro | small | medium | large | enterprise
    size: text("size"),
    // referral | website | event | social | cold | existing | other
    source: text("source"),
    // a | b | c
    tier: text("tier"),
    // prospect | active | dormant | churned — proposed from the facts unless set by hand.
    lifecycle: text("lifecycle").notNull().default("prospect"),
    lifecycleManual: boolean("lifecycle_manual").notNull().default(false),
    lifecycleChangedAt: timestamp("lifecycle_changed_at", { withTimezone: true }),
    // The SuZu entity that usually contracts with the client (a deal or contract may name another).
    contractingEntityId: uuid("contracting_entity_id").references(() => entity.id),
    salesOwnerPersonId: uuid("sales_owner_person_id").references(() => person.id),
    // Days after the invoice date; null = the contract's, else the entity default (parameter store).
    paymentTermsDays: integer("payment_terms_days"),
    creditHold: boolean("credit_hold").notNull().default(false),
    creditHoldReason: text("credit_hold_reason"),
    creditLimitVnd: bigint("credit_limit_vnd", { mode: "number" }),
    ...timestamps,
  },
  (t) => [index("crm_account_tax_idx").on(t.taxCode).where(sql`${t.taxCode} IS NOT NULL`), index("crm_account_sales_owner_idx").on(t.salesOwnerPersonId)],
).enableRLS();

// Named members of an account's team, beside the account manager, the sales owner and the people
// the team is derived from (deal owners, the people of the account's open projects).
export const crmAccountMember = pgTable(
  "crm_account_member",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => workClient.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.personId] }), index("crm_account_member_person_idx").on(t.personId)],
).enableRLS();

// A person at a client (FR-CRM-02). Always on the client (the account), optionally on its brands.
export const crmContact = pgTable(
  "crm_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => workClient.id, { onDelete: "cascade" }),
    brandIds: uuid("brand_ids").array().notNull().default([]),
    fullName: text("full_name").notNull(),
    // Accent-stripped, lower-case (DR-08): the duplicate guard and the search.
    searchName: text("search_name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    zalo: text("zalo"),
    // decision_maker | approver | influencer | user | finance
    decisionRole: text("decision_role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    // email | phone | zalo | meeting
    preferredChannel: text("preferred_channel"),
    birthday: date("birthday"),
    notes: text("notes"),
    // Where we got the details and on what basis we keep them (PDPL): required.
    // source: business_card | referral | client_sent | public | event | other
    source: text("source").notNull(),
    // contract | consent | legitimate_interest
    lawfulBasis: text("lawful_basis").notNull(),
    // active | left
    status: text("status").notNull().default("active"),
    // Erased on request: details blanked, the name kept only as signed records quote it.
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("crm_contact_client_idx").on(t.clientId), index("crm_contact_email_idx").on(t.email).where(sql`${t.email} IS NOT NULL`)],
).enableRLS();

// ── Pipeline (FR-CRM-10..16) ────────────────────────────────────────────────────────────────

// Configurable stages (FR-CRM-12). Reference data: one cache key for the table.
// gates: what a deal must have to enter — contacts | close_date | value | quote_accepted | contract_signed | pitch_project
export const crmStage = pgTable(
  "crm_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    // open | won | lost
    category: text("category").notNull(),
    probability: integer("probability").notNull().default(0),
    gates: text("gates").array().notNull().default([]),
    // A deal in this stage may open a pitch project (FR-CRM-14).
    allowsPitch: boolean("allows_pitch").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
).enableRLS();

// An enquiry not yet qualified (FR-CRM-10). Anyone may log one; the referrer is credited.
export const crmLead = pgTable(
  "crm_lead",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    // An existing account the enquiry comes from, when there is one.
    clientId: uuid("client_id").references(() => workClient.id),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name"),
    contactTitle: text("contact_title"),
    email: text("email"),
    phone: text("phone"),
    need: text("need"),
    budgetText: text("budget_text"),
    source: text("source").notNull().default("referral"),
    referrerPersonId: uuid("referrer_person_id").references(() => person.id),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    // new | contacted | qualified | converted | disqualified
    status: text("status").notNull().default("new"),
    disqualifyReason: text("disqualify_reason"),
    convertedDealId: uuid("converted_deal_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("crm_lead_owner_idx").on(t.ownerPersonId, t.status), index("crm_lead_entity_idx").on(t.entityId, t.status)],
).enableRLS();

export const crmDeal = pgTable(
  "crm_deal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "DL-SZM-26-014": entity, year, running number (the job-number counter under its own prefix).
    code: text("code").notNull().unique(),
    // The SuZu entity that will contract.
    entityId: uuid("entity_id").references(() => entity.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => workClient.id),
    brandId: uuid("brand_id").references(() => workClient.id),
    title: text("title").notNull(),
    // Service categories sold (social, video, kol, event, media, design, other).
    serviceLines: text("service_lines").array().notNull().default([]),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => crmStage.id),
    // open | won | lost — the stage's category, kept on the row for queries.
    status: text("status").notNull().default("open"),
    oneOffVnd: bigint("one_off_vnd", { mode: "number" }),
    monthlyVnd: bigint("monthly_vnd", { mode: "number" }),
    months: integer("months"),
    // 0..100; null = the stage's default.
    probability: integer("probability"),
    expectedCloseOn: date("expected_close_on"),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    // The work team expected to deliver.
    teamId: uuid("team_id").references(() => workTeam.id),
    source: text("source"),
    leadId: uuid("lead_id").references(() => crmLead.id, { onDelete: "set null" }),
    competitors: text("competitors"),
    nextStep: text("next_step"),
    // price | scope | timing | competitor | no_decision | other
    lostReason: text("lost_reason"),
    lostNote: text("lost_note"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    // The pitch project (a PJM project of kind "pitch", FR-CRM-14).
    pitchProjectId: uuid("pitch_project_id").references(() => workProject.id, { onDelete: "set null" }),
    // A renewal deal names the contract — or the retainer project — it renews (FR-CRM-26); the job
    // opens one per contract and one per retainer, held by the unique indexes.
    renewsContractId: uuid("renews_contract_id"),
    renewsProjectId: uuid("renews_project_id").references(() => workProject.id, { onDelete: "set null" }),
    // Stale reminders already sent: the date of the last one.
    staleNotifiedOn: date("stale_notified_on"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("crm_deal_client_idx").on(t.clientId),
    index("crm_deal_owner_idx").on(t.ownerPersonId, t.status),
    index("crm_deal_entity_idx").on(t.entityId, t.status),
    uniqueIndex("crm_deal_renewal_unique").on(t.renewsContractId).where(sql`${t.renewsContractId} IS NOT NULL`),
    uniqueIndex("crm_deal_retainer_renewal_unique").on(t.renewsProjectId).where(sql`${t.renewsProjectId} IS NOT NULL`),
  ],
).enableRLS();

// The client's people on a deal and their part in it.
export const crmDealContact = pgTable(
  "crm_deal_contact",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeal.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => crmContact.id, { onDelete: "cascade" }),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.contactId] })],
).enableRLS();

// Every stage change (the sales cycle, the win rate and the history on the deal).
export const crmDealStageChange = pgTable(
  "crm_deal_stage_change",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeal.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => crmStage.id),
    toStageId: uuid("to_stage_id")
      .notNull()
      .references(() => crmStage.id),
    changedByPersonId: uuid("changed_by_person_id").references(() => person.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_deal_stage_change_idx").on(t.dealId, t.changedAt)],
).enableRLS();

// The delivery project(s) a won deal became (FR-CRM-15), with the sales → delivery hand-off
// (FR-CRM-16) in the one note shape every hand-off uses (FR-PJM-43). One project comes from at
// most one deal. The project's lead accepts or returns it; the wait is measured from created_at.
export const crmDealProject = pgTable(
  "crm_deal_project",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => workProject.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeal.id, { onDelete: "cascade" }),
    handoffNote: jsonb("handoff_note").$type<HandoffNote>().notNull().default({}),
    // pending | accepted | returned
    handoffStatus: text("handoff_status").notNull().default("pending"),
    handoffToPersonId: uuid("handoff_to_person_id").references(() => person.id),
    handoffRespondedAt: timestamp("handoff_responded_at", { withTimezone: true }),
    handoffReturnReason: text("handoff_return_reason"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_deal_project_deal_idx").on(t.dealId), index("crm_deal_project_handoff_idx").on(t.handoffToPersonId).where(sql`${t.handoffStatus} = 'pending'`)],
).enableRLS();

// ── Rate card, quotes, contracts (FR-CRM-20..27) ────────────────────────────────────────────

export type RoleMinutes = { role: string; minutes: number };

// A service on the rate card. Reference data: one cache key with its prices.
export const crmService = pgTable(
  "crm_service",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    // social | video | kol | event | media | design | other — the deal's service lines.
    category: text("category").notNull().default("other"),
    // post, video, month, day, hour, item…
    unit: text("unit").notNull().default("item"),
    isRecurring: boolean("is_recurring").notNull().default(false),
    // The register line a sold unit becomes (FR-PJM-05).
    format: text("format"),
    channel: text("channel"),
    // Hours by role for one unit (the quote's estimate, the project's budget by role).
    roleMinutes: jsonb("role_minutes").$type<RoleMinutes[]>().notNull().default([]),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
).enableRLS();

// Effective-dated list prices; entity_id null = the group's price, an entity's own replaces it.
export const crmServicePrice = pgTable(
  "crm_service_price",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => crmService.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entity.id),
    priceVnd: bigint("price_vnd", { mode: "number" }).notNull(),
    validFrom: date("valid_from").notNull(),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_service_price_idx").on(t.serviceId, t.validFrom)],
).enableRLS();

export const crmQuote = pgTable(
  "crm_quote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeal.id, { onDelete: "cascade" }),
    // "BG-SZM-26-007" — shared by every version of the quote.
    number: text("number").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    // draft | in_approval | approved | sent | accepted | rejected | expired | superseded
    status: text("status").notNull().default("draft"),
    validUntil: date("valid_until"),
    // The VAT rate applied, in basis points, as read from the parameter store when last saved.
    vatRateBp: integer("vat_rate_bp").notNull().default(0),
    // Totals kept on the row (the engine computes them from the lines on every save).
    subtotalVnd: bigint("subtotal_vnd", { mode: "number" }).notNull().default(0),
    discountVnd: bigint("discount_vnd", { mode: "number" }).notNull().default(0),
    vatVnd: bigint("vat_vnd", { mode: "number" }).notNull().default(0),
    totalVnd: bigint("total_vnd", { mode: "number" }).notNull().default(0),
    // Largest line discount, basis points — what the approval threshold compares.
    maxDiscountBp: integer("max_discount_bp").notNull().default(0),
    intro: text("intro"),
    terms: text("terms"),
    approvalRequestId: uuid("approval_request_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("crm_quote_version_unique").on(t.number, t.version), index("crm_quote_deal_idx").on(t.dealId)],
).enableRLS();

export const crmQuoteLine = pgTable(
  "crm_quote_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => crmQuote.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => crmService.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    unit: text("unit"),
    unitPriceVnd: bigint("unit_price_vnd", { mode: "number" }).notNull().default(0),
    discountBp: integer("discount_bp").notNull().default(0),
    // null = one-off; n = monthly for n months (the retainer's lines).
    months: integer("months"),
    format: text("format"),
    channel: text("channel"),
    // Estimated hours by role for the whole line (quantity × the service's per-unit hours, editable).
    roleMinutes: jsonb("role_minutes").$type<RoleMinutes[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("crm_quote_line_quote_idx").on(t.quoteId, t.sortOrder)],
).enableRLS();

// Client contracts and appendices (FR-CRM-25).
export const crmContract = pgTable(
  "crm_contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => workClient.id),
    entityId: uuid("entity_id").references(() => entity.id),
    // The contract's own legal number, as typed ("15/2026/HĐDV-SZM").
    number: text("number").notNull(),
    title: text("title").notNull(),
    // service | framework | appendix
    kind: text("kind").notNull().default("service"),
    parentContractId: uuid("parent_contract_id"),
    dealId: uuid("deal_id").references(() => crmDeal.id, { onDelete: "set null" }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    valueVnd: bigint("value_vnd", { mode: "number" }),
    paymentTermsDays: integer("payment_terms_days"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    noticeDays: integer("notice_days"),
    // draft | signed | terminated — "active" and "expired" are read from the dates.
    status: text("status").notNull().default("draft"),
    signedOn: date("signed_on"),
    signedFileId: uuid("signed_file_id").references(() => storedFile.id),
    terminatedOn: date("terminated_on"),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("crm_contract_client_idx").on(t.clientId), index("crm_contract_end_idx").on(t.endDate).where(sql`${t.status} = 'signed'`), unique("crm_contract_number_unique").on(t.entityId, t.number)],
).enableRLS();

// Which contract a project is delivered under (its billing items quote the number, FR-PJM-56).
export const crmContractProject = pgTable(
  "crm_contract_project",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => workProject.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => crmContract.id, { onDelete: "cascade" }),
  },
  (t) => [index("crm_contract_project_contract_idx").on(t.contractId)],
).enableRLS();

// ── Invoices, payments (FR-CRM-30..32) ──────────────────────────────────────────────────────

// Finance's record of an invoice issued in the accounting system, over one or more billing items.
// A draft is one being prepared: it holds its items, may have no number yet, and is changed or
// deleted freely. An issued invoice is never deleted — a mistake is voided, with the reason.
export const crmInvoice = pgTable(
  "crm_invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => workClient.id),
    // null only on a draft that has no number yet.
    number: text("number"),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    vatRateBp: integer("vat_rate_bp").notNull().default(0),
    subtotalVnd: bigint("subtotal_vnd", { mode: "number" }).notNull(),
    vatVnd: bigint("vat_vnd", { mode: "number" }).notNull().default(0),
    totalVnd: bigint("total_vnd", { mode: "number" }).notNull(),
    // draft | open | paid | written_off | void — "part paid" and "overdue" are read from the payments and the date.
    status: text("status").notNull().default("open"),
    writtenOffReason: text("written_off_reason"),
    voidedReason: text("voided_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByPersonId: uuid("voided_by_person_id").references(() => person.id),
    note: text("note"),
    // Reminder days already sent (days past due: 1, 15, 30…).
    reminded: integer("reminded").array().notNull().default([]),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("crm_invoice_number_unique").on(t.entityId, t.number), index("crm_invoice_client_idx").on(t.clientId, t.status), index("crm_invoice_due_idx").on(t.dueOn).where(sql`${t.status} = 'open'`)],
).enableRLS();

// An item is on one live invoice at a time — a draft holds it too, the service checks under the
// item's lock. A voided invoice keeps its rows, so the item can go on the invoice that replaces it.
export const crmInvoiceItem = pgTable(
  "crm_invoice_item",
  {
    billingItemId: uuid("billing_item_id")
      .notNull()
      .references(() => projectBillingItem.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => crmInvoice.id, { onDelete: "cascade" }),
    // On a draft, the amount finance typed for an item made without one; once issued, the amount invoiced.
    amountVnd: bigint("amount_vnd", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.billingItemId, t.invoiceId] }), index("crm_invoice_item_invoice_idx").on(t.invoiceId)],
).enableRLS();

export const crmPayment = pgTable(
  "crm_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => crmInvoice.id, { onDelete: "cascade" }),
    receivedOn: date("received_on").notNull(),
    amountVnd: bigint("amount_vnd", { mode: "number" }).notNull(),
    // transfer | cash | offset | other
    method: text("method").notNull().default("transfer"),
    reference: text("reference"),
    note: text("note"),
    recordedByPersonId: uuid("recorded_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // A payment recorded by mistake is reversed, never deleted: it stays on the invoice and counts for nothing.
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedByPersonId: uuid("reversed_by_person_id").references(() => person.id),
    reversedReason: text("reversed_reason"),
  },
  (t) => [index("crm_payment_invoice_idx").on(t.invoiceId), index("crm_payment_received_idx").on(t.receivedOn)],
).enableRLS();

// ── Activities and follow-ups (FR-CRM-06) ───────────────────────────────────────────────────

// A logged activity (occurred_at set, done) or a follow-up still to do (due_on set, done_at null).
export const crmActivity = pgTable(
  "crm_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // call | meeting | email | message | note | task
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    clientId: uuid("client_id").references(() => workClient.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContact.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => crmDeal.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => crmLead.id, { onDelete: "cascade" }),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    // A follow-up's day; null for an activity logged after the fact.
    dueOn: date("due_on"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    outcome: text("outcome"),
    // The morning the owner was reminded (once).
    remindedOn: date("reminded_on"),
    // Covered during the owner's leave (FR-CRM-41): whose it was, so it goes back when they return.
    coverFromPersonId: uuid("cover_from_person_id").references(() => person.id),
    // A meeting put in Google Calendar through the platform adapter.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    calendarEventId: text("calendar_event_id"),
    calendarDriver: text("calendar_driver"),
    calendarStatus: text("calendar_status").$type<CalendarDeliveryStatus>(),
    calendarError: text("calendar_error"),
    meetingUrl: text("meeting_url"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("crm_activity_client_idx").on(t.clientId, t.createdAt),
    index("crm_activity_deal_idx").on(t.dealId),
    index("crm_activity_lead_idx").on(t.leadId),
    index("crm_activity_open_idx").on(t.ownerPersonId, t.dueOn).where(sql`${t.doneAt} IS NULL`),
    index("crm_activity_done_idx").on(t.ownerPersonId, t.doneAt),
  ],
).enableRLS();

// ── Commission (FR-CRM-45) ──────────────────────────────────────────────────────────────────

// The owner's scheme, effective-dated: tiers of a rate on cash collected in the month.
export type CommissionTier = { fromVnd: number; rateBp: number };
export type CommissionRule = { base: "cash_collected"; earner: "deal_owner" | "account_manager" | "split"; splitOwnerBp: number; tiers: CommissionTier[] };
export const crmCommissionScheme = pgTable(
  "crm_commission_scheme",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = the group.
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    rule: jsonb("rule").$type<CommissionRule>().notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    // proposed | approved | rejected
    status: text("status").notNull().default("proposed"),
    proposedByPersonId: uuid("proposed_by_person_id").references(() => person.id),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
).enableRLS();

// A month's statement for one person: compensation tier, so its figures are encrypted like payroll's.
export const crmCommissionStatement = pgTable(
  "crm_commission_statement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    // "2026-10"
    month: text("month").notNull(),
    schemeId: uuid("scheme_id")
      .notNull()
      .references(() => crmCommissionScheme.id),
    // Context "crm_commission_statement.amount:<id>" / ".trace:<id>".
    amountEnc: text("amount_enc").notNull(),
    traceEnc: text("trace_enc").notNull(),
    // draft | confirmed | in_payroll
    status: text("status").notNull().default("draft"),
    payrollRunId: uuid("payroll_run_id"),
    confirmedByPersonId: uuid("confirmed_by_person_id").references(() => person.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("crm_commission_statement_unique").on(t.personId, t.entityId, t.month)],
).enableRLS();
