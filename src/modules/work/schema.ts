// Work management (FR-WRK). A work task is a row of the task engine's one `task` table (ADR-10,
// kind = "work") plus its 1:1 extension here; everything a creative team adds on top — teams with
// their own workflow, projects, clients and brands, labels, dependencies, comments, activity —
// lives in these tables. Value lists are in enums.ts and checked by the actions.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entity, orgUnit } from "../platform/org/schema";
import { storedFile } from "../platform/files/schema";
import { person } from "../platform/people/schema";
import { task } from "../platform/tasks-engine/schema";
import { registerCompletionGuard } from "../platform/tasks-engine/completion-guards";
import type { IntakeField } from "./engine/intake";

// The work handover step of an offboarding checklist cannot be completed while the leaver still
// owns work (FR-PJM-45). Registered here, beside the tables, because this file is loaded with every
// database access (src/lib/db/schema.ts): the guard is in place before any task can be completed,
// whichever screen, action or job completes it. The check itself loads only when it first runs.
registerCompletionGuard("work.exit_handover", () => import("./exit-guard").then((module) => module.exitHandoverGuard));

export type CustomFieldValue = string | number | boolean | string[] | null;

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// A working team (Social, Design, Video Production, HR…). Not the org chart's team: membership is
// looser, a team may span entities (`entity_id` null = the group), and it owns a workflow.
export const workTeam = pgTable(
  "work_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Short upper-case code; task numbers read "VID-123".
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    // What a new project of this team starts with (HR and finance teams: "private", FR-WRK-18).
    defaultVisibility: text("default_visibility").notNull().default("team"),
    // Last task number handed out.
    taskSeq: integer("task_seq").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("work_team_entity_idx").on(t.entityId)],
).enableRLS();

export const workTeamMember = pgTable(
  "work_team_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_team_member_unique").on(t.teamId, t.personId), index("work_team_member_person_idx").on(t.personId)],
).enableRLS();

// The team's workflow: ordered, named states, each in one category (enums.ts).
export const workState = pgTable(
  "work_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("work_state_team_idx").on(t.teamId, t.sortOrder)],
).enableRLS();

// A client or one of its brands. Deliberately light: the CRM (Phase 11) promotes these rows to
// full accounts without moving the tasks that point at them.
export const workClient = pgTable(
  "work_client",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("client"),
    parentId: uuid("parent_id").references((): AnyPgColumn => workClient.id),
    entityId: uuid("entity_id").references(() => entity.id),
    note: text("note"),
    // Who owns the relationship (FR-PJM-46): changing it takes a hand-off note.
    accountManagerPersonId: uuid("account_manager_person_id").references(() => person.id),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("work_client_parent_idx").on(t.parentId)],
).enableRLS();

export const workLabel = pgTable(
  "work_label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = shared by every team.
    teamId: uuid("team_id").references(() => workTeam.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("gray"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_label_team_idx").on(t.teamId)],
).enableRLS();

export const workProject = pgTable(
  "work_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The owning team: the project uses its workflow. Members may come from anywhere.
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id),
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    description: text("description"),
    clientId: uuid("client_id").references(() => workClient.id),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("team"),
    leadPersonId: uuid("lead_person_id").references(() => person.id),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_project_team_idx").on(t.teamId), index("work_project_client_idx").on(t.clientId)],
).enableRLS();

export const workProjectMember = pgTable(
  "work_project_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => workProject.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_project_member_unique").on(t.projectId, t.personId), index("work_project_member_person_idx").on(t.personId)],
).enableRLS();

export type TaskChecklistItem = { id: string; text: string; done: boolean };
export type TaskLink = { id: string; url: string; title: string | null };

