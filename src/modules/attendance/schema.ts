// Attendance tables, first slice (FR-ATT-01, 02, 17): the working calendar, shifts, work schedules,
// who follows which schedule, and the shift roster. Holidays are rows, never constants: the
// government announces Tết and the swap days year by year.
import { boolean, date, index, jsonb, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { department, entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { SchedulePattern, Segment } from "./engine/calendar";

export const calendarDayKind = pgEnum("calendar_day_kind", ["public_holiday", "compensatory_off", "company_off", "working_override"]);

// A date that differs from the weekly pattern. `entity_id` null = every entity; an entity's own
// row for the same date wins (a company day off, a make-up working Saturday).
export const calendarDay = pgTable(
  "calendar_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    date: date("date").notNull(),
    kind: calendarDayKind("kind").notNull(),
    name: text("name").notNull(),
    // Seeded dates (lunar holidays, the yearly swap days) wait for HR to confirm them against the official announcement.
    isConfirmed: boolean("is_confirmed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("calendar_day_entity_date_key").on(t.entityId, t.date).nullsNotDistinct(), index("calendar_day_date_idx").on(t.date)],
).enableRLS();

// A named block of working time for rostered crews. Several segments = a split shift; a segment
// whose end is not after its start runs past midnight and belongs to the day it starts on.
export const shift = pgTable(
  "shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    segments: jsonb("segments").$type<Segment[]>().notNull(),
    breakMinutes: smallint("break_minutes").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("shift_entity_code_key").on(t.entityId, t.code).nullsNotDistinct()],
).enableRLS();

export const workScheduleKind = pgEnum("work_schedule_kind", ["fixed", "flexible", "shift"]);

// The weekly pattern: for every weekday "working" (with hours), "untracked" (working, no punches
// required — Saturday WFH, FR-ATT-17) or "off"; plus alternate-week rules (alternate Saturdays).
export const workSchedule = pgTable(
  "work_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    kind: workScheduleKind("kind").notNull(),
    pattern: jsonb("pattern").$type<SchedulePattern>().notNull(),
    // The schedule of anyone no assignment covers. At most one (partial unique index in the migration).
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_schedule_entity_idx").on(t.entityId)],
).enableRLS();

export const scheduleScope = pgEnum("schedule_scope", ["entity", "department", "person"]);

// Who follows which schedule, effective-dated. The most specific wins: person, then department
// (within an entity, then across entities), then entity, then the default schedule. Rows of one
// scope never overlap (exclusion constraints in the migration).
export const scheduleAssignment = pgTable(
  "schedule_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: scheduleScope("scope").notNull(),
    // entity scope: the entity. department scope: optional, narrows a shared department to one entity.
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    personId: uuid("person_id").references(() => person.id),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => workSchedule.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedule_assignment_person_idx").on(t.personId), index("schedule_assignment_department_idx").on(t.departmentId), index("schedule_assignment_entity_idx").on(t.entityId)],
).enableRLS();

// Which shift a person works on which date. Overrides the weekly pattern for that date.
export const shiftRoster = pgTable(
  "shift_roster",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    // null = rostered off that day.
    shiftId: uuid("shift_id").references(() => shift.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("shift_roster_person_date_key").on(t.personId, t.date)],
).enableRLS();
