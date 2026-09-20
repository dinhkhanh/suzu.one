// Payroll (Phase 5). Compensation tier as a whole.
//
// Rule of this file: **no column holds an amount of money about a person in the clear.** Salary
// terms, run results and totals are envelope-encrypted JSON bound to their row (contexts in
// field-contexts.ts); the clear columns say who, when, which profile and in what state — enough
// to filter and join, nothing worth stealing. Rules (component definitions, policies, caps) are
// not about a person and stay readable.
//
// Migrations add the exclusion constraints: approved versions never overlap.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { employment } from "../core-hr/schema";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { PayrollPolicyValue } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// Propose → the owner decides (FR-PLT-39, SRS D17), like `statutory_parameter`.
export const payRuleStatus = pgEnum("pay_rule_status", ["proposed", "approved", "rejected"]);

const governance = {
  status: payRuleStatus("status").notNull().default("proposed"),
  note: text("note"),
  proposedByPersonId: uuid("proposed_by_person_id").references(() => person.id),
  decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
};

// ── Pay profiles (SRS D18, FR-PAY-07, FR-PAY-08) ────────────────────────────────────────────

export const payProfileKind = pgEnum("pay_profile_kind", ["statutory", "simple"]);
// Why someone is paid "salary only" — what the owner's exposure report groups by (risk R11).
export const simpleProfileBasis = pgEnum("simple_profile_basis", ["probation", "internship", "service_contract", "short_term", "retiree", "other"]);
export const taxResidency = pgEnum("tax_residency", ["resident", "non_resident"]);
// How PIT is worked out under the Statutory profile. The Simple profile's treatment is the
// entity's policy (`simplePitTreatment`), not a property of the person.
export const pitMethod = pgEnum("pit_method", ["progressive", "flat_without_contract", "flat_non_resident"]);
// null on the row = contributes in full. The engine turns each reason into which funds are skipped.
export const insuranceExemption = pgEnum("insurance_exemption", ["probation", "retiree", "insured_elsewhere", "foreigner", "other"]);