// The work-specific half of a task. Title, assignee, dates, priority, parent… are on `task`.
export const workTask = pgTable(
  "work_task",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => task.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id),
    projectId: uuid("project_id").references(() => workProject.id),
    // Per team: "VID-123".
    number: integer("number").notNull(),
    stateId: uuid("state_id")
      .notNull()
      .references(() => workState.id),
    clientId: uuid("client_id").references(() => workClient.id),
    channel: text("channel"),
    contentFormat: text("content_format"),
    // Position inside a board column; fractional, so a drop between two cards rewrites one row.
    boardRank: doublePrecision("board_rank").notNull().default(0),
    checklist: jsonb("checklist").$type<TaskChecklistItem[]>().notNull().default([]),
    // Drive folders, briefs, references: plain URLs (no Google API).
    links: jsonb("links").$type<TaskLink[]>().notNull().default([]),
    // Review step (FR-WRK-08, week 3): none | submitted | approved | changes_requested.
    reviewStatus: text("review_status").notNull().default("none"),
    reviewerPersonId: uuid("reviewer_person_id").references(() => person.id),
    revisionRounds: integer("revision_rounds").notNull().default(0),
    // Recurring tasks (FR-WRK-11, week 3): which rule made this task, and for which date.
    recurrenceId: uuid("recurrence_id"),
    occurrenceDate: date("occurrence_date"),
    // Came in through an intake form (FR-WRK-16, week 5). No foreign key: the form may be retired, the task stays.
    intakeFormId: uuid("intake_form_id"),
    // Custom fields (FR-PJM-35): { [fieldId]: value }, checked against work_custom_field by the service.
    customValues: jsonb("custom_values").$type<Record<string, CustomFieldValue>>().notNull().default({}),
    // Triage (FR-PJM-32): work from outside the team waits here until a lead accepts it.
    // null = not in triage (made by the team itself) | pending | accepted | declined | merged | snoozed.
    triageStatus: text("triage_status"),
    // intake | handoff | request
    triageSource: text("triage_source"),
    triageSnoozedUntil: date("triage_snoozed_until"),
    triageDecidedByPersonId: uuid("triage_decided_by_person_id").references(() => person.id),
    triageDecidedAt: timestamp("triage_decided_at", { withTimezone: true }),
    triageNote: text("triage_note"),
    // Cycles (FR-PJM-10): the time box the task is planned in, and how often it rolled over.
    cycleId: uuid("cycle_id"),
    cycleRollovers: integer("cycle_rollovers").notNull().default(0),
  },
  (t) => [
    unique("work_task_number_unique").on(t.teamId, t.number),
    uniqueIndex("work_task_occurrence_unique").on(t.recurrenceId, t.occurrenceDate).where(sql`${t.recurrenceId} IS NOT NULL`),
    index("work_task_project_idx").on(t.projectId),
    index("work_task_state_idx").on(t.stateId),
    index("work_task_client_idx").on(t.clientId),
    // Deliverables waiting for this reviewer: a badge in the app frame on every page.
    index("work_task_reviewer_idx").on(t.reviewerPersonId).where(sql`${t.reviewStatus} = 'submitted'`),
    index("work_task_triage_idx").on(t.teamId).where(sql`${t.triageStatus} IN ('pending', 'snoozed')`),
    index("work_task_cycle_idx").on(t.cycleId),
  ],
).enableRLS();

// Collaborators work on the task with the assignee; followers only want its notifications.
export const workTaskPerson = pgTable(
  "work_task_person",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: text("role").notNull().default("collaborator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.personId] }), index("work_task_person_person_idx").on(t.personId)],
).enableRLS();

export const workTaskLabel = pgTable(
  "work_task_label",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => workLabel.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index("work_task_label_label_idx").on(t.labelId)],
).enableRLS();

// "blocks": the blocker must finish first. "relates": a plain cross-reference.
export const workTaskDependency = pgTable(
  "work_task_dependency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerTaskId: uuid("blocker_task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    blockedTaskId: uuid("blocked_task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("blocks"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_task_dependency_unique").on(t.blockerTaskId, t.blockedTaskId), index("work_task_dependency_blocked_idx").on(t.blockedTaskId)],
).enableRLS();

