import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../people/schema";

// invalid: problems were found, nothing can be committed; ready: clean, waiting for the person to
// confirm the preview; committed: written to the real tables.
export const importStatus = pgEnum("import_status", ["invalid", "ready", "committed"]);

// A spreadsheet someone uploaded, parsed and checked but not yet applied (FR-PLT-36). Keeping the
// parsed rows here means what gets committed is exactly what was previewed.
export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    status: importStatus("status").notNull(),
    rowCount: integer("row_count").notNull(),
    rows: jsonb("rows").notNull(),
    problems: jsonb("problems").notNull(),
    result: jsonb("result"),
    // What was chosen beside the file (which device a log came from); null for imports that take none.
    params: jsonb("params"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => [index("import_batch_created_by_idx").on(t.createdByPersonId, t.createdAt)],
).enableRLS();
