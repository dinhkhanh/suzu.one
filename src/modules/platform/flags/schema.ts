import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../people/schema";

// Who a feature is switched on for (ADR-11): everyone, or chosen entities, departments and people.
// The flags themselves are declared in flags.ts; a row here only records a rollout. No row = off.
export const featureFlag = pgTable("feature_flag", {
  key: text("key").primaryKey(),
  enabledForAll: boolean("enabled_for_all").notNull().default(false),
  entityIds: uuid("entity_ids").array().notNull().default([]),
  departmentIds: uuid("department_ids").array().notNull().default([]),
  personIds: uuid("person_ids").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
}).enableRLS();