// Every change to a task, field by field (FR-WRK-09). Append-only by convention.
export const workActivity = pgTable(
  "work_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    // created | field_changed | label_added | label_removed | person_added | person_removed |
    // dependency_added | dependency_removed | deleted | (week 2+) comment, attachment, review…
    type: text("type").notNull(),
    field: text("field"),
    // Display-ready where a name would otherwise be lost: { id, name } for people, states, projects.
    fromValue: jsonb("from_value"),
    toValue: jsonb("to_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_activity_task_idx").on(t.taskId, t.createdAt)],
).enableRLS();

// Threaded comments with @mentions and reactions (week 2 builds the screens).
export const workComment = pgTable(
  "work_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    // Null when an automation posted it (FR-PJM-33): `automation_id` names the rule instead.
    authorPersonId: uuid("author_person_id").references(() => person.id),
    automationId: uuid("automation_id").references((): AnyPgColumn => workAutomation.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => workComment.id),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    // { "👍": [personId, …] }
    reactions: jsonb("reactions").$type<Record<string, string[]>>().notNull().default({}),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_comment_task_idx").on(t.taskId, t.createdAt)],
).enableRLS();

// Due-soon and overdue reminders already sent (FR-WRK-17): one per task, kind and day, so a
// second run of the daily job — or a retry — tells nobody twice.
export const workReminderSent = pgTable(
  "work_reminder_sent",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    // due_soon | overdue
    kind: text("kind").notNull(),
    sentOn: date("sent_on").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.personId, t.kind, t.sentOn] })],
).enableRLS();

export type SavedViewFilters = Record<string, string>;

// A named set of list filters: personal, or shared with everyone who can open the project.
export const workSavedView = pgTable(
  "work_saved_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layout: text("layout").notNull().default("list"),
    // The list's URL parameters, as they are.
    filters: jsonb("filters").$type<SavedViewFilters>().notNull().default({}),
    isShared: boolean("is_shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_saved_view_project_idx").on(t.projectId)],
).enableRLS();

// A deliverable handed in for review (FR-WRK-08): every hand-in is a new version and stays on the
// record with its decision, so the task page shows the whole back-and-forth and counts the rounds.
export const workDeliverable = pgTable(
  "work_deliverable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // file | link
    kind: text("kind").notNull(),
    fileId: uuid("file_id").references(() => storedFile.id),
    url: text("url"),
    note: text("note"),
    submittedByPersonId: uuid("submitted_by_person_id")
      .notNull()
      .references(() => person.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    // pending | approved | changes_requested
    decision: text("decision").notNull().default("pending"),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
    // Review chains (FR-PJM-50): which chain the version runs through and the stage it waits at.
    chainId: uuid("chain_id"),
    stageIndex: integer("stage_index").notNull().default(0),
    // Who the version waits for at its current stage, and until when. Kept on the version, not on
    // work_task.reviewer_person_id: that one is the task's own reviewer, which a chain stage may name.
    stageReviewerPersonId: uuid("stage_reviewer_person_id").references(() => person.id),
    stageDueAt: timestamp("stage_due_at", { withTimezone: true }),
    // Set when the client approved this version (FR-PJM-51): it can no longer change.
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (t) => [unique("work_deliverable_version_unique").on(t.taskId, t.version), index("work_deliverable_stage_reviewer_idx").on(t.stageReviewerPersonId).where(sql`${t.decision} = 'pending'`)],
).enableRLS();

/** engine/recurrence.ts reads this. */
export type RecurrenceRuleJson =
  | { freq: "daily"; interval: number }
  | { freq: "weekly"; interval: number; weekdays: number[] }
  | { freq: "monthly"; interval: number; monthDay: number | "last" };

/** What each occurrence starts with; people and labels that no longer fit are dropped when it is made. */
export type RecurrenceDraft = { description?: string | null; assigneePersonId?: string | null; priority?: number | null; estimateMinutes?: number | null; clientId?: string | null; channel?: string | null; contentFormat?: string | null; labelIds?: string[] };

// A task that comes back (FR-WRK-11): the daily job makes each occurrence once, `leadDays` before
// its date (work_task's unique recurrence + occurrence date is the guard).
export const workRecurrence = pgTable(
  "work_recurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id),
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    draft: jsonb("draft").$type<RecurrenceDraft>().notNull().default({}),
    rule: jsonb("rule").$type<RecurrenceRuleJson>().notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    // The occurrence's date is the task's due date; the task appears this many days before it.
    leadDays: integer("lead_days").notNull().default(7),
    // Occurrences up to and including this date have been made.
    generatedThrough: date("generated_through"),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_recurrence_project_idx").on(t.projectId)],
).enableRLS();

// Intake forms (FR-WRK-16): a team publishes a request form ("Design request"); a submission becomes
// a task in the team's backlog with the requester set. `fields` is the form's definition.

export const workIntakeForm = pgTable(
  "work_intake_form",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id),
    // Where submissions land; null = the team's backlog without a project.
    projectId: uuid("project_id").references(() => workProject.id),
    name: text("name").notNull(),
    description: text("description"),
    fields: jsonb("fields").$type<IntakeField[]>().notNull().default([]),
    // Who may ask: "entity" = people of the team's entity; "group" = anyone in the group (a studio that serves its sister companies).
    audience: text("audience").notNull().default("entity"),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_intake_form_team_idx").on(t.teamId)],
).enableRLS();

