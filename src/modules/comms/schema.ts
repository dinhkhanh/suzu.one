// Internal communications (Phase 4, FR-COM-01..03): announcements with an audience and read
// tracking, kudos tied to company values. The audience uses the knowledge base's subject keys
// ("all", "entity:<uuid>", "department:<uuid>", "team:<uuid>", "branch:<uuid>", "person:<uuid>"),
// one text column, so "what may I see" and "who is this for" are both answered in SQL.
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";

// A published row whose `publish_at` is still ahead is "scheduled": visibility is computed when it
// is read (`publish_at <= now()`), so the hour is exact without a frequent cron.
export const announcementStatus = pgEnum("announcement_status", ["draft", "published", "archived"]);

export const announcement = pgTable(
  "announcement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The one entity every audience target sits in; null = wider than one entity.
    entityId: uuid("entity_id").references(() => entity.id),
    title: text("title").notNull(),
    // Plain text. Shown as paragraphs; never parsed as HTML.
    body: text("body").notNull(),
    // A knowledge-base page to read with it. No foreign key: modules meet through their services,
    // and the title is resolved through the KB with the reader's own permissions.
    kbPageId: uuid("kb_page_id"),
    pinned: boolean("pinned").notNull().default(false),
    mustAcknowledge: boolean("must_acknowledge").notNull().default(false),
    status: announcementStatus("status").notNull().default("draft"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // When the audience was told; null = the announcements job still has to.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("announcement_status_publish_idx").on(t.status, t.publishAt), index("announcement_author_idx").on(t.authorPersonId)],
).enableRLS();

export const announcementAudience = pgTable(
  "announcement_audience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
  },
  (t) => [uniqueIndex("announcement_audience_subject_idx").on(t.announcementId, t.subjectKey), index("announcement_audience_key_idx").on(t.subjectKey)],
).enableRLS();

export const announcementRead = pgTable(
  "announcement_read",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("announcement_read_person_idx").on(t.announcementId, t.personId), index("announcement_read_by_person_idx").on(t.personId)],
).enableRLS();

// The company's values, as configuration: HR edits the rows, the code names none of them.
export const companyValue = pgTable("company_value", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  nameVi: text("name_vi").notNull(),
  nameEn: text("name_en").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const kudos = pgTable(
  "kudos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => person.id),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => person.id),
    // A `company_value.key`. No foreign key: a value that is switched off keeps its kudos.
    valueKey: text("value_key").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => person.id),
  },
  (t) => [index("kudos_to_idx").on(t.toPersonId, t.createdAt), index("kudos_created_idx").on(t.createdAt)],
).enableRLS();
