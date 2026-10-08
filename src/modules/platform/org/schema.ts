// Group → legal entities → branches; and one tree of org units (D20, FR-PLT-16): a unit contains
// units, whatever it is called — department, big team, small team. Depth is not fixed.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

// The company's own accounts that salary is paid from (FR-PLT-11, FR-PAY-33; SRS D12: Vietcombank
// and ACB). They are the entity's, not a person's, so they sit in the clear like its tax code; who
// may read and change them is decided by the actions (`org:manage` or `payroll:pay` over the entity).
export const entityBankAccount = pgTable(
  "entity_bank_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    // A key of `PAYING_BANKS` (enums.ts) — the bank whose bulk-payment file debits this account.
    bank: text("bank").notNull(),
    // Digits only; spaces and dashes are dropped when it is saved.
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    branch: text("branch"),
    // The one the bank-file screen offers first, per entity and bank.
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("entity_bank_account_key").on(t.entityId, t.bank, t.accountNumber),
    // One default per entity and bank among the accounts still in use.
    uniqueIndex("entity_bank_account_default_key")
      .on(t.entityId, t.bank)
      .where(sql`${t.isDefault} AND ${t.isActive}`),
  ],
).enableRLS();

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
