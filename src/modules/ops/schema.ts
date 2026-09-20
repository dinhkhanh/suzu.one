// Operations & compliance tracker (FR-OPS). An obligation *instance* is a row of the task engine's
// one `task` table (ADR-10, kind = "obligation") plus its 1:1 extension here: which template and
// period it belongs to and the evidence that it was done. Value lists are in enums.ts.
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import { task } from "../platform/tasks-engine/schema";
import type { DueRule } from "./engine/due-rule";
import type { ChecklistState, Escalation, EvidenceRequirement, ObligationLink } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// A recurring or event-driven duty (FR-OPS-01). Shared by the group; `entity_ids` narrows it.
export const obligationTemplate = pgTable(
  "obligation_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    authority: text("authority").notNull(),
    recurrence: text("recurrence").notNull(),
    dueRule: jsonb("due_rule").$type<DueRule>().notNull(),
    shift: text("shift").notNull().default("next_working_day"),
    // For recurrence = "event": what in HR starts it (enums.ts EVENT_TYPES).
    eventType: text("event_type"),
    // null = every active entity.
    entityIds: jsonb("entity_ids").$type<string[] | null>(),
    ownerRule: text("owner_rule").notNull(),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    reviewerRule: text("reviewer_rule").notNull().default("none"),
    reviewerPersonId: uuid("reviewer_person_id").references(() => person.id),
    checklist: jsonb("checklist").$type<string[]>().notNull().default([]),
    guidance: text("guidance"),
    links: jsonb("links").$type<ObligationLink[]>().notNull().default([]),
    reminderLeadDays: jsonb("reminder_lead_days").$type<number[]>().notNull().default([7, 3, 1]),
    escalation: jsonb("escalation").$type<Escalation>().notNull().default({ managerAfterDays: 3, executiveAfterDays: 7 }),
    evidence: jsonb("evidence").$type<EvidenceRequirement>().notNull().default({ file: false, reference: false, submittedDate: false, amount: false }),
    penaltyNote: text("penalty_note"),
    // The starter library is a draft until the chief accountant and the HR lead have been through it.
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => person.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("obligation_template_recurrence_idx").on(t.recurrence)],
).enableRLS();

export const obligationInstance = pgTable(
  "obligation_instance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .unique()
      .references(() => task.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => obligationTemplate.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    // "2026-09", "2026-Q3", "2026-H1", "2026", or "event:<source id>[:suffix]".
    periodKey: text("period_key").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    // Before weekends and holidays moved it; the task's due date is the shifted one.
    nominalDueDate: date("nominal_due_date").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    reviewerPersonId: uuid("reviewer_person_id").references(() => person.id),
    checklistState: jsonb("checklist_state").$type<ChecklistState>().notNull().default({}),
    // Evidence (FR-OPS-05). Files sit in the files module under ownerType "obligation_instance".
    referenceNumber: text("reference_number"),
    submittedDate: date("submitted_date"),
    amountPaid: bigint("amount_paid", { mode: "number" }),
    note: text("note"),
    completedLate: boolean("completed_late"),
    reopenReason: text("reopen_reason"),
    ...timestamps,
  },
  (t) => [unique("obligation_instance_period_key").on(t.templateId, t.entityId, t.periodKey), index("obligation_instance_entity_idx").on(t.entityId), index("obligation_instance_source_idx").on(t.sourceType, t.sourceId)],
).enableRLS();

// One row per reminder or escalation already sent, so the daily job can run twice (week 5).
export const obligationNoticeSent = pgTable(
  "obligation_notice_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => obligationInstance.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("obligation_notice_sent_key").on(t.instanceId, t.key)],
).enableRLS();