// ── Phase 10 (PJM) on the task foundation ───────────────────────────────────────────────────

// A team's (or one project's) extra fields (FR-PJM-35). Values live on work_task.custom_values.
export type CustomFieldOption = { id: string; label: string; color?: string };
export const workCustomField = pgTable(
  "work_custom_field",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").references(() => workTeam.id, { onDelete: "cascade" }),
    // Set = a field of this project only; null = every task of the team.
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // text | number | select | multi_select | date | person | url | checkbox | duration
    type: text("type").notNull(),
    options: jsonb("options").$type<CustomFieldOption[]>().notNull().default([]),
    showOnCard: boolean("show_on_card").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_custom_field_team_idx").on(t.teamId), index("work_custom_field_project_idx").on(t.projectId)],
).enableRLS();

// A task moved to another team gets a new number; the old one still finds it (FR-PJM-34).
export const workTaskNumberAlias = pgTable(
  "work_task_number_alias",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id),
    number: integer("number").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.number] }), index("work_task_number_alias_task_idx").on(t.taskId)],
).enableRLS();

// Triage rules (FR-PJM-32): what incoming work gets on arrival.
export type TriageMatch = { source?: string; intakeFormId?: string; keyword?: string };
export type TriageSet = { assigneePersonId?: string; projectId?: string; labelIds?: string[]; priority?: number };
export const workTriageRule = pgTable(
  "work_triage_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    match: jsonb("match").$type<TriageMatch>().notNull().default({}),
    set: jsonb("set").$type<TriageSet>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_triage_rule_team_idx").on(t.teamId)],
).enableRLS();

// A task marked blocked (FR-PJM-28): open while resolved_at is null; blocked time = resolved − raised.
export const workBlocker = pgTable(
  "work_blocker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    // Who or what the task waits for.
    neededPersonId: uuid("needed_person_id").references(() => person.id),
    raisedByPersonId: uuid("raised_by_person_id")
      .notNull()
      .references(() => person.id),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => person.id),
    resolution: text("resolution"),
  },
  (t) => [index("work_blocker_task_idx").on(t.taskId), uniqueIndex("work_blocker_open_unique").on(t.taskId).where(sql`${t.resolvedAt} IS NULL`), index("work_blocker_needed_idx").on(t.neededPersonId).where(sql`${t.resolvedAt} IS NULL`)],
).enableRLS();

