// The approval engine's tables (SRS §3.1, FR-PLT-20..22). One request walks through ordered steps;
// each step has its own approvers. Leave, OT, change requests, payroll sign-off and purchase
// requests all store their requests here and keep only their own business data elsewhere.
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { entity } from "../org/schema";
import { person } from "../people/schema";

export const approvalRequestStatus = pgEnum("approval_request_status", ["pending", "approved", "rejected", "returned", "withdrawn", "cancelled"]);
export const approvalStepMode = pgEnum("approval_step_mode", ["any", "all"]);
export const approvalStepStatus = pgEnum("approval_step_status", ["waiting", "pending", "approved", "rejected", "skipped"]);
export const approvalAssigneeStatus = pgEnum("approval_assignee_status", ["pending", "approved", "rejected", "returned"]);
export const approvalEventType = pgEnum("approval_event_type", ["submitted", "approved", "rejected", "returned", "resubmitted", "commented", "withdrawn", "delegated", "cancelled"]);

export const approvalRequest = pgTable(
  "approval_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The request type, owned by a module: "profile_change", later "leave", "overtime", …
    type: text("type").notNull(),
    // What to call the type in a notification when it has no message key: the request builder's
    // types (FR-REQ-01) are named in the database, and a notification is read outside the app.
    typeName: text("type_name"),
    entityId: uuid("entity_id").references(() => entity.id),
    requesterPersonId: uuid("requester_person_id")
      .notNull()
      .references(() => person.id),
    // Whose data or time the request is about; approver rules (line manager, HR of…) resolve against this person.
    subjectPersonId: uuid("subject_person_id").references(() => person.id),
    // The business record the request is about, when there is one (a leave request row, a payroll run).
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    // One line for inboxes and notifications; never holds restricted values.
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // Restricted parts of the request, envelope-encrypted (context "approval_request.payload:<id>").
    payloadEnc: text("payload_enc"),
    status: approvalRequestStatus("status").notNull().default("pending"),
    currentStep: smallint("current_step").notNull().default(0),
    // The flow as it was resolved when the request was submitted: later edits to a flow never
    // change requests already on their way.
    flowSnapshot: jsonb("flow_snapshot").notNull(),
    // Where the request is opened: a page of the owning module.
    link: text("link"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_request_requester_idx").on(t.requesterPersonId, t.createdAt), index("approval_request_subject_idx").on(t.subjectPersonId, t.type), index("approval_request_status_idx").on(t.status)],
).enableRLS();

export const approvalStep = pgTable(
  "approval_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequest.id),
    stepIndex: smallint("step_index").notNull(),
    key: text("key").notNull(),
    // any = the first approver to answer decides the step; all = everyone must approve.
    mode: approvalStepMode("mode").notNull(),
    status: approvalStepStatus("status").notNull(),
    // Opens together with the step before it (FR-PLT-20: parallel steps).
    parallel: boolean("parallel").notNull().default(false),
  },
  (t) => [unique("approval_step_request_index_key").on(t.requestId, t.stepIndex)],
).enableRLS();

export const approvalAssignee = pgTable(
  "approval_assignee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepId: uuid("step_id")
      .notNull()
      .references(() => approvalStep.id),
    // Repeated from the step so the inbox is one indexed look-up.
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequest.id),
    approverPersonId: uuid("approver_person_id")
      .notNull()
      .references(() => person.id),
    // Set when someone handed their turn to this person (Phase 2: delegation).
    delegatedFromPersonId: uuid("delegated_from_person_id").references(() => person.id),
    status: approvalAssigneeStatus("status").notNull().default("pending"),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approval_assignee_inbox_idx").on(t.approverPersonId, t.status), index("approval_assignee_request_idx").on(t.requestId)],
).enableRLS();

// What happened to a request, in order. Only ever inserted.
export const approvalEvent = pgTable(
  "approval_event",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequest.id),
    type: approvalEventType("type").notNull(),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    stepIndex: smallint("step_index"),
    comment: text("comment"),
    // Facts the owning module wants kept with the decision, e.g. { verifiedSecondChannel: true }.
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_event_request_idx").on(t.requestId, t.id)],
).enableRLS();

// A flow kept as configuration (FR-PLT-20): overrides the default a request type ships in code.
// `entity_id` null = the group's flow for the type; an entity's own flow wins over it.
export const approvalFlow = pgTable(
  "approval_flow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestType: text("request_type").notNull(),
    entityId: uuid("entity_id").references(() => entity.id),
    // A FlowDefinition (engine/flow.ts), validated when it is saved.
    definition: jsonb("definition").notNull(),
    // Switched off = kept for later, not used.
    active: boolean("active").notNull().default(true),
    updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("approval_flow_type_entity_key").on(t.requestType, t.entityId).nullsNotDistinct()],
).enableRLS();

// A standing delegation (FR-PLT-22): while it runs, requests that would reach `from` go to `to`.
// Applied when a request's approvers are resolved; requests already waiting are handed over one
// by one (the ad-hoc delegate action).
export const approvalDelegation = pgTable(
  "approval_delegation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => person.id),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => person.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    // null = every request type.
    requestTypes: text("request_types").array(),
    reason: text("reason"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_delegation_from_idx").on(t.fromPersonId, t.validFrom, t.validTo)],
).enableRLS();
