// Knowledge base (Phase 4, FR-KB-01..06). Spaces hold a tree of pages; a page has a working copy
// (what editors see) and immutable published versions (what readers see). Who sees what is decided
// by `kb_access` rows keyed by one text `subject_key`, so list queries filter in SQL.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, customType, date, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// open = any editor publishes; controlled = publishing goes through review (policies, FR-KB-04).
export const kbSpaceKind = pgEnum("kb_space_kind", ["open", "controlled"]);
export const kbAccessLevel = pgEnum("kb_access_level", ["view", "edit"]);
export const kbPageStatus = pgEnum("kb_page_status", ["draft", "in_review", "published", "archived"]);

export const kbSpace = pgTable(
  "kb_space",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The address of the space: /kb/spaces/<key>.
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    // null = a space of the whole group; otherwise run by that entity's KB managers.
    entityId: uuid("entity_id").references(() => entity.id),
    kind: kbSpaceKind("kind").notNull().default("open"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kb_space_entity_idx").on(t.entityId)],
).enableRLS();

export const kbPage = pgTable(
  "kb_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => kbSpace.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => kbPage.id),
    // The working copy: what editors see and change. Readers get the published version.
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    contentText: text("content_text").notNull().default(""),
    hasUnpublishedChanges: boolean("has_unpublished_changes").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    status: kbPageStatus("status").notNull().default("draft"),
    // The version readers see. A page is readable when this is set and the page is not archived —
    // so a published page stays readable while its next revision is in review.
    publishedVersionId: uuid("published_version_id"),
    publishedTitle: text("published_title"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // The nearest page, this one or an ancestor, that carries page-level access rows; null = the
    // space's rules alone. Kept in step when a restriction is set or cleared and when a page moves,
    // so a restriction covers the whole subtree and a list query can test it without walking the tree.
    accessRootId: uuid("access_root_id"),
    // The open `kb_publish` request while the page is in review — and after a "return for changes",
    // so the editor's next submission goes round on the same request. No foreign key: a plain reference.
    reviewRequestId: uuid("review_request_id"),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    reviewBy: date("review_by"),
    // The owner was told once that `review_by` has passed; a new date asks again (FR-KB-07).
    reviewRemindedOn: date("review_reminded_on"),
    // "Must read" (FR-KB-05): the audience confirms `ack_version_id` — the version published when
    // the requirement was switched on, moved forward only by a MAJOR revision (everyone confirms
    // again). Due `ack_due_days` after `ack_since`, or after the person came onto the books if later.
    ackRequired: boolean("ack_required").notNull().default(false),
    ackVersionId: uuid("ack_version_id"),
    ackSince: timestamp("ack_since", { withTimezone: true }),
    ackDueDays: integer("ack_due_days").notNull().default(14),
    // Search reads the published version only: accent-stripped (`toSearchKey`), so "nghi phep" finds "nghỉ phép".
    searchTitle: text("search_title").notNull().default(""),
    searchBody: text("search_body").notNull().default(""),
    searchVector: tsvector("search_vector").generatedAlwaysAs(sql`setweight(to_tsvector('simple'::regconfig, "search_title"), 'A') || setweight(to_tsvector('simple'::regconfig, "search_body"), 'B')`),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("kb_page_space_parent_idx").on(t.spaceId, t.parentId, t.sortOrder),
    index("kb_page_access_root_idx").on(t.accessRootId),
    index("kb_page_published_at_idx").on(t.publishedAt),
    index("kb_page_search_idx").using("gin", t.searchVector),
  ],
).enableRLS();

// Who may see or edit a space (page_id null) or a page and everything under it (page_id set).
export const kbAccess = pgTable(
  "kb_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => kbSpace.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => kbPage.id, { onDelete: "cascade" }),
    // "all" | "entity:<id>" | "department:<id>" | "team:<id>" | "role:<role>" | "person:<id>" (enums.ts).
    subjectKey: text("subject_key").notNull(),
    level: kbAccessLevel("level").notNull().default("view"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kb_access_space_subject_idx").on(t.spaceId, t.subjectKey).where(sql`${t.pageId} IS NULL`),
    uniqueIndex("kb_access_page_subject_idx").on(t.pageId, t.subjectKey).where(sql`${t.pageId} IS NOT NULL`),
    index("kb_access_subject_idx").on(t.subjectKey),
  ],
).enableRLS();

// What was published, for ever: append-only (database trigger). Restore copies a version back into
// the working copy; it never rewrites history.
export const kbPageVersion = pgTable(
  "kb_page_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    contentText: text("content_text").notNull().default(""),
    authorPersonId: uuid("author_person_id").references(() => person.id),
    changeNote: text("change_note"),
    // A major revision is what makes people acknowledge a policy again (FR-KB-05).
    isMajor: boolean("is_major").notNull().default(false),
    // The review that let it through, in a controlled space. No foreign key: a plain reference.
    approvalRequestId: uuid("approval_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_page_version_no_idx").on(t.pageId, t.versionNo)],
).enableRLS();

// One row per reader, page and day: "recently viewed" and "popular" without a row per click.
export const kbPageView = pgTable(
  "kb_page_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    viewedOn: date("viewed_on").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_page_view_day_idx").on(t.pageId, t.personId, t.viewedOn), index("kb_page_view_person_idx").on(t.personId, t.viewedAt)],
).enableRLS();

// Who must confirm a "must read" page: subject keys as in `kb_access`, without roles.
export const kbAckAudience = pgTable(
  "kb_ack_audience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_ack_audience_page_subject_idx").on(t.pageId, t.subjectKey)],
).enableRLS();

// "I have read and understood version n": append-only (database trigger).
export const kbAcknowledgement = pgTable(
  "kb_acknowledgement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => kbPageVersion.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_acknowledgement_once_idx").on(t.pageId, t.versionId, t.personId), index("kb_acknowledgement_person_idx").on(t.personId)],
).enableRLS();

// Every notice about a pending confirmation: the first one ("requested"), the reminders, the
// overdue ones. At most one per person, version and day — a second run of the job sends nothing.
export const kbAckReminder = pgTable(
  "kb_ack_reminder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    sentOn: date("sent_on").notNull(),
    kind: text("kind").notNull().default("reminder"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_ack_reminder_day_idx").on(t.pageId, t.versionId, t.personId, t.sentOn)],
).enableRLS();

// Starting points for new pages (FR-KB-09): SOP, policy, meeting notes… The system ones come
// from `pnpm db:seed` (re-seeding only adds keys that are missing); managers add their own.
export const kbTemplate = pgTable(
  "kb_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    content: jsonb("content").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [],
).enableRLS();

// Passages of the PUBLISHED version of each page, for the Phase 9 assistant (FR-KB-11). Rebuilt
// inside `publishPage`; gone when the page is unpublished, archived or deleted.
// Decision: the vector is `real[]`, not pgvector's `vector(n)`. The local Supabase image ships
// pgvector 0.8.2 (not installed), but PGlite — every test — has none, and `n` depends on a model
// nobody has chosen. Phase 9 adds `vector(n)` + an HNSW index in its own migration when it
// re-embeds with the real model; until then a company-sized table is ranked in the application.
export const kbPageChunk = pgTable(
  "kb_page_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => kbPage.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    content: text("content").notNull(),
    // sha256 of heading path + content: an unchanged passage keeps its vector across versions.
    contentHash: text("content_hash").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    embedding: real("embedding").array(),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_page_chunk_page_index_idx").on(t.pageId, t.chunkIndex), index("kb_page_chunk_model_idx").on(t.embeddingModel)],
).enableRLS();
