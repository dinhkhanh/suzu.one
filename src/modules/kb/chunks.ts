// Chunks and retrieval for the Phase 9 assistant (FR-KB-11; development plan: "embeddings for
// every page are generated from Phase 4 on").
//  - `rebuildChunks` runs inside `publishPage`: the chunks always describe the published version.
//    A passage that did not change keeps its vector.
//  - `embedPendingChunks` (the `kb-embeddings` job, and right after a publish while the local fake
//    is the driver) fills in vectors, and re-embeds everything when the model changes.
//  - `retrieveKbChunks` is THE RETRIEVAL API: permission-filtered and ranked in SQL, by pgvector's
//    cosine distance (`<=>`) to the question.
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { pagePublishedVisibleSql } from "./access-sql";
import { embeddingDriver, embedTexts } from "./embeddings";
import { CHUNK_FORMAT, chunkDoc, chunkEmbeddingText } from "./engine/chunk";
import type { Doc } from "@/modules/platform/rich-text/engine/doc";
import { searchTokens } from "./engine/search";
import type { KbViewer } from "./policy";

const { kbPage, kbPageChunk, kbSpace } = schema;

const hashOf = (headingPath: string, content: string) => createHash("sha256").update(`${headingPath}\n${content}`).digest("hex");

/** Replaces a page's chunks with those of the version just published. Same transaction as the publish. */
export async function rebuildChunks(tx: Tx, page: { id: string }, version: { id: string; title: string; content: unknown }): Promise<{ chunks: number; reused: number }> {
  const before = await tx.select({ contentHash: kbPageChunk.contentHash, embeddingVector: kbPageChunk.embeddingVector, embeddingModel: kbPageChunk.embeddingModel, embeddedAt: kbPageChunk.embeddedAt }).from(kbPageChunk).where(eq(kbPageChunk.pageId, page.id));
  const known = new Map(before.filter((row) => row.embeddingVector).map((row) => [row.contentHash, row]));
  await tx.delete(kbPageChunk).where(eq(kbPageChunk.pageId, page.id));
  const chunks = chunkDoc(version.content as Doc, version.title);
  let reused = 0;
  if (chunks.length) {
    await tx.insert(kbPageChunk).values(
      chunks.map((chunk) => {
        const contentHash = hashOf(chunk.headingPath, chunk.content);
        const kept = known.get(contentHash);
        if (kept) reused++;
        return { pageId: page.id, versionId: version.id, chunkIndex: chunk.index, headingPath: chunk.headingPath, anchor: chunk.anchor, format: CHUNK_FORMAT, content: chunk.content, contentHash, tokenEstimate: chunk.tokenEstimate, embeddingVector: kept?.embeddingVector ?? null, embeddingModel: kept?.embeddingModel ?? null, embeddedAt: kept?.embeddedAt ?? null };
      }),
    );
  }
  return { chunks: chunks.length, reused };
}

/** A page readers no longer see has nothing for the assistant to quote. */
export async function removeChunks(tx: Tx, pageId: string): Promise<void> {
  await tx.delete(kbPageChunk).where(eq(kbPageChunk.pageId, pageId));
}

/** pgvector's text form of a vector. */
const vectorLiteral = (vector: readonly number[]) => `[${vector.join(",")}]`;

/** Embeds chunks that have no vector, or one from another model. Safe to run again: it only ever fills in what is missing. */
export async function embedPendingChunks(limit = 2000): Promise<{ model: string; embedded: number; remaining: number }> {
  const driver = embeddingDriver();
  const pending = await db()
    .select({ id: kbPageChunk.id, headingPath: kbPageChunk.headingPath, content: kbPageChunk.content })
    .from(kbPageChunk)
    .where(or(isNull(kbPageChunk.embeddingVector), isNull(kbPageChunk.embeddingModel), ne(kbPageChunk.embeddingModel, driver.model)))
    .orderBy(asc(kbPageChunk.createdAt))
    .limit(limit + 1);
  const batch = pending.slice(0, limit);
  let embedded = 0;
  for (let at = 0; at < batch.length; at += driver.batchSize) {
    const rows = batch.slice(at, at + driver.batchSize);
    const { model, vectors } = await embedTexts(rows.map(chunkEmbeddingText), "document");
    // One statement per batch, not one per chunk.
    const values = sql.join(
      rows.map((row, index) => sql`(${row.id}::uuid, ${vectorLiteral(vectors[index])}::extensions.vector)`),
      sql`, `,
    );
    await db().execute(sql`update ${kbPageChunk} set embedding_vector = v.vector, embedding_model = ${model}, embedded_at = now() from (values ${values}) as v(id, vector) where ${kbPageChunk.id} = v.id`);
    embedded += rows.length;
  }
  return { model: driver.model, embedded, remaining: pending.length - batch.length };
}

