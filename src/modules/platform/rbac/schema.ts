import { date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../people/schema";

// One org unit covers everything below it (FR-PLT-16), so "department" and "team" are one scope.
export const scopeType = pgEnum("scope_type", ["group", "entity", "unit"]);

// A person holds any number of role + scope pairs. "Self" and "direct reports" access is
// implicit (derived from identity and the manager chain), so it is not stored here.
export const roleAssignment = pgTable(
  "role_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: text("role").notNull(),
    scopeType: scopeType("scope_type").notNull(),
    // null when scopeType = "group"; otherwise the entity or org-unit id.
    scopeId: uuid("scope_id"),
    validFrom: date("valid_from").notNull().defaultNow(),
    validTo: date("valid_to"),
    grantedByPersonId: uuid("granted_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("role_assignment_person_idx").on(t.personId)],
).enableRLS();
