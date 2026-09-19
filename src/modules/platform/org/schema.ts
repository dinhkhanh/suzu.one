// Group → legal entities → branches; departments (shared across entities by default) → teams.
import { type AnyPgColumn, boolean, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const entity = pgTable("entity", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  legalName: text("legal_name").notNull(),
  shortName: text("short_name").notNull(),
  taxCode: text("tax_code"),
  insuranceUnitCode: text("insurance_unit_code"),
  // Statutory wage region I–IV; drives the regional minimum wage and the unemployment-insurance cap.
  wageRegion: smallint("wage_region"),
  address: text("address"),
  legalRepresentative: text("legal_representative"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}).enableRLS();

export const branch = pgTable(
  "branch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    name: text("name").notNull(),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("branch_entity_id_idx").on(t.entityId)],
).enableRLS();

export const department = pgTable(
  "department",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => department.id),
    // null = shared across every entity in the group (the default).
    entityId: uuid("entity_id").references(() => entity.id),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("department_entity_id_idx").on(t.entityId)],
).enableRLS();

export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => department.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("team_department_id_idx").on(t.departmentId)],
).enableRLS();
