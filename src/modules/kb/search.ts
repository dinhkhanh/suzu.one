// Search, recent and popular pages (FR-KB-06). Postgres full-text search over the accent-stripped
// text of each page's PUBLISHED version (`kb_page.search_vector`, 'simple' configuration, GIN
// index), so "nghi phep" finds "Nghỉ phép năm". Every query carries the viewer's permission
// filter in its WHERE clause: nothing is loaded and then thrown away.
//
// Decision: accent-insensitivity comes from storing `toSearchKey()` text — the convention
// `person.search_name` already follows — not from the `unaccent` extension: `unaccent()` is not
// immutable (it cannot back a generated column or an index without a wrapper function) and lives
// in a different schema on Supabase than on plain Postgres and PGlite. Same result, no extension.
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, type SQL, sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";
import { pagePublishedVisibleSql } from "./access-sql";
import { snippetOf, toTsQuery } from "./engine/search";
import type { KbViewer } from "./policy";

const { kbPage, kbPageVersion, kbPageView, kbSpace } = schema;

export type KbSearchHit = { pageId: string; title: string; spaceId: string; spaceKey: string; spaceName: string; /** Titles from the top of the space down to the page's parent. */ path: string[]; snippet: string; rank: number; publishedAt: Date | null };
export type KbSearchResult = { hits: KbSearchHit[]; total: number };

/**
 * Titles of the pages above each hit, only as far as the viewer may see them: one recursive
 * query walks up from every hit at once, at most 12 levels, and stops at a parent the viewer
 * may not open.
 */
async function pathsOf(viewer: KbViewer, pages: readonly { pageId: string; parentId: string | null }[]): Promise<Map<string, string[]>> {
  const paths = new Map<string, string[]>(pages.map((page) => [page.pageId, []]));
  const starts = pages.filter((page) => page.parentId);
  if (!starts.length) return paths;
  const visible = pagePublishedVisibleSql(viewer);
  const result = await db().execute(sql`
    with recursive hit(hit_id, parent_id) as (values ${sql.join(
      starts.map((page) => sql`(${page.pageId}::uuid, ${page.parentId}::uuid)`),
      sql`, `,
    )}),
    ancestor(hit_id, parent_id, title, depth) as (
      select hit.hit_id, ${kbPage.parentId}, ${kbPage.publishedTitle}, 1
      from hit join ${kbPage} on ${kbPage.id} = hit.parent_id join ${kbSpace} on ${kbSpace.id} = ${kbPage.spaceId}
      where ${visible}
      union all
      select ancestor.hit_id, ${kbPage.parentId}, ${kbPage.publishedTitle}, ancestor.depth + 1
      from ancestor join ${kbPage} on ${kbPage.id} = ancestor.parent_id join ${kbSpace} on ${kbSpace.id} = ${kbPage.spaceId}
      where ancestor.depth < 12 and ${visible}
    )
    select hit_id, title, depth from ancestor order by hit_id, depth desc`);
  for (const row of rowsOf<{ hit_id: string; title: string | null; depth: number }>(result)) paths.get(row.hit_id)?.push(row.title ?? "");
  return paths;
}

/**
 * THE SEARCH API (also what Phase 9's retrieval starts from). Permission-filtered in SQL, ranked
 * with the title weighing more than the body, newest first among equals.
 */
export async function searchKb(viewer: KbViewer, input: { query: string; spaceId?: string | null; limit?: number; offset?: number }): Promise<KbSearchResult> {
  const tsQuery = toTsQuery(input.query);
  if (!tsQuery) return { hits: [], total: 0 };
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const query = sql`to_tsquery('simple', ${tsQuery})`;
  const where = and(sql`${kbPage.searchVector} @@ ${query}`, pagePublishedVisibleSql(viewer), input.spaceId ? eq(kbPage.spaceId, input.spaceId) : undefined) as SQL;
  const rank = sql<number>`ts_rank_cd('{0.05, 0.1, 0.3, 1.0}', ${kbPage.searchVector}, ${query})`;
  const [rows, [counted]] = await Promise.all([
    db()
      .select({ pageId: kbPage.id, parentId: kbPage.parentId, title: kbPage.publishedTitle, spaceId: kbSpace.id, spaceKey: kbSpace.key, spaceName: kbSpace.name, text: kbPageVersion.contentText, publishedAt: kbPage.publishedAt, rank })
      .from(kbPage)
      .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
      .innerJoin(kbPageVersion, eq(kbPageVersion.id, kbPage.publishedVersionId))
      .where(where)
      .orderBy(desc(rank), desc(kbPage.publishedAt))
      .limit(limit)
      .offset(Math.max(0, input.offset ?? 0)),
    db().select({ n: sql<number>`count(*)::int` }).from(kbPage).innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId)).where(where),
  ]);
  const paths = await pathsOf(viewer, rows);
  return { total: counted?.n ?? 0, hits: rows.map((row) => ({ pageId: row.pageId, title: row.title ?? "", spaceId: row.spaceId, spaceKey: row.spaceKey, spaceName: row.spaceName, path: paths.get(row.pageId) ?? [], snippet: snippetOf(row.text, input.query).text, rank: Number(row.rank), publishedAt: row.publishedAt })) };
}

