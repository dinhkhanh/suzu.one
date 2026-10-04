// Brand kits (FR-BRD-01..06): the use-cases behind the admin pages. The public pages read through
// `public.ts`. Kits, their sections, rules and files are small reference tables read on every visit
// to the public pages, so each sits whole in the shared cache under one key and is filtered here;
// every writer below drops all four keys once its change has committed. Download counts change on
// every visit and are summed in SQL beside them, never cached.
import "server-only";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";
import { beginUpload, completeUpload, softDeleteFile } from "../platform/files/service";
import { BRAND_OWNER_TYPE } from "../platform/files/rules";
import type { Principal } from "../platform/rbac/policy";
import { type BrandAssetKind, type BrandRuleVerdict, type BrandSectionKind, type BrandVisibility, MAX_BRAND_ASSETS, MAX_BRAND_RULES, MAX_BRAND_SECTIONS } from "./enums";
import { canManageBrandKit } from "./policy";
import type { BrandColor, BrandFont } from "./schema";
import { compareAssets, isValidBrandSlug } from "./engine/kit";
import { BRAND_HIT_RETENTION_DAYS } from "./engine/rate-limit";

type Executor = Tx | ReturnType<typeof db>;
type Actor = { personId: string; email?: string | null };

export type BrandKitRow = typeof schema.brandKit.$inferSelect;
export type BrandSectionRow = typeof schema.brandSection.$inferSelect;
export type BrandRuleRow = typeof schema.brandRule.$inferSelect;
export type BrandAssetRow = typeof schema.brandAsset.$inferSelect;
/** A kit's file with what the page shows of the stored file behind it. */
export type BrandAssetView = BrandAssetRow & { fileName: string; sizeBytes: number; contentType: string };

const BRAND_CACHE = { kits: "brand:kits", sections: "brand:sections", rules: "brand:rules", assets: "brand:assets" } as const;

/** After any write to a brand table, or to a kit's stored files, has committed. */
export const invalidateBrandKits = () => invalidate(BRAND_CACHE.kits, BRAND_CACHE.sections, BRAND_CACHE.rules, BRAND_CACHE.assets);

// ── Reads (whole tables, cached; inside a transaction from the transaction) ─────────────────

export async function allBrandKits(executor?: Executor): Promise<BrandKitRow[]> {
  const load = (from: Executor) => from.select().from(schema.brandKit).orderBy(schema.brandKit.sortOrder, schema.brandKit.name, schema.brandKit.id);
  return executor ? load(executor) : cached(BRAND_CACHE.kits, TTL.reference, () => load(db()));
}

export async function allBrandSections(executor?: Executor): Promise<BrandSectionRow[]> {
  const load = (from: Executor) => from.select().from(schema.brandSection).orderBy(schema.brandSection.brandId, schema.brandSection.sortOrder, schema.brandSection.createdAt, schema.brandSection.id);
  return executor ? load(executor) : cached(BRAND_CACHE.sections, TTL.reference, () => load(db()));
}

export async function allBrandRules(executor?: Executor): Promise<BrandRuleRow[]> {
  const load = (from: Executor) => from.select().from(schema.brandRule).orderBy(schema.brandRule.sectionId, schema.brandRule.sortOrder, schema.brandRule.createdAt, schema.brandRule.id);
  return executor ? load(executor) : cached(BRAND_CACHE.rules, TTL.reference, () => load(db()));
}

/** Every kit's files that are stored and not removed, each kit's in a downloads list's order. */
export async function allBrandAssets(executor?: Executor): Promise<BrandAssetView[]> {
  const load = async (from: Executor) => {
    const rows = await from
      .select({ asset: schema.brandAsset, fileName: schema.storedFile.fileName, sizeBytes: schema.storedFile.sizeBytes, contentType: schema.storedFile.contentType })
      .from(schema.brandAsset)
      .innerJoin(schema.storedFile, eq(schema.storedFile.id, schema.brandAsset.fileId))
      .where(and(eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt)))
      .orderBy(schema.brandAsset.brandId, schema.brandAsset.sortOrder, schema.brandAsset.title, schema.brandAsset.id);
    return rows.map(({ asset, ...file }) => ({ ...asset, ...file })).sort((a, b) => a.brandId.localeCompare(b.brandId) || compareAssets(a, b));
  };
  return executor ? load(executor) : cached(BRAND_CACHE.assets, TTL.reference, () => load(db()));
}

