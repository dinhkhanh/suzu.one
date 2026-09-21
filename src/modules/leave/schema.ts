// Leave tables (FR-LVE-01..05, 07, 08): leave types, their effective-dated policies, the balance
// ledger, requests with their days, and minimum-staffing rules. Amounts are integer hundredths of
// a day ("centi": 150 = one and a half days) so nothing is a float.
import { boolean, date, index, integer, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { approvalRequest } from "../platform/approvals/schema";
import { storedFile } from "../platform/files/schema";
import { entity, orgUnit } from "../platform/org/schema";
import { person } from "../platform/people/schema";

export const leaveCategory = pgEnum("leave_category", ["annual", "sick", "maternity", "paternity", "personal_paid", "unpaid", "compensatory", "company"]);
// What payroll does with a day of this leave: the company pays it, social insurance pays it
// (the company does not), or nobody does.
export const leavePayrollTreatment = pgEnum("leave_payroll_treatment", ["paid_company", "paid_insurance", "unpaid"]);
export const leaveGender = pgEnum("leave_gender", ["male", "female"]);

// A kind of leave. `entity_id` null = every entity; an entity's own row with the same code wins
// (FR-LVE-01: configurable per entity).
export const leaveType = pgTable(
  "leave_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    category: leaveCategory("category").notNull(),
    isPaid: boolean("is_paid").notNull(),
    payrollTreatment: leavePayrollTreatment("payroll_treatment").notNull(),
    // true = days come out of a balance (annual, compensatory, birthday); false = taken as the event arises (sick, maternity, unpaid).
    tracksBalance: boolean("tracks_balance").notNull().default(false),
    allowHalfDay: boolean("allow_half_day").notNull().default(true),
    allowHourly: boolean("allow_hourly").notNull().default(false),
    requiresAttachment: boolean("requires_attachment").notNull().default(false),
    // Calendar days between filing and the first day of leave. 0 = may be filed on the day (or after: sick leave).
    noticeDays: smallint("notice_days").notNull().default(0),
    allowBackdated: boolean("allow_backdated").notNull().default(false),
    // Counted leave days in one request; null = no limit. The paid personal days of the labour code live here as data.
    maxDaysPerRequestCenti: integer("max_days_per_request_centi"),
    // null = every workforce type.
    eligibleWorkforceTypes: text("eligible_workforce_types").array(),
    gender: leaveGender("gender"),
    minSeniorityMonths: smallint("min_seniority_months"),
    // Long absences (maternity, long sick leave, sabbatical) become a lifecycle event on approval (FR-LVE-08).
    isLongTerm: boolean("is_long_term").notNull().default(false),
    // Whether "working, no punches" days (Saturday WFH) count as leave days. Off for balance leave,
    // on for long and unpaid absences so that those Saturdays are not credited as worked.
    countsUntrackedDays: boolean("counts_untracked_days").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("leave_type_entity_code_key").on(t.entityId, t.code).nullsNotDistinct()],
).enableRLS();

export const leaveAccrualMethod = pgEnum("leave_accrual_method", ["none", "monthly_accrual", "yearly_grant"]);
export const leaveBaseSource = pgEnum("leave_base_source", ["statutory_annual", "fixed"]);
export const leaveProbationRule = pgEnum("leave_probation_rule", ["accrue_and_use", "accrue_no_use", "no_accrual"]);
export const leaveRounding = pgEnum("leave_rounding", ["none", "half_day", "full_day"]);