// Cycles (FR-PJM-10): a team's time boxes, made ahead by the daily job.
export const workCycle = pgTable(
  "work_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // Filled when the cycle closes: planned, done, rolled over.
    summary: jsonb("summary").$type<{ planned: number; done: number; rolled: number }>(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_cycle_number_unique").on(t.teamId, t.number), index("work_cycle_dates_idx").on(t.teamId, t.startDate)],
).enableRLS();

// Hand-off packages (FR-PJM-40): what a workflow transition requires.
export type HandoffField = { key: string; label: string; type: "text" | "url" | "date" | "number"; required: boolean };
export type HandoffCheck = { id: string; text: string };
export const workHandoffPackage = pgTable(
  "work_handoff_package",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // null = from any state.
    fromStateId: uuid("from_state_id").references(() => workState.id, { onDelete: "cascade" }),
    toStateId: uuid("to_state_id")
      .notNull()
      .references(() => workState.id, { onDelete: "cascade" }),
    fields: jsonb("fields").$type<HandoffField[]>().notNull().default([]),
    checklist: jsonb("checklist").$type<HandoffCheck[]>().notNull().default([]),
    requireLink: boolean("require_link").notNull().default(false),
    requireFile: boolean("require_file").notNull().default(false),
    // The receiver must accept (FR-PJM-41); off = the package is recorded, nobody accepts it.
    requireAccept: boolean("require_accept").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_handoff_package_team_idx").on(t.teamId)],
).enableRLS();

// One hand-off note, whatever moves (FR-PJM-43).
export type HandoffNote = { context?: string; state?: string; done?: string; next?: string; questions?: string; links?: string[]; contacts?: string };
export const workHandoff = pgTable(
  "work_handoff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null for a hand-off of something that is not a task: a client relationship (account), a
    // project, a recurrence or a team role in an exit handover — `client_id` / `source_ref` say what.
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => workClient.id),
    // stage | cross_team | cover | cover_return | exit | account
    kind: text("kind").notNull(),
    packageId: uuid("package_id").references(() => workHandoffPackage.id, { onDelete: "set null" }),
    fromPersonId: uuid("from_person_id").references(() => person.id),
    toPersonId: uuid("to_person_id").references(() => person.id),
    toTeamId: uuid("to_team_id").references(() => workTeam.id),
    fromStateId: uuid("from_state_id").references(() => workState.id, { onDelete: "set null" }),
    toStateId: uuid("to_state_id").references(() => workState.id, { onDelete: "set null" }),
    note: jsonb("note").$type<HandoffNote>().notNull().default({}),
    packageValues: jsonb("package_values").$type<Record<string, string>>().notNull().default({}),
    checklist: jsonb("checklist").$type<(HandoffCheck & { done: boolean })[]>().notNull().default([]),
    fileId: uuid("file_id").references(() => storedFile.id),
    // pending | accepted | returned | cancelled | recorded (no acceptance needed)
    status: text("status").notNull().default("pending"),
    respondedByPersonId: uuid("responded_by_person_id").references(() => person.id),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    returnReason: text("return_reason"),
    // A cross-team hand-off makes a task in the receiving team.
    targetTaskId: uuid("target_task_id").references(() => task.id, { onDelete: "set null" }),
    // Where it came from: { leaveRequestId } / { lifecycleEventId } / { clientId }.
    sourceRef: jsonb("source_ref").$type<Record<string, string>>(),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_handoff_task_idx").on(t.taskId, t.createdAt), index("work_handoff_client_idx").on(t.clientId).where(sql`${t.clientId} IS NOT NULL`), index("work_handoff_to_idx").on(t.toPersonId).where(sql`${t.status} = 'pending'`), index("work_handoff_team_idx").on(t.toTeamId).where(sql`${t.status} = 'pending'`)],
).enableRLS();

// Leave cover (FR-PJM-44): one plan per leave request, one row per thing covered.
export const workCoverPlan = pgTable(
  "work_cover_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    leaveRequestId: uuid("leave_request_id").notNull().unique(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    // draft | submitted | handed_back | cancelled
    status: text("status").notNull().default("draft"),
    defaultCoverPersonId: uuid("default_cover_person_id").references(() => person.id),
    note: jsonb("note").$type<HandoffNote>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // When the covers took the work over: the leave's first day, or the submission if it had started.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("work_cover_plan_person_idx").on(t.personId, t.fromDate)],
).enableRLS();

