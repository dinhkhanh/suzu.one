import { boolean, date, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../people/schema";

export const parameterStatus = pgEnum("parameter_status", ["proposed", "approved", "rejected"]);

// Legal rates, caps, brackets and multipliers (FR-PLT-38). Never constants in code: every version
// says from when it applies, where it comes from, who proposed it and who approved it (FR-PLT-39).
// Approved versions of one key never overlap — an exclusion constraint in the migration enforces it.
export const statutoryParameter = pgTable(
  "statutory_parameter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A key from catalogue.ts, e.g. "pit.brackets". The catalogue defines the shape of `value`.
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    status: parameterStatus("status").notNull().default("proposed"),
    // The decree, law or circular this comes from.
    legalReference: text("legal_reference"),
    note: text("note"),
    // Seed values come from public sources; the chief accountant confirms each before payroll relies on it.
    isVerified: boolean("is_verified").notNull().default(false),
    proposedByPersonId: uuid("proposed_by_person_id").references(() => person.id),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("statutory_parameter_key_idx").on(t.key, t.validFrom)],
).enableRLS();
