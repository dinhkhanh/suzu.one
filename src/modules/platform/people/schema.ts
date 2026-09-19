// Minimal person record needed by sign-in provisioning and RBAC. Core HR (Phase 1) extends it.
import { type AnyPgColumn, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { department, entity, team } from "../org/schema";

export const workforceType = pgEnum("workforce_type", [
  "employee",
  "probation",
  "intern",
  "part_time",
  "collaborator",
  "advisor",
]);

export const personStatus = pgEnum("person_status", ["preboarding", "active", "suspended", "offboarded"]);

export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    // Accent-stripped, lower-cased name for search and Vietnamese given-name sorting.
    searchName: text("search_name").notNull(),
    // Always stored lower-cased; matched against the Google account email at sign-in.
    // null = on the books but without app access (e.g. a collaborator HR has not given a mailbox, SRS D14).
    workEmail: text("work_email").unique(),
    workforceType: workforceType("workforce_type").notNull().default("employee"),
    status: personStatus("status").notNull().default("active"),
    primaryEntityId: uuid("primary_entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    teamId: uuid("team_id").references(() => team.id),
    managerId: uuid("manager_id").references((): AnyPgColumn => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("person_entity_idx").on(t.primaryEntityId),
    index("person_department_idx").on(t.departmentId),
    index("person_manager_idx").on(t.managerId),
    index("person_search_name_idx").on(t.searchName),
  ],
).enableRLS();
