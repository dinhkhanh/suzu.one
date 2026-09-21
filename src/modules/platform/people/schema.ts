// Minimal person record needed by sign-in provisioning and RBAC. Core HR (Phase 1) extends it.
import { type AnyPgColumn, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entity, orgUnit } from "../org/schema";

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
    /**
     * Where the person sits: one unit, at any depth (FR-PLT-16). Everything else about their place
     * in the organisation is derived from it by the database (`person_placement_set`) and must not
     * be written by hand:
     *  - `org_unit_path` — that unit and every unit above it, so "does this grant reach them?" is
     *    one array overlap in SQL and one `includes` in the pure policy;
     *  - `department_id` / `team_id` — the deepest unit of each kind on that path, which is what
     *    reports still group by and what a payslip prints.
     * A unit that moves rewrites all three for everyone below it.
     */
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id),
    orgUnitPath: uuid("org_unit_path").array().notNull().default([]),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    teamId: uuid("team_id").references(() => orgUnit.id),
    managerId: uuid("manager_id").references((): AnyPgColumn => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("person_entity_idx").on(t.primaryEntityId),
    index("person_department_idx").on(t.departmentId),
    index("person_org_unit_path_idx").using("gin", t.orgUnitPath),
    index("person_manager_idx").on(t.managerId),
    index("person_search_name_idx").on(t.searchName),
  ],
).enableRLS();