export async function findBrandKit(kitId: string): Promise<BrandKitRow | undefined> {
  return (await allBrandKits()).find((kit) => kit.id === kitId);
}

/** Everything one kit's guideline holds: its sections in order, their rules, its files. */
export type BrandKitContent = { kit: BrandKitRow; sections: BrandSectionRow[]; rules: BrandRuleRow[]; assets: BrandAssetView[] };

export async function loadBrandKitContent(kit: BrandKitRow): Promise<BrandKitContent> {
  const [sections, rules, assets] = await Promise.all([allBrandSections(), allBrandRules(), allBrandAssets()]);
  const own = sections.filter((section) => section.brandId === kit.id);
  const sectionIds = new Set(own.map((section) => section.id));
  return { kit, sections: own, rules: rules.filter((rule) => sectionIds.has(rule.sectionId)), assets: assets.filter((asset) => asset.brandId === kit.id) };
}

/** The kits this person keeps, in the list's order. */
export async function listManagedBrandKits(principal: Principal): Promise<BrandKitRow[]> {
  return (await allBrandKits()).filter((kit) => canManageBrandKit(principal, kit));
}

export type BrandKitTotals = { sections: number; files: number; downloads: number };

/** How many sections and stored files each kit holds, and its downloads of all time — one aggregate. */
export async function totalsByKit(kitIds: readonly string[]): Promise<Map<string, BrandKitTotals>> {
  if (kitIds.length === 0) return new Map();
  // Written out with aliases: drizzle drops the table from a column name when a query has one
  // table, which leaves a correlated subquery's `id` ambiguous.
  const result = await db().execute(sql`
    select k.id as brand_id,
      (select count(*)::int from brand_section s where s.brand_id = k.id) as sections,
      (select count(*)::int from brand_asset a join stored_file f on f.id = a.file_id where a.brand_id = k.id and f.status = 'ready' and f.deleted_at is null) as files,
      (select coalesce(sum(d.downloads), 0)::int from brand_asset_download d join brand_asset a on a.id = d.asset_id where a.brand_id = k.id) as downloads
    from brand_kit k
    where k.id in (${sql.join(kitIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map(rowsOf<{ brand_id: string; sections: number; files: number; downloads: number }>(result).map((row) => [row.brand_id, { sections: row.sections, files: row.files, downloads: row.downloads }]));
}

/** Downloads per file of one kit, all time and over the last 30 days — summed in SQL. */
export async function downloadTotalsByAsset(kitId: string, today: string): Promise<Map<string, { total: number; recent: number }>> {
  const rows = await db()
    .select({
      assetId: schema.brandAssetDownload.assetId,
      total: sql<number>`sum(${schema.brandAssetDownload.downloads})::int`,
      recent: sql<number>`coalesce(sum(${schema.brandAssetDownload.downloads}) filter (where ${schema.brandAssetDownload.day} > ${today}::date - 30), 0)::int`,
    })
    .from(schema.brandAssetDownload)
    .innerJoin(schema.brandAsset, eq(schema.brandAsset.id, schema.brandAssetDownload.assetId))
    .where(eq(schema.brandAsset.brandId, kitId))
    .groupBy(schema.brandAssetDownload.assetId);
  return new Map(rows.map((row) => [row.assetId, { total: row.total, recent: row.recent }]));
}

/**
 * The file route's counted windows older than their retention (`brand_file_hit`,
 * `BRAND_HIT_RETENTION_DAYS`) — nobody can still be inside them. Swept nightly with the other
 * public surface's (`workPreviewSweepJob`); returns how many went, as the database counted them:
 * postgres-js answers with `count`, the PGlite of the service tests with `rowCount`.
 */
export async function purgeBrandFileHits(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - BRAND_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = (await db().delete(schema.brandFileHit).where(lt(schema.brandFileHit.windowStart, before))) as { count?: number; rowCount?: number } | undefined;
  return result?.count ?? result?.rowCount ?? 0;
}

// ── Kits ────────────────────────────────────────────────────────────────────────────────────

export type BrandKitDetails = {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  descriptionEn: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  visibility: BrandVisibility;
  entityId: string | null;
};

/** Whether a slug is free for this kit: no other kit has it as its current address. */
async function checkSlugFree(tx: Executor, slug: string, kitId: string | null): Promise<void> {
  if (!isValidBrandSlug(slug)) throw new ActionError("slug_invalid");
  const [taken] = await tx.select({ id: schema.brandKit.id }).from(schema.brandKit).where(eq(schema.brandKit.slug, slug)).limit(1);
  if (taken && taken.id !== kitId) throw new ActionError("slug_taken");
}

/** A new kit, hidden, with the usual chapters of a guideline already in place to be written. */
export async function createBrandKit(input: { name: string; slug: string; entityId: string | null }, starter: readonly { kind: BrandSectionKind; title: string; titleEn: string }[], actor: Actor): Promise<BrandKitRow> {
  const created = await db().transaction(async (tx) => {
    await checkSlugFree(tx, input.slug, null);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${schema.brandKit.sortOrder}), 0)::int + 10` }).from(schema.brandKit);
    const [kit] = await tx.insert(schema.brandKit).values({ name: input.name, slug: input.slug, entityId: input.entityId, sortOrder: next, createdByPersonId: actor.personId }).returning();
    if (starter.length > 0) await tx.insert(schema.brandSection).values(starter.map((section, index) => ({ brandId: kit.id, kind: section.kind, title: section.title, titleEn: section.titleEn, sortOrder: (index + 1) * 10 })));
    return kit;
  });
  await invalidateBrandKits();
  return created;
}

