// Document generation from templates (FR-CHR-06): contracts, decisions and confirmation letters.
//
// Two tables. A template is text with `{{placeholders}}`; a generated document is the record that
// it happened — who made what for whom, and when — and the paper itself, as it was issued.
//
// The paper is a PDF in the files module, never text in a column: a salary letter sitting in a
// table is a salary letter anybody who reaches the table can read, while a stored file carries the
// document's tier and opens only through a one-minute link handed out after the tier is checked
// again, *now*. What it must not do is change: a numbered decision re-rendered from today's
// template, date and facts is not the decision that was signed (CHR-01), so opening one opens the
// file that was made when it was issued.
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storedFile } from "../platform/files/schema";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { Tier } from "../platform/rbac/roles";
import type { DocumentKind, LetterheadFields } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const documentTemplate = pgTable(
  "document_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    // Per entity, with its own letterhead; null = the group's, usable by every entity.
    entityId: uuid("entity_id").references(() => entity.id),
    kind: text("kind").$type<DocumentKind>().notNull(),
    /**
     * The sensitivity of what this template prints. A body naming a compensation placeholder
     * cannot be saved below `compensation` — `engine/template.ts` refuses it — so this column is
     * a promise the engine keeps rather than a label somebody remembered to set.
     */
    tier: text("tier").$type<Tier>().notNull(),
    body: text("body").notNull(),
    // Name, address, tax code and who signs — printed at the head and foot of the page.
    letterhead: jsonb("letterhead").$type<LetterheadFields>().notNull().default({}),
    // Bumped on every edit, and copied onto each generated document, so an old paper can be
    // traced to the wording it was made from even after the template has moved on.
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("document_template_kind_idx").on(t.kind, t.isActive), index("document_template_entity_idx").on(t.entityId)],
).enableRLS();

// One paper that was made. No text and no figures in the row — see the note at the top of the file.
export const generatedDocument = pgTable(
  "generated_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => documentTemplate.id),
    // Kept beside the id so the history still reads if a template is renamed.
    templateCode: text("template_code").notNull(),
    templateVersion: integer("template_version").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    tier: text("tier").$type<Tier>().notNull(),
    subjectPersonId: uuid("subject_person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    // "SZM-XN-2026-0007": what the paper calls itself, so it can be quoted back.
    number: text("number").notNull().unique(),
    generatedByPersonId: uuid("generated_by_person_id")
      .notNull()
      .references(() => person.id),
    // The paper as issued, at the document's tier. null only for a document made before papers were
    // kept: it is issued on its first opening, and that file is the paper from then on.
    fileId: uuid("file_id").references(() => storedFile.id),
    // The template's name on the day — the paper's title, and the register's.
    title: text("title"),
    // The lifecycle event the paper was issued for (a probation pass, a renewal). No foreign key across modules' tables.
    eventId: uuid("event_id"),
    ...timestamps,
  },
  (t) => [index("generated_document_subject_idx").on(t.subjectPersonId, t.createdAt), index("generated_document_template_idx").on(t.templateId)],
).enableRLS();
