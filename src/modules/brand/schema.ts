// Brand kits (FR-BRD-01..06): each of the group's brands as a guideline a partner, a supplier or a
// journalist reads on the public domain (suzu.vn/brands/<slug>) — what the brand is, how to show
// it and how not to, its colours and typefaces — with the logos and brochures to download beside
// the words. The bytes are ordinary stored files (`stored_file`, owner type `brand_asset`); these
// tables say which kit a file belongs to, where it sits in the guideline, and whether the public
// may have it.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { storedFile } from "../platform/files/schema";
import { entity } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { BrandAssetKind, BrandRuleVerdict, BrandSectionKind, BrandVisibility } from "./enums";

/** One colour of a palette: "Suzu Red", "#EA3026", and what the keeper adds ("Pantone 485 C · primary"). */
export type BrandColor = { name: string; hex: string; note: string | null };
/** One typeface: its name, what it is for ("headings"), where to get it. */
export type BrandFont = { name: string; usage: string | null; url: string | null };

export const brandKit = pgTable(
  "brand_kit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The address on the public domain: /brands/<slug>. Readable, chosen by whoever keeps the kit.
    slug: text("slug").notNull().unique(),
    // Earlier slugs, so a link printed on a brochure keeps working after a rename (it redirects).
    formerSlugs: text("former_slugs").array().notNull().default([]),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    descriptionEn: text("description_en"),
    websiteUrl: text("website_url"),
    // Where a reader asks what the guideline does not answer.
    contactEmail: text("contact_email"),
    colors: jsonb("colors").$type<BrandColor[]>().notNull().default([]),
    fonts: jsonb("fonts").$type<BrandFont[]>().notNull().default([]),
    visibility: text("visibility").$type<BrandVisibility>().notNull().default("hidden"),
    // The company that owns the brand, when one does; null for a brand of the whole group. Decides
    // whose `brand:manage` grant reaches the kit.
    entityId: uuid("entity_id").references(() => entity.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("brand_kit_visibility_check", sql`${t.visibility} in ('hidden', 'unlisted', 'listed')`)],
).enableRLS();

// A chapter of the guideline: "Logo", "Clear space", "Colour"… in the order the page reads.
export const brandSection = pgTable(
  "brand_section",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandKit.id, { onDelete: "cascade" }),
    kind: text("kind").$type<BrandSectionKind>().notNull().default("content"),
    title: text("title").notNull(),
    titleEn: text("title_en"),
    // Markdown, built into the document allow-list and rendered from that (never as HTML).
    body: text("body"),
    bodyEn: text("body_en"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brand_section_brand_idx").on(t.brandId, t.sortOrder), check("brand_section_kind_check", sql`${t.kind} in ('content', 'palette', 'typography', 'downloads')`)],
).enableRLS();

export const brandAsset = pgTable(
  "brand_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandKit.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .unique()
      .references(() => storedFile.id),
    // The section that offers it ("Logo" offers the logo files); null: the downloads section.
    sectionId: uuid("section_id").references(() => brandSection.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: text("kind").$type<BrandAssetKind>().notNull(),
    // Off for a file kept with the kit but not handed out (a working file, a draft).
    isPublic: boolean("is_public").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("brand_asset_brand_idx").on(t.brandId, t.sortOrder),
    check("brand_asset_kind_check", sql`${t.kind} in ('logo', 'guideline', 'brochure', 'image', 'video', 'pack', 'other', 'example')`),
  ],
).enableRLS();

// A do or a don't of a section, with the picture that shows it when there is one.
export const brandRule = pgTable(
  "brand_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => brandSection.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<BrandRuleVerdict>().notNull(),
    text: text("text").notNull(),
    textEn: text("text_en"),
    exampleAssetId: uuid("example_asset_id").references(() => brandAsset.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brand_rule_section_idx").on(t.sectionId, t.sortOrder), check("brand_rule_verdict_check", sql`${t.verdict} in ('do', 'dont')`)],
).enableRLS();

// Downloads from the public page, one counter per file and day: enough to see which files are
// wanted, and nothing about who wanted them.
export const brandAssetDownload = pgTable(
  "brand_asset_download",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => brandAsset.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    downloads: integer("downloads").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.day] })],
).enableRLS();

/**
 * Counted requests to the public file route (NFR-SEC-03) — the same fixed window the careers page
 * and the client review links use, kept in this module because the table belongs to whoever owns
 * the surface. `key_hash` is a hashed visitor re-keyed every day (`brandVisitorKey`), never an
 * address; a row says that *somebody* asked for files that hour, which is all a limiter needs.
 */
export const brandFileHit = pgTable(
  "brand_file_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What was counted: "download", "preview". See `BRAND_FILE_LIMITS`.
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("brand_file_hit_key").on(t.bucket, t.keyHash, t.windowStart), index("brand_file_hit_window_idx").on(t.windowStart)],
).enableRLS();
