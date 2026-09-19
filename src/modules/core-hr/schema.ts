// Core HR: employment periods, effective-dated assignments, positions, employee-code numbering,
// the personal-tier profile and saved list views. One table per sensitivity tier on purpose:
// `person` (platform) holds public_internal fields, `person_profile` holds personal ones;
// restricted fields get their own encrypted table.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, date, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { storedFile } from "../platform/files/schema";
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

// ── Week 2: restricted fields, contracts, dependents, document vault, alerts ─────────────────

// Restricted-tier fields (SRS §2.2, DR-05). Every `*_enc`-style column below holds the output of
// the field cipher, bound to its row and column: context "person_sensitive.<column>:<personId>".
// Nothing here is readable with database access alone.
export const personSensitive = pgTable(
  "person_sensitive",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => person.id),
    nationalId: text("national_id"),
    // Blind index of the normalised number: finds duplicates without decrypting anything.
    nationalIdIndex: text("national_id_index"),
    nationalIdIssuedOn: text("national_id_issued_on"),
    nationalIdIssuedAt: text("national_id_issued_at"),
    passportNumber: text("passport_number"),
    taxCode: text("tax_code"),
    socialInsuranceNumber: text("social_insurance_number"),
    healthInsuranceHospital: text("health_insurance_hospital"),
    // One encrypted JSON array: [{ bankName, accountNumber, accountHolder, branch }].
    bankAccounts: text("bank_accounts"),
    ...timestamps,
  },
  (t) => [index("person_sensitive_national_id_idx").on(t.nationalIdIndex)],
).enableRLS();

export const contractType = pgEnum("contract_type", ["probation", "fixed_term", "indefinite", "service", "internship", "nda", "appendix"]);
// Decides the longest probation the law allows (Labour Code 2019, art. 25); limits live in the statutory store.
export const jobCategory = pgEnum("job_category", ["manager", "professional", "intermediate", "other"]);

// Type, number and dates are personal tier (the line manager is told when a contract runs out);
// salary terms and the signed copy (a stored_file owned by "contract") are compensation tier.
export const contract = pgTable(
  "contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employmentId: uuid("employment_id")
      .notNull()
      .references(() => employment.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    number: text("number").notNull(),
    type: contractType("type").notNull(),
    // Appendices hang off the contract they amend.
    parentContractId: uuid("parent_contract_id").references((): AnyPgColumn => contract.id),
    jobCategory: jobCategory("job_category"),
    signDate: date("sign_date"),
    startDate: date("start_date").notNull(),
    // Last day, inclusive. null = open-ended.
    endDate: date("end_date"),
    // Encrypted free text, context "contract.salary_terms:<id>". Structured pay arrives with payroll (Phase 5).
    salaryTerms: text("salary_terms"),
    note: text("note"),
    // Ended early: the last day it was in force.
    terminatedOn: date("terminated_on"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("contract_entity_number_key").on(t.entityId, t.number),
    index("contract_person_idx").on(t.personId),
    index("contract_end_date_idx").on(t.endDate),
    check("contract_dates_check", sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
  ],
).enableRLS();

export const dependentRelationship = pgEnum("dependent_relationship", ["child", "spouse", "parent", "parent_in_law", "sibling", "grandparent", "other"]);

// The PIT family-deduction register (FR-CHR-07). Restricted tier as a whole. Supporting documents
// are stored_files owned by "dependent".
export const dependent = pgTable(
  "dependent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    fullName: text("full_name").notNull(),
    relationship: dependentRelationship("relationship").notNull(),
    dateOfBirth: date("date_of_birth"),
    // Encrypted: contexts "dependent.id_number:<id>" and "dependent.tax_code:<id>".
    idNumber: text("id_number"),
    taxCode: text("tax_code"),
    // Deduction months, stored as the first day of the month. `deductionTo` is the last month, inclusive.
    deductionFrom: date("deduction_from").notNull(),
    deductionTo: date("deduction_to"),
    note: text("note"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("dependent_person_idx").on(t.personId), check("dependent_months_check", sql`${t.deductionTo} IS NULL OR ${t.deductionTo} >= ${t.deductionFrom}`)],
).enableRLS();

export const documentCategory = pgEnum("document_category", ["id_scan", "degree", "certificate", "health_check", "contract", "decision", "other"]);

// The employee document vault (FR-CHR-08). `tier` is fixed by the category when the row is made
// (see document-tiers.ts) and is what every read is checked against.
export const personDocument = pgTable(
  "person_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    category: documentCategory("category").notNull(),
    title: text("title").notNull(),
    expiresOn: date("expires_on"),
    tier: text("tier").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFile.id),
    uploadedByPersonId: uuid("uploaded_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("person_document_person_idx").on(t.personId), index("person_document_expires_idx").on(t.expiresOn)],
).enableRLS();

// Personal tier (FR-CHR-01).
export const emergencyContact = pgTable(
  "emergency_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    fullName: text("full_name").notNull(),
    relationship: text("relationship"),
    phone: text("phone").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("emergency_contact_person_idx").on(t.personId)],
).enableRLS();

// What the daily alerts job has already told people, so a second run (or a retry) stays silent.
// The due date is part of the key: move a contract's end date and the countdown starts again.
export const hrAlertSent = pgTable(
  "hr_alert_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    dueOn: date("due_on").notNull(),
    thresholdDays: integer("threshold_days").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("hr_alert_sent_key").on(t.kind, t.subjectId, t.dueOn, t.thresholdDays)],
).enableRLS();
