// Projects & daily work — the project layer (Phase 10, SRS §4.6b). A project is still one
// `work_project` row (the work module owns it and its tasks); everything a project lead plans,
// promises, reports and closes hangs off it here: the plan (type, job number, brief, budget,
// baseline, health), phases and milestones, the deliverables register, retainers, change requests,
// status updates, RAID, meetings, bookings, acceptance, billing items and client reports.
// Money is integer VND and is only ever read with `pjm:commercial` (fees) — cost rates never live here.
import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entity } from "../platform/org/schema";
import { storedFile } from "../platform/files/schema";
import { person } from "../platform/people/schema";
import { task } from "../platform/tasks-engine/schema";
import { workClient, workProject } from "../work/schema";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type ClientContact = { name: string; role?: string; contact?: string };
export type ProjectBrief = {
  objective?: string;
  scopeIn?: string;
  scopeOut?: string;
  successCriteria?: string;
  assumptions?: string;
  audience?: string;
  keyMessages?: string;
  clientContacts?: ClientContact[];
  links?: string[];
};
export type ProjectBaseline = { startDate: string | null; dueDate: string | null; budgetMinutes: number | null; milestones: { id: string; dueDate: string | null }[]; takenAt: string };

// The plan of a project (FR-PJM-01..04, 09, 12, 27, 59): 1:1 with work_project.
export const projectPlan = pgTable(
  "project_plan",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => workProject.id, { onDelete: "cascade" }),
    // client | retainer | pitch | internal
    kind: text("kind").notNull().default("client"),
    // "SZM-26-042" (FR-PJM-02); unique across the group.
    jobNumber: text("job_number").unique(),
    accountManagerPersonId: uuid("account_manager_person_id").references(() => person.id),
    brief: jsonb("brief").$type<ProjectBrief>().notNull().default({}),
    // draft | submitted | approved | returned — the kick-off gate (FR-PJM-03).
    briefStatus: text("brief_status").notNull().default("draft"),
    briefApprovalRequestId: uuid("brief_approval_request_id"),
    briefApprovedAt: timestamp("brief_approved_at", { withTimezone: true }),
    budgetMinutes: integer("budget_minutes"),
    // Fee in VND (`pjm:commercial`).
    feeVnd: bigint("fee_vnd", { mode: "number" }),
    // Budget alerts already sent (80, 100) so each fires once.
    budgetAlerted: jsonb("budget_alerted").$type<number[]>().notNull().default([]),
    baseline: jsonb("baseline").$type<ProjectBaseline>(),
    // on_track | at_risk | off_track — from the latest status update.
    health: text("health"),
    healthUpdatedAt: timestamp("health_updated_at", { withTimezone: true }),
    updateCadenceDays: integer("update_cadence_days").notNull().default(7),
    driveUrl: text("drive_url"),
    // The project's document space on the KB engine (FR-PJM-31).
    kbSpaceId: uuid("kb_space_id"),
    // Close-out (FR-PJM-59).
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByPersonId: uuid("closed_by_person_id").references(() => person.id),
    closeReport: jsonb("close_report").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [index("project_plan_am_idx").on(t.accountManagerPersonId)],
).enableRLS();