/**
 * A change to a kit's details. A new slug keeps the old one as a former address, so a link already
 * sent to a partner or printed on a brochure is sent on to the new one; a slug the kit takes back
 * stops being a former one.
 */
export async function updateBrandKitDetails(kitId: string, input: BrandKitDetails): Promise<{ before: BrandKitRow; after: BrandKitRow }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.brandKit).where(eq(schema.brandKit.id, kitId)).for("update").limit(1);
    if (!before) throw new ActionError("brand_not_found");
    await checkSlugFree(tx, input.slug, kitId);
    const formerSlugs = input.slug === before.slug ? before.formerSlugs : [...new Set([...before.formerSlugs, before.slug])].filter((slug) => slug !== input.slug);
    const [after] = await tx
      .update(schema.brandKit)
      .set({ ...input, formerSlugs, updatedAt: new Date() })
      .where(eq(schema.brandKit.id, kitId))
      .returning();
    return { before, after };
  });
  await invalidateBrandKits();
  return result;
}

/** The kit's palette and typefaces, already cleaned (`cleanPalette`, `cleanFonts`). */
export async function updateBrandKitStyle(kitId: string, input: { colors: BrandColor[]; fonts: BrandFont[] }): Promise<BrandKitRow> {
  const [after] = await db().update(schema.brandKit).set({ ...input, updatedAt: new Date() }).where(eq(schema.brandKit.id, kitId)).returning();
  if (!after) throw new ActionError("brand_not_found");
  await invalidateBrandKits();
  return after;
}