export const workCoverItem = pgTable(
  "work_cover_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => workCoverPlan.id, { onDelete: "cascade" }),
    // task | review | recurrence | booking
    itemType: text("item_type").notNull(),
    itemId: uuid("item_id").notNull(),
    coverPersonId: uuid("cover_person_id").references(() => person.id),
    handoffId: uuid("handoff_id").references(() => workHandoff.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    handedBackAt: timestamp("handed_back_at", { withTimezone: true }),
  },
  (t) => [unique("work_cover_item_unique").on(t.planId, t.itemType, t.itemId), index("work_cover_item_cover_idx").on(t.coverPersonId)],
).enableRLS();

// Exit and transfer handover (FR-PJM-45): pulled from lifecycle events; the gate is computed live.
export const workExitHandover = pgTable(
  "work_exit_handover",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    lifecycleEventId: uuid("lifecycle_event_id").notNull().unique(),
    // termination | transfer
    reason: text("reason").notNull(),
    lastDay: date("last_day"),
    // The checklist task the gate guards (kind "handover"), in the person's offboarding.
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    // open | done | cancelled
    status: text("status").notNull().default("open"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("work_exit_handover_person_idx").on(t.personId)],
).enableRLS();

// Review chains (FR-PJM-50): ordered stages a deliverable version passes through.
// reviewer: task_reviewer | project_lead | team_lead | account_manager | client | person:<id>
export type ReviewStage = { key: string; name: string; reviewer: string; dueHours: number | null };
export const workReviewChain = pgTable(
  "work_review_chain",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").references(() => workTeam.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Applies to tasks of this content format; null = every task in scope.
    contentFormat: text("content_format"),
    stages: jsonb("stages").$type<ReviewStage[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_review_chain_team_idx").on(t.teamId), index("work_review_chain_project_idx").on(t.projectId)],
).enableRLS();

// Every decision on a deliverable version, stage by stage — the client's included (FR-PJM-50, 51).
export type ClientDecisionFacts = { channel: string; decidedByName: string; decidedOn: string; evidenceFileId?: string | null; evidenceUrl?: string | null };
export const workDeliverableDecision = pgTable(
  "work_deliverable_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => workDeliverable.id, { onDelete: "cascade" }),
    stageIndex: integer("stage_index").notNull().default(0),
    stageName: text("stage_name"),
    // approved | approved_with_changes | changes_required
    decision: text("decision").notNull(),
    // Who pressed the button; for a client stage, the account person who recorded it.
    decidedByPersonId: uuid("decided_by_person_id")
      .notNull()
      .references(() => person.id),
    comment: text("comment"),
    isClient: boolean("is_client").notNull().default(false),
    client: jsonb("client").$type<ClientDecisionFacts>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_deliverable_decision_idx").on(t.deliverableId, t.createdAt)],
).enableRLS();

// Comments pinned to a point of an image or a moment of a video (FR-PJM-52). x, y in 0..1.
export const workDeliverablePin = pgTable(
  "work_deliverable_pin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => workDeliverable.id, { onDelete: "cascade" }),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    timecodeMs: integer("timecode_ms"),
    body: text("body").notNull(),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_deliverable_pin_idx").on(t.deliverableId)],
).enableRLS();

// What went to the client, when, and which version (FR-PJM-53).
export const workDelivery = pgTable(
  "work_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => workDeliverable.id, { onDelete: "set null" }),
    deliveredOn: date("delivered_on").notNull(),
    deliveredByPersonId: uuid("delivered_by_person_id")
      .notNull()
      .references(() => person.id),
    recipient: text("recipient"),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_delivery_task_idx").on(t.taskId)],
).enableRLS();

// The publish log of content (FR-PJM-54).
export const workPublish = pgTable(
  "work_publish",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    page: text("page"),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    url: text("url"),
    publishedByPersonId: uuid("published_by_person_id").references(() => person.id),
    boosted: boolean("boosted").notNull().default(false),
    adAccount: text("ad_account"),
    // planned | published | cancelled
    status: text("status").notNull().default("planned"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_publish_task_idx").on(t.taskId), index("work_publish_planned_idx").on(t.plannedAt).where(sql`${t.status} = 'planned'`)],
).enableRLS();

// Results of a published post (FR-PJM-57). Money in integer VND.
export type PublishMetrics = { reach?: number; views?: number; engagement?: number; clicks?: number; spendVnd?: number };
export const workPublishResult = pgTable(
  "work_publish_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publishId: uuid("publish_id")
      .notNull()
      .references(() => workPublish.id, { onDelete: "cascade" }),
    recordedOn: date("recorded_on").notNull(),
    metrics: jsonb("metrics").$type<PublishMetrics>().notNull().default({}),
    // manual | csv
    source: text("source").notNull().default("manual"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_publish_result_idx").on(t.publishId, t.recordedOn)],
).enableRLS();

// Automations (FR-PJM-33): when <trigger> [and <conditions>] then <actions>.
// `days` on "due date reached": that many days after the due date (1 = overdue by a day).
export type AutomationTrigger = { type: string; stateId?: string; field?: string; decision?: string; percent?: number; days?: number };
export type AutomationCondition = { field: string; op: "eq" | "neq" | "set" | "unset"; value?: string | number | null };
// A person is named by `personId`, or by `to` — a role on the task ("role:requester", …) resolved when the rule runs.
export type AutomationAction = { type: string; stateId?: string; personId?: string; labelId?: string; days?: number; templateId?: string; text?: string; to?: string };
export const workAutomation = pgTable(
  "work_automation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workTeam.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("work_automation_team_idx").on(t.teamId)],
).enableRLS();

export const workAutomationRun = pgTable(
  "work_automation_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => workAutomation.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    // ok | skipped | failed, with what each action did.
    outcome: text("outcome").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_automation_run_idx").on(t.automationId, t.createdAt)],
).enableRLS();

// ── The client's review link (D24, FR-PJM-51a) ──────────────────────────────────────────────

/**
 * An expiring, no-login link that shows one deliverable version to the client and — when it is
 * allowed to — takes their decision. The **second public surface** of the product (A8), so the row
 * is written to hold as little as it can:
 *
 *   · **the token is never stored.** `token_hash` is SHA-256 of what the account manager copied
 *     once; the link exists in the client's inbox and nowhere else, exactly as a take-home brief's
 *     link does (FR-REC-07). Nobody can read a live link back out of the database.
 *   · **no address, in any form.** Views are a count and a timestamp; the rate limiter keeps its
 *     own hashed rows next door and sweeps them (PDPL data minimisation, NFR-PRV-02).
 *   · **who decided is on the decision, not here.** The client's typed name and the day live in
 *     `work_deliverable_decision.client`, the same record the account manager's own recording
 *     writes (FR-PJM-51); `decision_id` is the one that this link produced.
 */
export const workPreviewLink = pgTable(
  "work_preview_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    // null = whichever version is current when the client opens it, so a link sent before the last
    // round still shows the work that answers it.
    deliverableId: uuid("deliverable_id").references(() => workDeliverable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // Who it was sent to, as the account manager typed it ("Chị Mai – Vinamilk"), and the note the
    // client reads above the work.
    label: text("label"),
    message: text("message"),
    // false = the client may look and nothing else; the account side records what they say.
    allowDecision: boolean("allow_decision").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByPersonId: uuid("revoked_by_person_id").references(() => person.id),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    // Set the moment a decision is claimed: one link takes one decision and then closes.
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionId: uuid("decision_id").references(() => workDeliverableDecision.id, { onDelete: "set null" }),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_preview_link_token_key").on(t.tokenHash), index("work_preview_link_task_idx").on(t.taskId, t.createdAt)],
).enableRLS();

/**
 * Counted requests to the public preview surface (NFR-SEC-03) — the same fixed window the careers
 * page uses, kept in the work module because the table belongs to whoever owns the surface.
 * `key_hash` is a hashed visitor (never an address) or a token's hash, never anything readable.
 */
export const workPreviewHit = pgTable(
  "work_preview_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What was counted: "view", "decide", "token_view", "token_decide". See `PREVIEW_LIMITS`.
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("work_preview_hit_key").on(t.bucket, t.keyHash, t.windowStart), index("work_preview_hit_window_idx").on(t.windowStart)],
).enableRLS();