/** Pages published before chunking existed, whose chunks were lost, or whose chunks are in an older `CHUNK_FORMAT`: cut them now. Used by the job. */
export async function chunkUnchunkedPages(limit = 500): Promise<{ pages: number }> {
  const rows = await db()
    .select({ id: kbPage.id, versionId: schema.kbPageVersion.id, title: schema.kbPageVersion.title, content: schema.kbPageVersion.content })
    .from(kbPage)
    .innerJoin(schema.kbPageVersion, eq(schema.kbPageVersion.id, kbPage.publishedVersionId))
    .where(
      and(
        isNull(kbPage.deletedAt),
        ne(kbPage.status, "archived"),
        // No chunks of the published version yet — or chunks written in an older format.
        sql`(not exists (select 1 from ${kbPageChunk} where ${kbPageChunk.pageId} = ${kbPage.id} and ${kbPageChunk.versionId} = ${kbPage.publishedVersionId}) or exists (select 1 from ${kbPageChunk} where ${kbPageChunk.pageId} = ${kbPage.id} and ${kbPageChunk.format} < ${CHUNK_FORMAT}))`,
      ),
    )
    .limit(limit);
  for (const row of rows) await db().transaction((tx) => rebuildChunks(tx, { id: row.id }, { id: row.versionId, title: row.title, content: row.content }));
  return { pages: rows.length };
}

export type RetrievedChunk = { chunkId: string; pageId: string; pageTitle: string; spaceKey: string; spaceName: string; versionId: string; chunkIndex: number; headingPath: string; anchor: string | null; content: string; /** Cosine similarity to the question, -1..1; 0 when the chunk has no vector of the current model. */ score: number };

/**
 * THE RETRIEVAL API for Phase 9. The passages of pages the viewer may read — the permission
 * filter is in the WHERE clause, so a passage they may not see is never considered — closest to
 * the question first, by pgvector's cosine distance, in one exact scan (no approximate index; see
 * the schema). Passages without a vector of the current model (just published, or waiting for a
 * re-embed after a model change) come after, score 0, those sharing a word with the question first.
 */
export async function retrieveKbChunks(viewer: KbViewer, input: { query: string; limit?: number; spaceId?: string | null }): Promise<RetrievedChunk[]> {
  // Up to 200 (Phase 9): the assistant asks for a wide set and ranks it again in `modules/ai`
  // against the question's words, because a vector score and a lexical score fail in different
  // places. Screens still ask for a handful.
  const limit = Math.max(1, Math.min(input.limit ?? 8, 200));
  const tokens = searchTokens(input.query);
  if (tokens.length === 0) return [];
  const { model, vectors } = await embedTexts([input.query], "query");
  const distance = sql<number>`(${kbPageChunk.embeddingVector} OPERATOR(extensions.<=>) ${vectorLiteral(vectors[0])}::extensions.vector)::float8`;
  const select = { chunkId: kbPageChunk.id, pageId: kbPage.id, pageTitle: kbPage.publishedTitle, spaceKey: kbSpace.key, spaceName: kbSpace.name, versionId: kbPageChunk.versionId, chunkIndex: kbPageChunk.chunkIndex, headingPath: kbPageChunk.headingPath, anchor: kbPageChunk.anchor, content: kbPageChunk.content };
  const visible = and(pagePublishedVisibleSql(viewer), eq(kbPageChunk.versionId, kbPage.publishedVersionId), input.spaceId ? eq(kbPage.spaceId, input.spaceId) : undefined);

  const ranked = await db()
    .select({ ...select, distance })
    .from(kbPageChunk)
    .innerJoin(kbPage, eq(kbPage.id, kbPageChunk.pageId))
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .where(and(visible, eq(kbPageChunk.embeddingModel, model), isNotNull(kbPageChunk.embeddingVector)))
    .orderBy(distance, asc(kbPage.id), asc(kbPageChunk.chunkIndex))
    .limit(limit);
  // Cosine similarity, -1..1. A zero vector (a passage of no words) has no direction: NaN, so 0.
  const results: RetrievedChunk[] = ranked.map(({ distance: d, pageTitle, ...row }) => ({ ...row, pageTitle: pageTitle ?? "", score: Number.isFinite(Number(d)) ? 1 - Number(d) : 0 }));
  if (results.length < limit) {
    const anyWord = sql`to_tsquery('simple', ${tokens.join(" | ")})`;
    const waiting = await db()
      .select(select)
      .from(kbPageChunk)
      .innerJoin(kbPage, eq(kbPage.id, kbPageChunk.pageId))
      .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
      .where(and(visible, or(isNull(kbPageChunk.embeddingVector), isNull(kbPageChunk.embeddingModel), ne(kbPageChunk.embeddingModel, model))))
      .orderBy(sql`(${kbPage.searchVector} @@ ${anyWord}) desc`, asc(kbPage.id), asc(kbPageChunk.chunkIndex))
      .limit(limit - results.length);
    results.push(...waiting.map(({ pageTitle, ...row }) => ({ ...row, pageTitle: pageTitle ?? "", score: 0 })));
  }
  return results;
}

/** How much of the knowledge base is ready for the assistant. */
export async function chunkStats(): Promise<{ chunks: number; embedded: number; pages: number; model: string }> {
  const model = embeddingDriver().model;
  const [row] = await db().select({ chunks: sql<number>`count(*)::int`, embedded: sql<number>`count(*) filter (where ${kbPageChunk.embeddingModel} = ${model} and ${kbPageChunk.embeddingVector} is not null)::int`, pages: sql<number>`count(distinct ${kbPageChunk.pageId})::int` }).from(kbPageChunk);
  return { chunks: row?.chunks ?? 0, embedded: row?.embedded ?? 0, pages: row?.pages ?? 0, model };
}