/** Only a kit without files can go: files are removed one by one, deliberately. Hide a kit to withdraw it. */
export async function deleteBrandKit(kitId: string): Promise<BrandKitRow> {
  const removed = await db().transaction(async (tx) => {
    const [{ files }] = await tx.select({ files: sql<number>`count(*)::int` }).from(schema.brandAsset).where(eq(schema.brandAsset.brandId, kitId));
    if (files > 0) throw new ActionError("brand_has_files");
    const [kit] = await tx.delete(schema.brandKit).where(eq(schema.brandKit.id, kitId)).returning();
    if (!kit) throw new ActionError("brand_not_found");
    return kit;
  });
  await invalidateBrandKits();
  return removed;
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────

export async function findBrandSection(sectionId: string): Promise<BrandSectionRow | undefined> {
  return (await allBrandSections()).find((section) => section.id === sectionId);
}

export async function createBrandSection(kitId: string, input: { kind: BrandSectionKind; title: string; titleEn: string | null }): Promise<BrandSectionRow> {
  const created = await db().transaction(async (tx) => {
    const [{ sections, next }] = await tx
      .select({ sections: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${schema.brandSection.sortOrder}), 0)::int + 10` })
      .from(schema.brandSection)
      .where(eq(schema.brandSection.brandId, kitId));
    if (sections >= MAX_BRAND_SECTIONS) throw new ActionError("too_many_sections");
    const [section] = await tx.insert(schema.brandSection).values({ brandId: kitId, ...input, sortOrder: next }).returning();
    return section;
  });
  await invalidateBrandKits();
  return created;
}

export async function updateBrandSection(sectionId: string, input: { kind: BrandSectionKind; title: string; titleEn: string | null; body: string | null; bodyEn: string | null }): Promise<{ before: BrandSectionRow; after: BrandSectionRow }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.brandSection).where(eq(schema.brandSection.id, sectionId)).limit(1);
    if (!before) throw new ActionError("section_not_found");
    const [after] = await tx.update(schema.brandSection).set({ ...input, updatedAt: new Date() }).where(eq(schema.brandSection.id, sectionId)).returning();
    return { before, after };
  });
  await invalidateBrandKits();
  return result;
}

/** Swaps the section with the one before or after it; the first cannot go up nor the last down. */
export async function moveBrandSection(sectionId: string, direction: "up" | "down"): Promise<BrandSectionRow> {
  const moved = await db().transaction(async (tx) => {
    const [section] = await tx.select().from(schema.brandSection).where(eq(schema.brandSection.id, sectionId)).limit(1);
    if (!section) throw new ActionError("section_not_found");
    const siblings = await tx.select().from(schema.brandSection).where(eq(schema.brandSection.brandId, section.brandId)).orderBy(schema.brandSection.sortOrder, schema.brandSection.createdAt, schema.brandSection.id);
    const at = siblings.findIndex((row) => row.id === sectionId);
    const swap = siblings[direction === "up" ? at - 1 : at + 1];
    if (!swap) return section;
    // Renumbered whole, so equal sort orders (rows written behind the app's back) cannot stall a move.
    const order = siblings.map((row) => row.id);
    [order[at], order[siblings.indexOf(swap)]] = [order[siblings.indexOf(swap)], order[at]];
    const renumbered = sql.join(
      order.map((id, index) => sql`when ${id}::uuid then ${(index + 1) * 10}::int`),
      sql` `,
    );
    await tx
      .update(schema.brandSection)
      .set({ sortOrder: sql`case ${schema.brandSection.id} ${renumbered} end` })
      .where(eq(schema.brandSection.brandId, section.brandId));
    return section;
  });
  await invalidateBrandKits();
  return moved;
}

/** Its rules go with it; its files stay in the kit and move to the downloads section. */
export async function deleteBrandSection(sectionId: string): Promise<BrandSectionRow> {
  const [removed] = await db().delete(schema.brandSection).where(eq(schema.brandSection.id, sectionId)).returning();
  if (!removed) throw new ActionError("section_not_found");
  await invalidateBrandKits();
  return removed;
}

// ── Do's and don'ts ─────────────────────────────────────────────────────────────────────────

export type BrandRuleInput = { verdict: BrandRuleVerdict; text: string; textEn: string | null; exampleAssetId: string | null };

/** The example picture must be a file of the same kit. */
async function checkExample(tx: Executor, kitId: string, assetId: string | null): Promise<void> {
  if (!assetId) return;
  const [asset] = await tx.select({ brandId: schema.brandAsset.brandId }).from(schema.brandAsset).where(eq(schema.brandAsset.id, assetId)).limit(1);
  if (asset?.brandId !== kitId) throw new ActionError("file_not_found");
}

export async function findBrandRule(ruleId: string): Promise<BrandRuleRow | undefined> {
  return (await allBrandRules()).find((rule) => rule.id === ruleId);
}

export async function createBrandRule(section: BrandSectionRow, input: BrandRuleInput): Promise<BrandRuleRow> {
  const created = await db().transaction(async (tx) => {
    await checkExample(tx, section.brandId, input.exampleAssetId);
    const [{ rules, next }] = await tx
      .select({ rules: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${schema.brandRule.sortOrder}), 0)::int + 10` })
      .from(schema.brandRule)
      .where(eq(schema.brandRule.sectionId, section.id));
    if (rules >= MAX_BRAND_RULES) throw new ActionError("too_many_rules");
    const [rule] = await tx.insert(schema.brandRule).values({ sectionId: section.id, ...input, sortOrder: next }).returning();
    return rule;
  });
  await invalidateBrandKits();
  return created;
}

