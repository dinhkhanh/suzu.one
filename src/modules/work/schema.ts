// Work management (FR-WRK). A work task is a row of the task engine's one `task` table (ADR-10,
// kind = "work") plus its 1:1 extension here; everything a creative team adds on top — teams with
// their own workflow, projects, clients and brands, labels, dependencies, comments, activity —
// lives in these tables. Value lists are in enums.ts and checked by the actions.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { department, entity } from "../platform/org/schema";
import { storedFile } from "../platform/files/schema";
import { person } from "../platform/people/schema";
import { task } from "../platform/tasks-engine/schema";
import type { IntakeField } from "./engine/intake";

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
    departmentId: uuid("department_id").references(() => department.id),
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

// A client or one of its brands. Deliberately light: the CRM (Phase 10) promotes these rows to
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
  },
  (t) => [
    unique("work_task_number_unique").on(t.teamId, t.number),
    uniqueIndex("work_task_occurrence_unique").on(t.recurrenceId, t.occurrenceDate).where(sql`${t.recurrenceId} IS NOT NULL`),
    index("work_task_project_idx").on(t.projectId),
    index("work_task_state_idx").on(t.stateId),
    index("work_task_client_idx").on(t.clientId),
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
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
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
  },
  (t) => [unique("work_deliverable_version_unique").on(t.taskId, t.version)],
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
    isActive: boolean("is_active").notNull().default(true),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_intake_form_team_idx").on(t.teamId)],
).enableRLS();
