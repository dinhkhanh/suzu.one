// The task engine's tables (ADR-10): ONE task table for every kind of work. Onboarding and
// offboarding checklists are its first use (`kind = "checklist"`); Phase 3 adds work-management
// tasks and the ops tracker's obligations as further kinds with their own views, on these rows.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, index, integer, pgEnum, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { department, entity } from "../org/schema";
import { person } from "../people/schema";

// A generic status *category*. Phase 3's per-project workflows add their own named states, each
// mapping onto one of these, so "my open tasks" and progress counts keep working across kinds.
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done", "cancelled"]);

// A reusable list of steps. `purpose` says when it is used ("onboarding", "offboarding"; later
// project and recurring-task templates). The three scope columns narrow who it applies to; null =
// everyone. The most specific active template wins (engine/checklist.ts).
export const taskTemplate = pgTable(
  "task_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    name: text("name").notNull(),
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    // A core-hr position. No foreign key: the platform does not depend on feature modules' tables.
    positionId: uuid("position_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_template_purpose_idx").on(t.purpose)],
).enableRLS();

export const taskTemplateItem = pgTable(
  "task_template_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => taskTemplate.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // Who gets the task: "subject" | "line_manager" | "person" | "permission:<permission>".
    assigneeRule: text("assignee_rule").notNull(),
    assigneePersonId: uuid("assignee_person_id").references(() => person.id),
    // Days from the anchor date (first day, last day…); negative = before it.
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("task_template_item_template_idx").on(t.templateId)],
).enableRLS();

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("todo"),
    assigneePersonId: uuid("assignee_person_id").references(() => person.id),
    dueDate: date("due_date"),
    priority: smallint("priority"),
    entityId: uuid("entity_id").references(() => entity.id),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id),
    // What the task belongs to, e.g. "lifecycle_event" + its id; later "project", "obligation".
    contextType: text("context_type"),
    contextId: text("context_id"),
    // The person the task is about (the new hire, the leaver), if any.
    subjectPersonId: uuid("subject_person_id").references(() => person.id),
    sortOrder: integer("sort_order").notNull().default(0),
    templateItemId: uuid("template_item_id").references(() => taskTemplateItem.id, { onDelete: "set null" }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByPersonId: uuid("completed_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // "My open tasks", the most common question.
    index("task_assignee_open_idx").on(t.assigneePersonId, t.dueDate).where(sql`${t.deletedAt} IS NULL AND ${t.status} IN ('todo', 'in_progress')`),
    index("task_context_idx").on(t.contextType, t.contextId),
    index("task_subject_idx").on(t.subjectPersonId),
  ],
).enableRLS();
