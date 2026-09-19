// Core HR: employment periods, effective-dated assignments, positions, employee-code numbering,
// the personal-tier profile and saved list views. One table per sensitivity tier on purpose:
// `person` (platform) holds public_internal fields, `person_profile` holds personal ones;
// restricted fields get their own encrypted table.
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branch, department, entity, team } from "../platform/org/schema";
import { person, workforceType } from "../platform/people/schema";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// Shared across entities, like departments. Later modules (KPI library, onboarding templates) key on it.
export const position = pgTable("position", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Accent-stripped key: "Trưởng phòng" and "truong phong" are the same position.
  searchName: text("search_name").notNull().unique(),
  ...timestamps,
}).enableRLS();

// One row per period a person is employed by an entity. A rehire is a new row for the same person.
// A migration adds an exclusion constraint: a person's employment periods never overlap (FR-PLT-12).
export const employment = pgTable(
  "employment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    employeeCode: text("employee_code").notNull(),
    startDate: date("start_date").notNull(),
    // Start of continuous service for leave and severance; differs from startDate after a transfer.
    seniorityDate: date("seniority_date").notNull(),
    // Last day of employment, inclusive. null = ongoing.
    endDate: date("end_date"),
    ...timestamps,
  },
  (t) => [
    unique("employment_entity_code_key").on(t.entityId, t.employeeCode),
    index("employment_person_idx").on(t.personId),
    check("employment_dates_check", sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
  ],
).enableRLS();

export const assignmentKind = pgEnum("assignment_kind", ["primary", "secondary"]);

// The effective-dated state of an employment: where the person sits, what they do, who they report to.
// Every change is a new row; `validTo` is inclusive and null on the open row. A migration adds an
// exclusion constraint: primary assignments of one employment never overlap (ADR-07).
// The entity comes from the employment, so there is no entity_id here.
export const assignment = pgTable(
  "assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employmentId: uuid("employment_id")
      .notNull()
      .references(() => employment.id),
    kind: assignmentKind("kind").notNull().default("primary"),
    workforceType: workforceType("workforce_type").notNull(),
    branchId: uuid("branch_id").references(() => branch.id),
    departmentId: uuid("department_id").references(() => department.id),
    teamId: uuid("team_id").references(() => team.id),
    positionId: uuid("position_id").references(() => position.id),
    jobLevel: text("job_level"),
    managerId: uuid("manager_id").references(() => person.id),
    dottedManagerId: uuid("dotted_manager_id").references(() => person.id),
    workLocation: text("work_location"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    changeReason: text("change_reason"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("assignment_employment_idx").on(t.employmentId),
    index("assignment_department_idx").on(t.departmentId),
    index("assignment_manager_idx").on(t.managerId),
    check("assignment_dates_check", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
).enableRLS();

// Per-entity employee numbering: prefix + zero-padded counter, e.g. "SZM-0042".
export const employeeCodeScheme = pgTable("employee_code_scheme", {
  entityId: uuid("entity_id")
    .primaryKey()
    .references(() => entity.id),
  prefix: text("prefix").notNull(),
  padding: smallint("padding").notNull().default(4),
  nextNumber: integer("next_number").notNull().default(1),
  ...timestamps,
}).enableRLS();

export const gender = pgEnum("gender", ["male", "female", "other"]);
export const maritalStatus = pgEnum("marital_status", ["single", "married", "divorced", "widowed"]);

// Personal-tier fields (SRS §2.2). Read only through the core-hr service, which checks the tier.
export const personProfile = pgTable("person_profile", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => person.id),
  dateOfBirth: date("date_of_birth"),
  gender: gender("gender"),
  maritalStatus: maritalStatus("marital_status"),
  nationality: text("nationality"),
  phone: text("phone"),
  personalEmail: text("personal_email"),
  permanentAddress: text("permanent_address"),
  currentAddress: text("current_address"),
  ...timestamps,
}).enableRLS();

// A named set of list filters, private to its owner.
export const savedView = pgTable(
  "saved_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    // Which list the view belongs to, e.g. "people".
    list: text("list").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("saved_view_owner_list_name_key").on(t.ownerPersonId, t.list, t.name)],
).enableRLS();