export async function updateBrandRule(section: BrandSectionRow, ruleId: string, input: BrandRuleInput): Promise<BrandRuleRow> {
  const updated = await db().transaction(async (tx) => {
    await checkExample(tx, section.brandId, input.exampleAssetId);
    const [rule] = await tx
      .update(schema.brandRule)
      .set(input)
      .where(and(eq(schema.brandRule.id, ruleId), eq(schema.brandRule.sectionId, section.id)))
      .returning();
    if (!rule) throw new ActionError("rule_not_found");
    return rule;
  });
  await invalidateBrandKits();
  return updated;
}

export async function deleteBrandRule(ruleId: string): Promise<BrandRuleRow> {
  const [removed] = await db().delete(schema.brandRule).where(eq(schema.brandRule.id, ruleId)).returning();
  if (!removed) throw new ActionError("rule_not_found");
  await invalidateBrandKits();
  return removed;
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────

/** The owner every file of a kit is stored under: directory tier, since the public may have it. */
const ownerOf = (kit: BrandKitRow) => ({ ownerType: BRAND_OWNER_TYPE, ownerId: kit.id, entityId: kit.entityId, tier: "public_internal" as const });

/** The section a file is offered in must belong to the same kit. */
async function checkSection(tx: Executor, kitId: string, sectionId: string | null): Promise<void> {
  if (!sectionId) return;
  const [section] = await tx.select({ brandId: schema.brandSection.brandId }).from(schema.brandSection).where(eq(schema.brandSection.id, sectionId)).limit(1);
  if (section?.brandId !== kitId) throw new ActionError("section_not_found");
}

/** Step 1 of adding a file: where the browser may PUT it. */
export async function beginBrandAssetUpload(kit: BrandKitRow, file: { fileName: string; sizeBytes: number }, actor: Actor) {
  const [{ files }] = await db().select({ files: sql<number>`count(*)::int` }).from(schema.brandAsset).where(eq(schema.brandAsset.brandId, kit.id));
  if (files >= MAX_BRAND_ASSETS) throw new ActionError("too_many_files");
  return beginUpload(ownerOf(kit), file, actor);
}

export type BrandAssetDetails = { title: string; kind: BrandAssetKind; isPublic: boolean; sectionId: string | null };

/** Step 2: the bytes are checked, and the file joins the kit at the end of its kind. */
export async function completeBrandAssetUpload(kit: BrandKitRow, fileId: string, details: BrandAssetDetails, actor: Actor): Promise<BrandAssetRow> {
  const file = await completeUpload(fileId, actor);
  if (file.ownerType !== BRAND_OWNER_TYPE || file.ownerId !== kit.id) throw new ActionError("file_not_found");
  const [asset] = await db().transaction(async (tx) => {
    await checkSection(tx, kit.id, details.sectionId);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${schema.brandAsset.sortOrder}), 0)::int + 10` })
      .from(schema.brandAsset)
      .where(and(eq(schema.brandAsset.brandId, kit.id), eq(schema.brandAsset.kind, details.kind)));
    return tx.insert(schema.brandAsset).values({ brandId: kit.id, fileId: file.id, ...details, sortOrder: next, createdByPersonId: actor.personId }).returning();
  });
  await invalidateBrandKits();
  return asset;
}

export async function findBrandAsset(assetId: string): Promise<BrandAssetView | undefined> {
  return (await allBrandAssets()).find((asset) => asset.id === assetId);
}

export async function updateBrandAsset(assetId: string, input: BrandAssetDetails & { sortOrder: number }): Promise<{ before: BrandAssetRow; after: BrandAssetRow }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.brandAsset).where(eq(schema.brandAsset.id, assetId)).limit(1);
    if (!before) throw new ActionError("file_not_found");
    await checkSection(tx, before.brandId, input.sectionId);
    const [after] = await tx.update(schema.brandAsset).set(input).where(eq(schema.brandAsset.id, assetId)).returning();
    return { before, after };
  });
  await invalidateBrandKits();
  return result;
}

/** The file leaves the kit and the public page at once (a rule showing it loses its picture); its bytes go with the retention purge. */
export async function deleteBrandAsset(assetId: string): Promise<BrandAssetRow> {
  const [removed] = await db().delete(schema.brandAsset).where(eq(schema.brandAsset.id, assetId)).returning();
  if (!removed) throw new ActionError("file_not_found");
  await softDeleteFile(removed.fileId);
  await invalidateBrandKits();
  return removed;
}
