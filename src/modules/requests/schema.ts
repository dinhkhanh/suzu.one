// The generic request builder's tables (FR-REQ-01, 02). A `request_type` is a form and a name;
// its approval flow is an ordinary `approval_flow` row for `request:<code>`, because the approval
// engine already owns flows and nothing here should fork it.
//
// A submission is an `approval_request` like any other — inbox, delegation, history and bulk
// approve all work untouched. This table holds only what the engine has no business knowing: the
// answers, the attachments, and the figure a report adds up.
import { bigint, boolean, date, index, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { payrollRun } from "../payroll/schema";
import { approvalRequest } from "../platform/approvals/schema";
import { storedFile } from "../platform/files/schema";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { ExpenseCategory } from "./engine/expense";
import type { FormDefinition } from "./engine/form";

export const requestType = pgTable(
  "request_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lower-case identifier; the approval request type is `request:<code>`.
    code: text("code").notNull().unique(),
    nameVi: text("name_vi").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionVi: text("description_vi"),
    descriptionEn: text("description_en"),
    // Groups the types on the "new request" screen: purchase, finance, hr, it, admin, other.
    category: text("category").notNull().default("other"),
    // Which entity may use it; null = the whole group.
    entityId: uuid("entity_id").references(() => entity.id),
    // A FormDefinition (engine/form.ts), validated when it is saved.
    form: jsonb("form").$type<FormDefinition>().notNull().default({ fields: [] }),
    // A lucide icon name shown on the picker; free text, unknown names fall back to a default.
    icon: text("icon"),
    sortOrder: smallint("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    // FR-PLT-23: nudge an approver who has not answered after this many days, escalate after that
    // many. 0 = off. `slaEscalateTo` is an ApproverRule, resolved when the escalation fires.
    slaRemindAfterDays: smallint("sla_remind_after_days").notNull().default(0),
    slaEscalateAfterDays: smallint("sla_escalate_after_days").notNull().default(0),
    slaEscalateTo: jsonb("sla_escalate_to").$type<Record<string, unknown> | null>(),
    updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("request_type_active_idx").on(t.active, t.sortOrder)],
).enableRLS();

export const requestSubmission = pgTable(
  "request_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequest.id),
    requestTypeId: uuid("request_type_id")
      .notNull()
      .references(() => requestType.id),
    // The code as it was at submission: a type may be renamed or switched off afterwards.
    typeCode: text("type_code").notNull(),
    // The answers, keyed by field. Only fields that were actually shown (engine/form.ts).
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
    // Stored-file ids from the form's `file` fields, flattened for the vault's owner look-up.
    attachmentFileIds: uuid("attachment_file_ids").array(),
    // The figure the type calls its amount, in whole đồng, when it has one — so purchase and
    // payment requests can be reported and a flow can condition on it.
    amount: bigint("amount", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("request_submission_approval_key").on(t.approvalRequestId), index("request_submission_type_idx").on(t.requestTypeId, t.createdAt)],
).enableRLS();

// ── Expense claims (FR-REQ-03) ──────────────────────────────────────────────────────────────
//
// A claim *is* a submission — the form, the flow, the inbox, the SLA clock and the deep links all
// come from the builder. These two tables hold the only things a generic form cannot express: the
// lines it is made of, and the fact that it was handed to payroll.

export const expenseClaimLine = pgTable(
  "expense_claim_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => requestSubmission.id, { onDelete: "cascade" }),
    // The day the money was spent, not the day the claim was filed.
    lineDate: date("line_date").notNull(),
    category: text("category").$type<ExpenseCategory>().notNull(),
    description: text("description").notNull(),
    // Whole đồng, always positive. Not encrypted: a person's own out-of-pocket spend is `personal`,
    // not compensation — it buys a taxi, it does not say what anybody earns.
    amount: bigint("amount", { mode: "number" }).notNull(),
    receiptFileId: uuid("receipt_file_id").references(() => storedFile.id),
    // The project, client or job the spend belongs to. Free text: no project register exists yet.
    projectTag: text("project_tag"),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [index("expense_claim_line_submission_idx").on(t.submissionId, t.sortOrder)],
).enableRLS();

/**
 * One claim handed to one payroll run. **The unique key on `submission_id` is what makes paying a
 * claim twice impossible** — not a check in the service, which two approvals landing together
 * would both pass. Removing the row (a cancelled run) puts the claim back to waiting, which is why
 * the posting is a row of its own rather than a column on the submission.
 */
export const expenseClaimPosting = pgTable(
  "expense_claim_posting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => requestSubmission.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRun.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    // Repeated from the lines so the run's figure can be rebuilt without reading them all back.
    amount: bigint("amount", { mode: "number" }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    postedByPersonId: uuid("posted_by_person_id").references(() => person.id),
  },
  (t) => [unique("expense_claim_posting_submission_key").on(t.submissionId), index("expense_claim_posting_run_idx").on(t.runId, t.personId)],
).enableRLS();
