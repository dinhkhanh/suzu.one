// Projects & daily work — the person's day (Phase 10, SRS §4.6b "Daily execution"): the morning
// plan, the end-of-day report prefilled from activity, time entries and the weekly timesheet, and
// each work team's rules for them. Work records, never pay records: nothing here feeds payroll.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { person } from "../platform/people/schema";
import { task } from "../platform/tasks-engine/schema";
import { workProject, workTeam } from "../work/schema";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// A work team's rules for the day (FR-PJM-21, 22, 24, 25, 44). No row = the defaults (SRS A10, A11).
export const dailyTeamPolicy = pgTable("daily_team_policy", {
  teamId: uuid("team_id")
    .primaryKey()
    .references(() => workTeam.id, { onDelete: "cascade" }),
  // off | optional | required
  planMode: text("plan_mode").notNull().default("optional"),
  reportMode: text("report_mode").notNull().default("required"),
  // ISO weekdays the report is required on (1 = Monday).
  reportDays: jsonb("report_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  planCutoff: text("plan_cutoff").notNull().default("09:30"),
  reportDeadline: text("report_deadline").notNull().default("18:30"),
  // off | optional | required
  timeMode: text("time_mode").notNull().default("optional"),
  timesheetApproval: boolean("timesheet_approval").notNull().default(false),
  // Leave of at least this many working days asks for a cover plan (FR-PJM-44).
  coverMinDays: integer("cover_min_days").notNull().default(2),
  // Cycles (FR-PJM-10): off when null; otherwise the length in weeks and the first Monday.
  cycleWeeks: integer("cycle_weeks"),
  cycleStart: date("cycle_start"),
  ...timestamps,
}).enableRLS();

export type PlannedItem = { taskId: string; minutes: number | null };
export const dailyPlan = pgTable(
  "daily_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    items: jsonb("items").$type<PlannedItem[]>().notNull().default([]),
    note: text("note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("daily_plan_unique").on(t.personId, t.date)],
).enableRLS();

// What the day's activity says the person did (the prefill), kept as it was at submission.
export type ActivityItem = { kind: string; taskId: string | null; title: string; ref: string | null; detail: string | null; at: string };
export type DailyTaskLine = { taskId: string; title: string; ref: string | null; note?: string | null };
export const dailyReport = pgTable(
  "daily_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    activity: jsonb("activity").$type<ActivityItem[]>().notNull().default([]),
    done: jsonb("done").$type<DailyTaskLine[]>().notNull().default([]),
    notDone: jsonb("not_done").$type<DailyTaskLine[]>().notNull().default([]),
    blockers: text("blockers"),
    notes: text("notes"),
    tomorrow: jsonb("tomorrow").$type<PlannedItem[]>().notNull().default([]),
    minutesLogged: integer("minutes_logged").notNull().default(0),
    // draft | submitted
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    late: boolean("late").notNull().default(false),
    // Seconds from opening the form to submitting it (NFR-PRF-06: median ≤ 60).
    secondsToSubmit: integer("seconds_to_submit"),
    ...timestamps,
  },
  (t) => [unique("daily_report_unique").on(t.personId, t.date), index("daily_report_date_idx").on(t.date)],
).enableRLS();

export const dailyReportComment = pgTable(
  "daily_report_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    body: text("body").notNull(),
    // A lead's "seen" without words.
    reaction: text("reaction"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("daily_report_comment_idx").on(t.reportId)],
).enableRLS();

// Weekly reports (FR-PJM-23): the generated summary plus the lead's own words.
export const dailyWeeklyReport = pgTable(
  "daily_weekly_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // person | team | project
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    weekStart: date("week_start").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    summary: text("summary"),
    authorPersonId: uuid("author_person_id").references(() => person.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("daily_weekly_report_unique").on(t.subjectType, t.subjectId, t.weekStart)],
).enableRLS();

// Time entries (FR-PJM-24). A running timer is a row with timer_started_at set and minutes 0.
export const timeEntry = pgTable(
  "time_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    weekStart: date("week_start").notNull(),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => workProject.id, { onDelete: "set null" }),
    // For time not on a task: internal | admin | pitch | training | idle.
    category: text("category"),
    minutes: integer("minutes").notNull().default(0),
    billable: boolean("billable").notNull().default(false),
    note: text("note"),
    // manual | timer
    source: text("source").notNull().default("manual"),
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("time_entry_person_idx").on(t.personId, t.date),
    index("time_entry_project_idx").on(t.projectId, t.date),
    index("time_entry_task_idx").on(t.taskId),
    index("time_entry_timer_idx").on(t.personId).where(sql`${t.timerStartedAt} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
).enableRLS();

// A person's week of time (FR-PJM-25): open → submitted → approved (locked) | returned.
export const timesheetWeek = pgTable(
  "timesheet_week",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    weekStart: date("week_start").notNull(),
    status: text("status").notNull().default("open"),
    minutes: integer("minutes").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    ...timestamps,
  },
  (t) => [unique("timesheet_week_unique").on(t.personId, t.weekStart), index("timesheet_week_status_idx").on(t.status, t.weekStart)],
).enableRLS();

// Reminders already sent: one per person, kind and day (plan, report, timesheet, nudge).
export const dailyReminderSent = pgTable(
  "daily_reminder_sent",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind").notNull(),
    sentOn: date("sent_on").notNull(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.kind, t.sentOn] })],
).enableRLS();
