// Performance (FR-PRF). Phase 3.5 week 1: the goal tree, key results and the append-only check-in
// log. Scores must be reproducible (SRS D13 — the year-end bonus is computed from them): current
// values only ever change through a check-in row, and closing a goal freezes its figure.
// Value lists are in enums.ts.
import { type AnyPgColumn, bigint, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { department, entity, team } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { Milestone } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const goal = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // group | entity | department | team | individual
    level: text("level").notNull(),
    // Where the goal sits: nothing for the group; a department goal may name the entity it is meant
    // for (departments are shared); a team goal carries its department; an individual goal its person.
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    teamId: uuid("team_id").references(() => team.id),
    personId: uuid("person_id").references(() => person.id),
    // Accountable for the goal and the one who checks in.
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    parentGoalId: uuid("parent_goal_id").references((): AnyPgColumn => goal.id),
    title: text("title").notNull(),
    description: text("description"),
    year: integer("year").notNull(),
    // "2027" (annual) or "2027-Q1" … "2027-Q4".
    periodKey: text("period_key").notNull(),
    // draft | active | closed | cancelled
    status: text("status").notNull().default("draft"),
    // Its share when a parent without key results averages its children.
    weight: integer("weight").notNull().default(1),
    // Frozen at close, in basis points: the figure Phase 8 reads cannot move afterwards.
    finalProgressBp: integer("final_progress_bp"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByPersonId: uuid("closed_by_person_id").references(() => person.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("goal_parent_idx").on(t.parentGoalId), index("goal_person_idx").on(t.personId), index("goal_year_level_idx").on(t.year, t.level)],
).enableRLS();

export const keyResult = pgTable(
  "key_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    title: text("title").notNull(),
    // number | percent | currency | milestone
    metricType: text("metric_type").notNull(),
    // Integers: hundredths for number and percent, whole VND for currency (enums.ts scaleOf).
    // A target below the start means "bring it down".
    startValue: bigint("start_value", { mode: "number" }).notNull().default(0),
    targetValue: bigint("target_value", { mode: "number" }).notNull().default(0),
    currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
    // For milestone key results: progress = done / total.
    milestones: jsonb("milestones").$type<Milestone[]>(),
    weight: integer("weight").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    // Copied from the latest check-in, which is the record.
    confidence: text("confidence"),
    lastCheckInAt: timestamp("last_check_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("key_result_goal_idx").on(t.goalId)],
).enableRLS();

// Append-only: the history of every figure a score was computed from. No update or delete path.
export const goalCheckIn = pgTable(
  "goal_check_in",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyResultId: uuid("key_result_id")
      .notNull()
      .references(() => keyResult.id),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    // The Monday of the week the check-in belongs to (Vietnam time).
    weekStart: date("week_start").notNull(),
    value: bigint("value", { mode: "number" }),
    milestones: jsonb("milestones").$type<Milestone[]>(),
    confidence: text("confidence").notNull(),
    note: text("note"),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_check_in_key_result_idx").on(t.keyResultId, t.createdAt), index("goal_check_in_goal_idx").on(t.goalId, t.createdAt)],
).enableRLS();