export type KbPageCard = { pageId: string; title: string; spaceKey: string; spaceName: string; at: Date | null; views?: number };

const card = { pageId: kbPage.id, title: kbPage.publishedTitle, spaceKey: kbSpace.key, spaceName: kbSpace.name };
const toCard = <Row extends { pageId: string; title: string | null; spaceKey: string; spaceName: string }>(row: Row, at: Date | null, views?: number): KbPageCard => ({ pageId: row.pageId, title: row.title ?? "", spaceKey: row.spaceKey, spaceName: row.spaceName, at, ...(views === undefined ? {} : { views }) });

/** What the viewer opened last — still filtered: a page they can no longer see drops out. */
export async function listRecentlyViewed(viewer: KbViewer, limit = 6): Promise<KbPageCard[]> {
  const lastViewed = sql<Date>`max(${kbPageView.viewedAt})`;
  const rows = await db()
    .select({ ...card, at: lastViewed })
    .from(kbPageView)
    .innerJoin(kbPage, eq(kbPage.id, kbPageView.pageId))
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .where(and(eq(kbPageView.personId, viewer.personId), pagePublishedVisibleSql(viewer)))
    .groupBy(kbPage.id, kbSpace.id)
    .orderBy(desc(lastViewed))
    .limit(limit);
  return rows.map((row) => toCard(row, row.at ? new Date(row.at) : null));
}

// Popularity is the same for everyone: the 30-day counts are aggregated once per day and hour
// into the shared cache — page ids and counts only, never titles — and each request keeps the
// pages its viewer may open.
const POPULAR_TOP = 50;
const POPULAR_TTL = 60 * 60;

async function popularPageCounts(today: IsoDate): Promise<{ pageId: string; views: number }[]> {
  const views = sql<number>`count(*)::int`;
  return cached(`kb:popular:${today}`, POPULAR_TTL, () =>
    db()
      .select({ pageId: kbPage.id, views })
      .from(kbPageView)
      .innerJoin(kbPage, eq(kbPage.id, kbPageView.pageId))
      .where(and(gte(kbPageView.viewedOn, addDays(today, -30)), isNull(kbPage.deletedAt), isNotNull(kbPage.publishedVersionId), ne(kbPage.status, "archived")))
      .groupBy(kbPage.id)
      .orderBy(desc(views), desc(kbPage.publishedAt))
      .limit(POPULAR_TOP),
  );
}

/** The most-read pages of the last 30 days (one view per reader and day), among those the viewer may open. */
export async function listPopularPages(viewer: KbViewer, limit = 6, today: IsoDate = todayInVietnam()): Promise<KbPageCard[]> {
  const counts = await popularPageCounts(today);
  if (!counts.length) return [];
  const viewsOf = new Map(counts.map((row) => [row.pageId, row.views]));
  const rows = await db()
    .select({ ...card, at: kbPage.publishedAt })
    .from(kbPage)
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .where(and(inArray(kbPage.id, [...viewsOf.keys()]), pagePublishedVisibleSql(viewer)));
  // A reader who may open only a few of the group's top pages still gets a full list: the exact
  // per-reader ranking, as before the cache.
  if (rows.length < limit && counts.length >= POPULAR_TOP) return popularPagesFor(viewer, limit, today);
  return rows
    .map((row) => toCard(row, row.at, viewsOf.get(row.pageId) ?? 0))
    // As Postgres orders `published_at desc`: a missing date first.
    .sort((a, b) => b.views! - a.views! || (b.at?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.at?.getTime() ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit);
}

async function popularPagesFor(viewer: KbViewer, limit: number, today: IsoDate): Promise<KbPageCard[]> {
  const views = sql<number>`count(*)::int`;
  const rows = await db()
    .select({ ...card, at: kbPage.publishedAt, views })
    .from(kbPageView)
    .innerJoin(kbPage, eq(kbPage.id, kbPageView.pageId))
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .where(and(gte(kbPageView.viewedOn, addDays(today, -30)), pagePublishedVisibleSql(viewer)))
    .groupBy(kbPage.id, kbSpace.id)
    .orderBy(desc(views), desc(kbPage.publishedAt))
    .limit(limit);
  return rows.map((row) => toCard(row, row.at, row.views));
}

/** New and newly revised pages, newest first — for the KB front page and the home feed ("new pages"). `since` narrows it to a window. */
export async function listRecentlyPublished(viewer: KbViewer, options: { limit?: number; since?: Date; firstVersionsOnly?: boolean } = {}): Promise<KbPageCard[]> {
  const rows = await db()
    .select({ ...card, at: kbPage.publishedAt })
    .from(kbPage)
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .innerJoin(kbPageVersion, eq(kbPageVersion.id, kbPage.publishedVersionId))
    .where(and(pagePublishedVisibleSql(viewer), options.since ? gte(kbPage.publishedAt, options.since) : undefined, options.firstVersionsOnly ? eq(kbPageVersion.versionNo, 1) : undefined))
    .orderBy(desc(kbPage.publishedAt))
    .limit(Math.max(1, Math.min(options.limit ?? 6, 50)));
  return rows.map((row) => toCard(row, row.at));
}
