import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { entity } from "../org/schema";
import { person } from "../people/schema";

// pending: an upload was allowed but has not been confirmed; ready: checked and usable;
// rejected: the uploaded bytes were not what was announced, and have been removed.
export const fileStatus = pgEnum("file_status", ["pending", "ready", "rejected"]);

// No scanner is connected yet, so every file says so honestly rather than claiming to be clean.
export const fileScanStatus = pgEnum("file_scan_status", ["not_scanned", "clean", "infected"]);

// What the app knows about a file. The bytes live in a private storage bucket and are only ever
// reached through short-lived signed URLs. A file has no permissions of its own: it belongs to a
// record (`owner_type` + `owner_id`), and the module owning that record decides who may open it.
export const storedFile = pgTable(
  "stored_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket").notNull(),
    objectPath: text("object_path").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    entityId: uuid("entity_id").references(() => entity.id),
    // Sensitivity tier of the contents; opening a restricted or compensation file is audited.
    tier: text("tier").notNull(),
    status: fileStatus("status").notNull().default("pending"),
    scanStatus: fileScanStatus("scan_status").notNull().default("not_scanned"),
    uploadedByPersonId: uuid("uploaded_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("stored_file_owner_idx").on(t.ownerType, t.ownerId)],
).enableRLS();