// Job-number counters per prefix and year (FR-PJM-02).
export const projectJobCounter = pgTable(
  "project_job_counter",
  {
    prefix: text("prefix").notNull(),
    year: integer("year").notNull(),
    last: integer("last").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
).enableRLS();

export const projectPhase = pgTable(
  "project_phase",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    budgetMinutes: integer("budget_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("project_phase_project_idx").on(t.projectId, t.sortOrder)],
).enableRLS();

export const projectMilestone = pgTable(
  "project_milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id").references(() => projectPhase.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    dueDate: date("due_date"),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    // An acceptance point with the client (FR-PJM-55) / triggers a billing item (FR-PJM-56).
    isClientFacing: boolean("is_client_facing").notNull().default(false),
    isBilling: boolean("is_billing").notNull().default(false),
    billingAmountVnd: bigint("billing_amount_vnd", { mode: "number" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByPersonId: uuid("done_by_person_id").references(() => person.id),
    sortOrder: integer("sort_order").notNull().default(0),
    // Reminders already sent: due_soon | missed.
    notified: jsonb("notified").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("project_milestone_project_idx").on(t.projectId, t.dueDate)],
).enableRLS();

// Retainers (FR-PJM-06): a recurring monthly scope on a project of kind "retainer".
export type RetainerLineTemplate = { title: string; quantity: number; format: string | null; channel: string | null };
export const projectRetainer = pgTable(
  "project_retainer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .unique()
      .references(() => workProject.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => workClient.id),
    // "2026-10"
    startMonth: text("start_month").notNull(),
    endMonth: text("end_month"),
    lines: jsonb("lines").$type<RetainerLineTemplate[]>().notNull().default([]),
    minutesPerMonth: integer("minutes_per_month"),
    feePerMonthVnd: bigint("fee_per_month_vnd", { mode: "number" }),
    // reset | rollover
    rollover: text("rollover").notNull().default("reset"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
).enableRLS();

export const projectRetainerPeriod = pgTable(
  "project_retainer_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    retainerId: uuid("retainer_id")
      .notNull()
      .references(() => projectRetainer.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    minutesAllowance: integer("minutes_allowance"),
    // Quantities carried in from last month by line title (rollover rule).
    carried: jsonb("carried").$type<Record<string, number>>().notNull().default({}),
    // Quota alerts already sent, per line id and threshold ("<lineId>:80").
    alerted: jsonb("alerted").$type<string[]>().notNull().default([]),
    // open | closed
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("project_retainer_period_unique").on(t.retainerId, t.month)],
).enableRLS();

// The deliverables register — what the client was promised (FR-PJM-05).
export const projectDeliverable = pgTable(
  "project_deliverable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    retainerPeriodId: uuid("retainer_period_id").references(() => projectRetainerPeriod.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => projectMilestone.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull().default(1),
    format: text("format"),
    channel: text("channel"),
    dueDate: date("due_date"),
    // Added by an approved change request.
    changeRequestId: uuid("change_request_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("project_deliverable_project_idx").on(t.projectId), index("project_deliverable_period_idx").on(t.retainerPeriodId)],
).enableRLS();

// Which milestone and register line a task works towards (one task = one unit of the line).
export const projectTaskLink = pgTable(
  "project_task_link",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => task.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => projectMilestone.id, { onDelete: "set null" }),
    deliverableId: uuid("deliverable_id").references(() => projectDeliverable.id, { onDelete: "set null" }),
    phaseId: uuid("phase_id").references(() => projectPhase.id, { onDelete: "set null" }),
    // Baseline dates of the task (FR-PJM-12).
    baselineStart: date("baseline_start"),
    baselineDue: date("baseline_due"),
  },
  (t) => [index("project_task_link_milestone_idx").on(t.milestoneId), index("project_task_link_deliverable_idx").on(t.deliverableId)],
).enableRLS();

// Change requests (FR-PJM-11): a delta on scope, hours, fee and dates, approved before it applies.
export type ChangeImpact = { deliverables?: RetainerLineTemplate[]; minutesDelta?: number; feeDeltaVnd?: number; dueDateTo?: string | null };
export const projectChangeRequest = pgTable(
  "project_change_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // client | internal
    requestedBy: text("requested_by").notNull().default("client"),
    impact: jsonb("impact").$type<ChangeImpact>().notNull().default({}),
    evidenceFileId: uuid("evidence_file_id").references(() => storedFile.id),
    evidenceUrl: text("evidence_url"),
    // draft | submitted | approved | rejected | withdrawn
    status: text("status").notNull().default("draft"),
    approvalRequestId: uuid("approval_request_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("project_change_request_number_unique").on(t.projectId, t.number)],
).enableRLS();

// Status updates (FR-PJM-27).
export type StatusFacts = { tasksDone: number; tasksOpen: number; overdue: number; blocked: number; milestoneSlipDays: number | null; nextMilestone: { name: string; dueDate: string | null } | null; minutesLogged: number; budgetMinutes: number | null; deliverablesAccepted: number; deliverablesPromised: number };
export const projectStatusUpdate = pgTable(
  "project_status_update",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    health: text("health").notNull(),
    summary: text("summary").notNull(),
    highlights: text("highlights"),
    nextSteps: text("next_steps"),
    facts: jsonb("facts").$type<StatusFacts>().notNull(),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_status_update_idx").on(t.projectId, t.createdAt)],
).enableRLS();

// RAID-lite (FR-PJM-29).
export const projectRaidItem = pgTable(
  "project_raid_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    // risk | issue | decision | assumption
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    dueDate: date("due_date"),
    // low | medium | high
    severity: text("severity"),
    // open | closed
    status: text("status").notNull().default("open"),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    // Decisions: when, and the proof.
    decidedOn: date("decided_on"),
    evidenceUrl: text("evidence_url"),
    evidenceFileId: uuid("evidence_file_id").references(() => storedFile.id),
    meetingId: uuid("meeting_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("project_raid_item_idx").on(t.projectId, t.kind)],
).enableRLS();

// Meeting notes with action items (FR-PJM-30) and retrospectives (FR-PJM-59).
export type MeetingRetro = { wentWell?: string; improve?: string; actions?: string };
export const projectMeeting = pgTable(
  "project_meeting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    // kickoff | weekly | client | retro | other
    kind: text("kind").notNull().default("weekly"),
    title: text("title").notNull(),
    heldOn: date("held_on").notNull(),
    attendeeIds: jsonb("attendee_ids").$type<string[]>().notNull().default([]),
    externalAttendees: text("external_attendees"),
    agenda: text("agenda"),
    notes: text("notes"),
    retro: jsonb("retro").$type<MeetingRetro>(),
    calendarEventId: text("calendar_event_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("project_meeting_idx").on(t.projectId, t.heldOn)],
).enableRLS();

export const projectMeetingTask = pgTable(
  "project_meeting_task",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => projectMeeting.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.taskId] })],
).enableRLS();

// Resource bookings (FR-PJM-13): a person or a placeholder role, per week.
export const projectBooking = pgTable(
  "project_booking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => person.id),
    placeholderRole: text("placeholder_role"),
    // The Monday of the week.
    weekStart: date("week_start").notNull(),
    minutes: integer("minutes").notNull(),
    // tentative | confirmed
    status: text("status").notNull().default("confirmed"),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("project_booking_person_idx").on(t.personId, t.weekStart), index("project_booking_project_idx").on(t.projectId, t.weekStart)],
).enableRLS();

// Acceptance — biên bản nghiệm thu (FR-PJM-55).
export type AcceptanceItem = { deliverableId: string; title: string; promised: number; delivered: number; accepted: number; links: string[] };
export const projectAcceptance = pgTable(
  "project_acceptance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    // milestone | retainer_period | project
    scope: text("scope").notNull(),
    milestoneId: uuid("milestone_id").references(() => projectMilestone.id, { onDelete: "set null" }),
    retainerPeriodId: uuid("retainer_period_id").references(() => projectRetainerPeriod.id, { onDelete: "set null" }),
    items: jsonb("items").$type<AcceptanceItem[]>().notNull().default([]),
    // draft | sent | signed | void
    status: text("status").notNull().default("draft"),
    generatedFileId: uuid("generated_file_id").references(() => storedFile.id),
    signedFileId: uuid("signed_file_id").references(() => storedFile.id),
    signedByClient: text("signed_by_client"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedOn: date("signed_on"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("project_acceptance_number_unique").on(t.projectId, t.number)],
).enableRLS();

// "Ready to invoice" for finance (FR-PJM-56).
export const projectBillingItem = pgTable(
  "project_billing_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entity.id),
    jobNumber: text("job_number"),
    clientId: uuid("client_id").references(() => workClient.id),
    // acceptance | milestone | retainer | manual
    source: text("source").notNull(),
    acceptanceId: uuid("acceptance_id").references(() => projectAcceptance.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => projectMilestone.id, { onDelete: "set null" }),
    retainerPeriodId: uuid("retainer_period_id").references(() => projectRetainerPeriod.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    reference: text("reference"),
    amountVnd: bigint("amount_vnd", { mode: "number" }),
    // ready | invoiced | waived
    status: text("status").notNull().default("ready"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date"),
    waivedReason: text("waived_reason"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("project_billing_item_entity_idx").on(t.entityId, t.status),
    uniqueIndex("project_billing_item_acceptance_unique").on(t.acceptanceId).where(sql`${t.acceptanceId} IS NOT NULL`),
    uniqueIndex("project_billing_item_milestone_unique").on(t.milestoneId).where(sql`${t.milestoneId} IS NOT NULL AND ${t.source} = 'milestone'`),
  ],
).enableRLS();

// Client reports (FR-PJM-58): the editable text beside the generated figures.
export const projectClientReport = pgTable(
  "project_client_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    summary: text("summary"),
    nextPlan: text("next_plan"),
    fileId: uuid("file_id").references(() => storedFile.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("project_client_report_idx").on(t.projectId, t.periodTo)],
).enableRLS();
