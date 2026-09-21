// Group → legal entities → branches; and one tree of org units (D20, FR-PLT-16): a unit contains
// units, whatever it is called — department, big team, small team. Depth is not fixed.
import { type AnyPgColumn, boolean, index, pgEnum, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

// What a unit is called. Nothing but the derived placement columns (`person.department_id`,
// `person.team_id`) reads it: depth, not kind, is what the tree means.
export const orgUnitKind = pgEnum("org_unit_kind", ["department", "team"]);

export const orgUnit = pgTable(
  "org_unit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Departments carry the codes the Excel import matches on; a team usually has none.
    code: text("code").unique(),
    name: text("name").notNull(),
    kind: orgUnitKind("kind").notNull().default("department"),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnit.id),
    // null = shared across every entity in the group (the default).
    entityId: uuid("entity_id").references(() => entity.id),
    /**
     * Every ancestor of this unit and the unit itself, root first — maintained by the database
     * (`org_unit_path_set`), never written by the application. It is what makes "name a unit and
     * reach everything below it" (FR-PLT-16) one array overlap instead of a walk up the tree, in
     * SQL and in the pure policy alike. A move rewrites the paths of the whole subtree.
     */
    path: uuid("path").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("org_unit_entity_id_idx").on(t.entityId), index("org_unit_parent_idx").on(t.parentId), index("org_unit_path_idx").using("gin", t.path)],
).enableRLS();