// How a balance-tracked type earns, carries over and expires — company policy, effective-dated.
// The statutory numbers (12 days, +1 per 5 years) are not here: they come from the parameter store.
// `entity_id` null = every entity; an entity's own policy wins. Versions of one (type, entity)
// never overlap (exclusion constraint in the migration).
export const leavePolicy = pgTable(
  "leave_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveType.id),
    entityId: uuid("entity_id").references(() => entity.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    accrualMethod: leaveAccrualMethod("accrual_method").notNull(),
    baseSource: leaveBaseSource("base_source").notNull().default("fixed"),
    fixedDaysCenti: integer("fixed_days_centi").notNull().default(0),
    // Company days on top of the base.
    extraDaysCenti: integer("extra_days_centi").notNull().default(0),
    seniorityBonus: boolean("seniority_bonus").notNull().default(false),
    prorate: boolean("prorate").notNull().default(true),
    rounding: leaveRounding("rounding").notNull().default("half_day"),
    probationRule: leaveProbationRule("probation_rule").notNull().default("accrue_no_use"),
    // null = everything carries over; 0 = nothing does.
    carryOverCapCenti: integer("carry_over_cap_centi"),
    // "MM-DD" in the following year after which carried days lapse; null = they never do.
    carryOverExpiry: text("carry_over_expiry"),
    payoutOnTermination: boolean("payout_on_termination").notNull().default(false),
    // How far below zero a balance may go (leave in advance).
    allowNegativeCenti: integer("allow_negative_centi").notNull().default(0),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_policy_type_idx").on(t.leaveTypeId)],
).enableRLS();

export const leaveLedgerKind = pgEnum("leave_ledger_kind", ["opening", "accrual", "grant", "use", "refund", "adjustment", "expiry", "carry_over", "payout"]);

// Every movement of a balance (FR-LVE-07). Rows are only ever added: a mistake is corrected by
// another row. `amount_centi` is signed: positive adds days, negative takes them.
export const leaveLedgerEntry = pgTable(
  "leave_ledger_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveType.id),
    leaveYear: smallint("leave_year").notNull(),
    kind: leaveLedgerKind("kind").notNull(),
    amountCenti: integer("amount_centi").notNull(),
    effectiveDate: date("effective_date").notNull(),
    // Set by the jobs and by request postings so that a second run adds nothing.
    sourceKey: text("source_key").unique(),
    requestId: uuid("request_id"),
    reason: text("reason"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_ledger_person_idx").on(t.personId, t.leaveTypeId, t.leaveYear), index("leave_ledger_entity_date_idx").on(t.entityId, t.effectiveDate)],
).enableRLS();

export const leaveRequestStatus = pgEnum("leave_request_status", ["pending", "approved", "rejected", "withdrawn", "cancelled"]);
export const leavePortion = pgEnum("leave_portion", ["full", "am", "pm", "hours"]);

// A request for leave. It stays "pending" while the approval engine has it (incl. returned for
// changes); the approval request is the source of truth for who answers next.
export const leaveRequest = pgTable(
  "leave_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveType.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // One day: the part of it (full | am | pm | hours). Several days: start is full | pm, end is full | am.
    startPortion: leavePortion("start_portion").notNull().default("full"),
    endPortion: leavePortion("end_portion").notNull().default("full"),
    // Hourly leave only (one date).
    minutes: smallint("minutes"),
    totalCenti: integer("total_centi").notNull(),
    reason: text("reason"),
    attachmentFileId: uuid("attachment_file_id").references(() => storedFile.id),
    status: leaveRequestStatus("status").notNull().default("pending"),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequest.id),
    // The request this one replaces (amend = cancel + file again, in one transaction).
    amendsRequestId: uuid("amends_request_id"),
    filedByPersonId: uuid("filed_by_person_id").references(() => person.id),
    cancelledByPersonId: uuid("cancelled_by_person_id").references(() => person.id),
    cancelReason: text("cancel_reason"),
    lifecycleEventId: uuid("lifecycle_event_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_request_person_idx").on(t.personId, t.startDate), index("leave_request_approval_idx").on(t.approvalRequestId)],
).enableRLS();

// The counted days of a request — what the team calendar and the timesheet read.
export const leaveRequestDay = pgTable(
  "leave_request_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => leaveRequest.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    portion: leavePortion("portion").notNull(),
    amountCenti: integer("amount_centi").notNull(),
    minutes: smallint("minutes"),
  },
  (t) => [unique("leave_request_day_request_date_key").on(t.requestId, t.date), index("leave_request_day_person_date_idx").on(t.personId, t.date)],
).enableRLS();

// Minimum staffing (FR-LVE-05): at least `min_present` people of a team — or of a department,
// optionally narrowed to one entity — must be at work. Breaking it warns; it does not block.
export const teamStaffingRule = pgTable(
  "team_staffing_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    teamId: uuid("team_id").references(() => orgUnit.id),
    minPresent: smallint("min_present").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("team_staffing_rule_scope_key").on(t.entityId, t.departmentId, t.teamId).nullsNotDistinct()],
).enableRLS();