export const payProfile = pgTable(
  "pay_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    employmentId: uuid("employment_id")
      .notNull()
      .references(() => employment.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    profile: payProfileKind("profile").notNull(),
    simpleBasis: simpleProfileBasis("simple_basis"),
    // When the owner wants to look at this person's Simple profile again.
    reviewDate: date("review_date"),
    taxResidency: taxResidency("tax_residency").notNull().default("resident"),
    pitMethod: pitMethod("pit_method").notNull().default("progressive"),
    // Form 08/CK-TNCN on file: no 10% withholding although there is no long contract (FR-PAY-14).
    pitCommitment: boolean("pit_commitment").notNull().default(false),
    insuranceExemption: insuranceExemption("insurance_exemption"),
    unionMember: boolean("union_member").notNull().default(false),
    validFrom: date("valid_from").notNull(),
    // Last day, inclusive. null = open-ended.
    validTo: date("valid_to"),
    ...governance,
    ...timestamps,
  },
  (t) => [
    index("pay_profile_person_idx").on(t.personId, t.validFrom),
    index("pay_profile_entity_idx").on(t.entityId, t.profile),
    check("pay_profile_dates_check", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
    check("pay_profile_basis_check", sql`(${t.profile} = 'simple') = (${t.simpleBasis} IS NOT NULL)`),
  ],
).enableRLS();

// ── Pay component catalogue (FR-PAY-02) ─────────────────────────────────────────────────────

export const payComponentKind = pgEnum("pay_component_kind", ["earning", "deduction", "employer_cost"]);
export const payComponentCategory = pgEnum("pay_component_category", [
  "salary",
  "allowance",
  "overtime",
  "bonus",
  "commission",
  "thirteenth_month",
  "holiday_bonus",
  "leave_payout",
  "retro",
  "insurance",
  "pit",
  "union",
  "advance",
  "penalty",
  "asset_compensation",
  "loan",
  "other",
]);
export const payTaxTreatment = pgEnum("pay_tax_treatment", ["taxable", "exempt", "exempt_up_to_cap"]);
export const payProration = pgEnum("pay_proration", ["fixed", "attendance"]);
// Where a line's amount comes from: the person's salary structure, a formula, the engine's own
// statutory calculation (insurance, PIT, overtime), or a figure typed into the run (a bonus, an advance).
export const payComponentSource = pgEnum("pay_component_source", ["structure", "formula", "engine", "input"]);

// One row = one version of a component. entity_id null = the group's catalogue; an entity's own
// version of a code replaces the group's. Approved versions of one (scope, code) never overlap.
export const payComponent = pgTable(
  "pay_component",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    kind: payComponentKind("kind").notNull(),
    category: payComponentCategory("category").notNull(),
    source: payComponentSource("source").notNull(),
    taxTreatment: payTaxTreatment("tax_treatment").notNull().default("taxable"),
    // Monthly exempt amount in VND for `exempt_up_to_cap`. A rule, not a person's pay.
    exemptCap: integer("exempt_cap"),
    subjectToInsurance: boolean("subject_to_insurance").notNull().default(false),
    proration: payProration("proration").notNull().default("fixed"),
    // A name from engine/rounding.ts.
    roundingRule: text("rounding_rule").notNull().default("half_up"),
    // The safe expression language of engine/formula; checked when proposed.
    formula: text("formula"),
    sortOrder: integer("sort_order").notNull().default(100),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...governance,
    ...timestamps,
  },
  (t) => [
    index("pay_component_code_idx").on(t.code, t.validFrom),
    check("pay_component_dates_check", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
    check("pay_component_code_check", sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,39}$'`),
    check("pay_component_cap_check", sql`(${t.taxTreatment} = 'exempt_up_to_cap') = (${t.exemptCap} IS NOT NULL)`),
    check("pay_component_formula_check", sql`(${t.source} = 'formula') = (${t.formula} IS NOT NULL)`),
  ],
).enableRLS();

// ── Company pay rules per entity (FR-PAY-12, 16, 31; SRS D17) ───────────────────────────────

// Choices the law leaves to the company — how to pro-rate, whether there is a union, how the
// Simple profile is taxed, what counts as an anomaly. entity_id null = the group's default.
export const payrollPolicy = pgTable(
  "payroll_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    value: jsonb("value").$type<PayrollPolicyValue>().notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...governance,
    ...timestamps,
  },
  (t) => [index("payroll_policy_entity_idx").on(t.entityId, t.validFrom), check("payroll_policy_dates_check", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`)],
).enableRLS();

// ── Salary structures (FR-PAY-01, FR-PAY-04) ────────────────────────────────────────────────

export const salaryChangeReason = pgEnum("salary_change_reason", ["initial", "probation_end", "raise", "promotion", "adjustment", "contract_renewal"]);

// Effective-dated; one employment's structures never overlap. Every row comes out of an approved
// `salary_change` request. `terms_enc` = { baseSalary, insuranceSalary, allowances: [{ code, amount }] }
// encrypted with context "salary_structure.terms:<id>".
export const salaryStructure = pgTable(
  "salary_structure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    employmentId: uuid("employment_id")
      .notNull()
      .references(() => employment.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    termsEnc: text("terms_enc").notNull(),
    reason: salaryChangeReason("reason").notNull(),
    // The approval request this came from (no foreign key across modules' tables) and the number
    // of the decision document generated from it.
    approvalRequestId: uuid("approval_request_id"),
    decisionNumber: text("decision_number"),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("salary_structure_person_idx").on(t.personId, t.validFrom),
    index("salary_structure_entity_idx").on(t.entityId, t.validFrom),
    // Decision numbers are counted per entity and year; two approvals at once must not share one.
    uniqueIndex("salary_structure_decision_number_key").on(t.entityId, t.decisionNumber),
    check("salary_structure_dates_check", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
).enableRLS();

// ── Payroll runs (FR-PAY-19, 30; SRS D17) ───────────────────────────────────────────────────

// `regular` pays an entity's month from its locked timesheet; `off_cycle` pays something extra
// inside a month already run — a bonus, and in Phase 8 the year-end bonus (FR-PAY-21).
export const payrollRunKind = pgEnum("payroll_run_kind", ["regular", "off_cycle"]);
// The lifecycle of SRS D17: draft → calculated → proposed (HR lead) → approved (the CEO signs) →
// payment_prepared (the chief accountant) → paid → locked. `lifecycle.ts` owns the transitions.
export const payrollRunStatus = pgEnum("payroll_run_status", ["draft", "calculated", "proposed", "approved", "payment_prepared", "paid", "locked", "cancelled"]);

// How the calculation of a run is getting on (ADR-09). `queued` is picked up by the
// `payroll-calculate` job, so a calculation that died with its server finishes by itself.
export const payrollCalcState = pgEnum("payroll_calc_state", ["idle", "queued", "running", "done", "failed"]);

export const payrollRun = pgTable(
  "payroll_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    /** "2026-08" — the month the pay belongs to and is taxed in. */
    month: text("month").notNull(),
    kind: payrollRunKind("kind").notNull().default("regular"),
    status: payrollRunStatus("status").notNull().default("draft"),
    /** What this run is called on screen; an off-cycle run needs one ("Thưởng dự án tháng 8"). */
    name: text("name"),
    note: text("note"),
    /**
     * Everything the calculation was made from: engine version, policy version, statutory
     * parameter versions, component versions, the timesheet lock (`CalculationContext`). Rules and
     * ids, never money — this is what makes a payslip reproducible (FR-PAY-20).
     */
    context: jsonb("context"),
    /** The run's totals, encrypted: context "payroll_run.totals:<id>". */
    totalsEnc: text("totals_enc"),
    headcount: integer("headcount").notNull().default(0),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),

    // ── The lifecycle (FR-PAY-30): who carried the run forward, and when ──
    // Each step is a signature. `payroll_run_event` keeps the whole history including returns;
    // these columns are the current state, so a list does not need the events.
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    proposedByPersonId: uuid("proposed_by_person_id").references(() => person.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByPersonId: uuid("approved_by_person_id").references(() => person.id),
    paymentPreparedAt: timestamp("payment_prepared_at", { withTimezone: true }),
    paymentPreparedByPersonId: uuid("payment_prepared_by_person_id").references(() => person.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByPersonId: uuid("paid_by_person_id").references(() => person.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByPersonId: uuid("locked_by_person_id").references(() => person.id),
    /**
     * When the payslips of this run were released to the people in it (FR-PAY-32). Not a status of
     * its own: publishing happens after the CEO has signed and does not carry the run forward. The
     * ops tracker closes "Phát hành phiếu lương" off this date.
     */
    payslipsPublishedAt: timestamp("payslips_published_at", { withTimezone: true }),
    payslipsPublishedByPersonId: uuid("payslips_published_by_person_id").references(() => person.id),

    // ── Calculation progress (ADR-09) ──
    calcState: payrollCalcState("calc_state").notNull().default("idle"),
    /** People stored so far, and how many there are to store. Counts, not money. */
    calcDone: integer("calc_done").notNull().default(0),
    calcTotal: integer("calc_total").notNull().default(0),
    calcStartedAt: timestamp("calc_started_at", { withTimezone: true }),
    /** Refreshed as the calculation works; a claim that stops beating is taken over. */
    calcHeartbeatAt: timestamp("calc_heartbeat_at", { withTimezone: true }),
    /** Who holds the calculation: one worker at a time, whoever wrote this token. */
    calcClaim: uuid("calc_claim"),
    /** Why the last attempt stopped. A message about the run, never about a person's pay. */
    calcError: text("calc_error"),
    ...timestamps,
  },
  (t) => [
    index("payroll_run_entity_month_idx").on(t.entityId, t.month),
    // One live regular run per entity and month; off-cycle runs are as many as the month needs.
    uniqueIndex("payroll_run_regular_key").on(t.entityId, t.month).where(sql`${t.kind} = 'regular' AND ${t.status} <> 'cancelled'`),
    check("payroll_run_month_check", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
  ],
).enableRLS();

// Every step a run was carried through, in order, with who did it and what they said (FR-PAY-30).
// The CEO's return to HR is a step like any other, so a run that went back and forth shows it.
// Append-only: a database trigger refuses updates and deletes, like the audit log.
export const payrollRunEvent = pgTable(
  "payroll_run_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    fromStatus: payrollRunStatus("from_status").notNull(),
    toStatus: payrollRunStatus("to_status").notNull(),
    /** null when the step was taken by a job rather than a person. */
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    /** The CEO's reason for sending it back, the accountant's note. Words, never figures. */
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payroll_run_event_run_idx").on(t.runId, t.createdAt)],
).enableRLS();

// One person's line in a run. `result_enc` is the whole `PersonPayResult` (lines, totals,
// insurance, PIT, trace) and `input_enc` the `PersonPayInput` it was calculated from — keeping the
// input is what lets a month be recomputed exactly, and a timesheet correction be turned into
// money without guessing (FR-PAY-17, 20).
export const payrollRunPerson = pgTable(
  "payroll_run_person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    profile: payProfileKind("profile").notNull(),
    /** Context "payroll_run_person.result:<id>" and "payroll_run_person.input:<id>". */
    resultEnc: text("result_enc").notNull(),
    inputEnc: text("input_enc").notNull(),
    /** Names of the engine's warnings — `negative_net` and the like. Never an amount. */
    warnings: text("warnings").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payroll_run_person_key").on(t.runId, t.personId), index("payroll_run_person_person_idx").on(t.personId)],
).enableRLS();

// A figure typed into a run for one person: a bonus, a commission, an advance, a penalty. The
// catalogue decides what each code means; the amount is encrypted like every other figure.
export const payrollRunInput = pgTable(
  "payroll_run_input",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    code: text("code").notNull(),
    /** Context "payroll_run_input.amount:<id>". */
    amountEnc: text("amount_enc").notNull(),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_run_input_key").on(t.runId, t.personId, t.code)],
).enableRLS();

// ── Payslips (FR-PAY-32) ────────────────────────────────────────────────────────────────────

// A payslip is a **publication record**, not a second copy of the figures: what the person reads
// is their `payroll_run_person` result, and this row says that it was released to them, when, and
// whether they have looked at it. One source of truth, so a payslip can never drift from the run.
//
// Nothing here is published before the CEO has signed (FR-PAY-30): `publishPayslips` refuses it.
export const payslip = pgTable(
  "payslip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    month: text("month").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedByPersonId: uuid("published_by_person_id").references(() => person.id),
    /** When the person first opened it, and last opened it. Counts, not money — HR chases the unread. */
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One payslip per person per run; publishing twice changes nothing (idempotent).
    uniqueIndex("payslip_run_person_key").on(t.runId, t.personId),
    index("payslip_person_idx").on(t.personId, t.month),
    index("payslip_entity_month_idx").on(t.entityId, t.month),
  ],
).enableRLS();

export const payslipQueryStatus = pgEnum("payslip_query_status", ["open", "answered", "closed"]);

// "Why is my net lower this month?" — the employee asks, C&B answers (FR-PAY-32). The thread lives
// beside the payslip and is visible to exactly the people the payslip is: its owner, C&B, the owner.
export const payslipQuery = pgTable(
  "payslip_query",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslip.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    status: payslipQueryStatus("status").notNull().default("open"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("payslip_query_payslip_idx").on(t.payslipId), index("payslip_query_entity_idx").on(t.entityId, t.status)],
).enableRLS();

// One message in the thread. Append-only by a database trigger: an answer about someone's pay is
// evidence, and neither side rewrites what was said.
export const payslipQueryMessage = pgTable(
  "payslip_query_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryId: uuid("query_id")
      .notNull()
      .references(() => payslipQuery.id, { onDelete: "cascade" }),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    /** Words. A figure the two of them quote is their own doing — nothing here is machine-read. */
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payslip_query_message_query_idx").on(t.queryId, t.createdAt)],
).enableRLS();

// ── Paying the run (FR-PAY-33, FR-PAY-39) ───────────────────────────────────────────────────

export const paymentChannel = pgEnum("payment_channel", ["bank", "cash"]);

/**
 * A bulk-transfer file that was generated, and by whom (FR-PAY-33). **The file itself is not
 * stored**: it carries every account number and every net figure in one place, and it can be
 * rebuilt byte for byte from the approved run at any time. What is kept is the receipt — who
 * generated what, how many rows it had and what it came to — so the accountant can prove the
 * batch they uploaded matches the run the CEO signed.
 */
export const payrollPaymentFile = pgTable(
  "payroll_payment_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    channel: paymentChannel("channel").notNull(),
    /** "vcb", "acb" — a key of the format registry; null for the cash sheet. */
    bank: text("bank"),
    /** The format module's own version, so a file made last month can be told from this month's. */
    formatVersion: text("format_version").notNull(),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull(),
    /** People left out because their pay account is missing or malformed — never silently dropped. */
    skippedCount: integer("skipped_count").notNull().default(0),
    /** The batch total, encrypted: context "payroll_payment_file.total:<id>". */
    totalEnc: text("total_enc").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedByPersonId: uuid("generated_by_person_id").references(() => person.id),
  },
  (t) => [index("payroll_payment_file_run_idx").on(t.runId, t.generatedAt)],
).enableRLS();

/**
 * Cash paid into someone's hand (FR-PAY-39, SRS D18). One row per Simple-profile person in the
 * run: the sheet they are listed on, the disbursement the chief accountant records, and the
 * receipt the person confirms in the app — or the signed paper sheet, scanned and attached to
 * the run. A run is "paid" only once every one of these rows has been disbursed.
 */
export const payrollCashPayment = pgTable(
  "payroll_cash_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    /** The net to hand over, frozen from the run: context "payroll_cash_payment.amount:<id>". */
    amountEnc: text("amount_enc").notNull(),
    /** The day the money changed hands, and who handed it over (the chief accountant). */
    disbursedOn: date("disbursed_on"),
    disbursedByPersonId: uuid("disbursed_by_person_id").references(() => person.id),
    disbursementNote: text("disbursement_note"),
    /** The person's own confirmation in the app. Nobody may confirm on their behalf. */
    receiptConfirmedAt: timestamp("receipt_confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_cash_payment_key").on(t.runId, t.personId), index("payroll_cash_payment_person_idx").on(t.personId)],
).enableRLS();

// ── Retroactive items (FR-PAY-17) ───────────────────────────────────────────────────────────

export const retroItemKind = pgEnum("retro_item_kind", ["salary_change", "timesheet_adjustment", "manual"]);
export const retroItemStatus = pgEnum("retro_item_status", ["open", "taken", "cancelled"]);

// A difference belonging to a month that is already paid, waiting for the next run to carry it.
// The month itself is never re-opened (DR-07).
export const payrollRetroItem = pgTable(
  "payroll_retro_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    /** The month the difference belongs to, "2026-07". */
    sourceMonth: text("source_month").notNull(),
    kind: retroItemKind("kind").notNull(),
    status: retroItemStatus("status").notNull().default("open"),
    /** Signed: owed to the person, or to recover. Context "payroll_retro_item.amount:<id>". */
    amountEnc: text("amount_enc").notNull(),
    /** Why there is a difference. Words, never figures — it is shown beside the payslip line. */
    reason: text("reason").notNull(),
    /**
     * The month's declared insurance base changed too. Payroll cannot correct a filed
     * contribution: the BHXH adjustment declaration must (FR-PAY-35).
     */
    insuranceBaseChanged: boolean("insurance_base_changed").notNull().default(false),
    /** What it came from: a `timesheet_adjustment` id, a `salary_structure` id, or nothing. */
    sourceRef: uuid("source_ref"),
    /** Set when a run takes the item in: the run's month and the run itself. */
    payrollMonth: text("payroll_month"),
    runId: uuid("run_id").references(() => payrollRun.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("payroll_retro_item_entity_idx").on(t.entityId, t.status),
    index("payroll_retro_item_person_idx").on(t.personId, t.sourceMonth),
    // One item per source of a difference: re-deriving a correction never doubles it.
    uniqueIndex("payroll_retro_item_source_key").on(t.personId, t.kind, t.sourceRef).where(sql`${t.sourceRef} IS NOT NULL AND ${t.status} <> 'cancelled'`),
  ],
).enableRLS();

// ── Year-to-date figures brought in from outside the system (FR-PAY-35) ─────────────────────

// A person whose tax year started before the system did still needs a full finalization. These
// are the months nobody here calculated, imported once per person per year and added to what the
// runs know. Encrypted like everything else about a person's pay.
export const payrollYtd = pgTable(
  "payroll_ytd",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    year: integer("year").notNull(),
    /** How many months of that year these figures cover — the finalization counts them. */
    months: integer("months").notNull().default(0),
    /** Encrypted `YtdFigures` JSON, context "payroll_ytd.figures:<id>". */
    figuresEnc: text("figures_enc").notNull(),
    note: text("note"),
    importBatchId: uuid("import_batch_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  // One row per person per year: a re-import replaces it rather than adding to it.
  (t) => [uniqueIndex("payroll_ytd_person_year_key").on(t.personId, t.year), index("payroll_ytd_entity_idx").on(t.entityId, t.year)],
).enableRLS();

// ── Parallel run (FR-PAY-38) ────────────────────────────────────────────────────────────────

// What the existing method (the accountant's spreadsheet) says a person was paid, so the system's
// own figure can be held against it person by person before go-live.
export const payrollParallelReference = pgTable(
  "payroll_parallel_reference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    month: text("month").notNull(),
    /** Encrypted `ReferenceFigures` JSON, context "payroll_parallel_reference.figures:<id>". */
    figuresEnc: text("figures_enc").notNull(),
    note: text("note"),
    importBatchId: uuid("import_batch_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_parallel_reference_key").on(t.entityId, t.month, t.personId), index("payroll_parallel_reference_person_idx").on(t.personId, t.month)],
).enableRLS();

// Every difference starts unexplained; go-live needs none left (development plan §3, Phase 5).
export const parallelFindingClass = pgEnum("parallel_finding_class", ["system_bug", "spreadsheet_error", "rule_gap", "accepted_rounding"]);

// One person's one differing figure, and what it was found to be. The difference it was explained
// against is kept with it: if the run is recalculated and the gap changes, the explanation no
// longer covers it and the reconciliation shows the line as unexplained again.
export const payrollParallelFinding = pgTable(
  "payroll_parallel_finding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    month: text("month").notNull(),
    /** Which figure differs: "net", "pit", "employeeInsurance", … */
    field: text("field").notNull(),
    /** Encrypted signed difference the classification was made against, context "payroll_parallel_finding.delta:<id>". */
    deltaEnc: text("delta_enc").notNull(),
    classification: parallelFindingClass("classification").notNull(),
    /** Why — required, because an unexplained difference is the thing this table exists to remove. */
    note: text("note").notNull(),
    classifiedByPersonId: uuid("classified_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_parallel_finding_key").on(t.entityId, t.month, t.personId, t.field), index("payroll_parallel_finding_month_idx").on(t.entityId, t.month)],
).enableRLS();
