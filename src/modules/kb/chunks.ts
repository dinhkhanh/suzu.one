// Chunks and retrieval for the Phase 9 assistant (FR-KB-11; development plan: "embeddings for
// every page are generated from Phase 4 on").
//  - `rebuildChunks` runs inside `publishPage`: the chunks always describe the published version.
//    A passage that did not change keeps its vector.
//  - `embedPublishedPage` runs right after a publish commits (once the response is out, on the
//    real driver): the page's own new passages get their vectors there and then, so the assistant
//    can find a page the day it is published. A page too long for that waits for the job.
//  - `embedPendingChunks` (the `kb-embeddings` job, twice a day) fills in whatever is still
//    missing, and re-embeds everything when the model changes.
//  - `retrieveKbChunks` is THE RETRIEVAL API: permission-filtered and ranked in SQL, by pgvector's
//    cosine distance (`<=>`) to the question.
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { reportError } from "@/lib/observability/report";
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
  const before = await tx
    .select({ contentHash: kbPageChunk.contentHash, embeddingVector: kbPageChunk.embeddingVector, embeddingModel: kbPageChunk.embeddingModel, embeddedAt: kbPageChunk.embeddedAt })
    .from(kbPageChunk)
    .where(eq(kbPageChunk.pageId, page.id));
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
        return {
          pageId: page.id,
          versionId: version.id,
          chunkIndex: chunk.index,
          headingPath: chunk.headingPath,
          anchor: chunk.anchor,
          format: CHUNK_FORMAT,
          content: chunk.content,
          contentHash,
          tokenEstimate: chunk.tokenEstimate,
          embeddingVector: kept?.embeddingVector ?? null,
          embeddingModel: kept?.embeddingModel ?? null,
          embeddedAt: kept?.embeddedAt ?? null,
        };
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

type PendingChunk = { id: string; headingPath: string; content: string };

/** A chunk with no vector, or one from another model than `model`. */
const needsEmbedding = (model: string) => or(isNull(kbPageChunk.embeddingVector), isNull(kbPageChunk.embeddingModel), ne(kbPageChunk.embeddingModel, model));

/** Embeds these chunks and stores the vectors: one embeddings call and one UPDATE per batch of the driver's size. */
async function embedChunks(chunks: readonly PendingChunk[], batchSize: number): Promise<number> {
  let embedded = 0;
  for (let at = 0; at < chunks.length; at += batchSize) {
    const rows = chunks.slice(at, at + batchSize);
    const { model, vectors } = await embedTexts(rows.map(chunkEmbeddingText), "document");
    // One statement per batch, not one per chunk.
    const values = sql.join(
      rows.map((row, index) => sql`(${row.id}::uuid, ${vectorLiteral(vectors[index])}::extensions.vector)`),
      sql`, `,
    );
    await db().execute(sql`update ${kbPageChunk} set embedding_vector = v.vector, embedding_model = ${model}, embedded_at = now() from (values ${values}) as v(id, vector) where ${kbPageChunk.id} = v.id`);
    embedded += rows.length;
  }
  return embedded;
}

/** Embeds chunks that have no vector, or one from another model. Safe to run again: it only ever fills in what is missing. */
export async function embedPendingChunks(limit = 2000): Promise<{ model: string; embedded: number; remaining: number }> {
  const driver = embeddingDriver();
  const pending = await db()
    .select({ id: kbPageChunk.id, headingPath: kbPageChunk.headingPath, content: kbPageChunk.content })
    .from(kbPageChunk)
    .where(needsEmbedding(driver.model))
    .orderBy(asc(kbPageChunk.createdAt))
    .limit(limit + 1);
  const batch = pending.slice(0, limit);
  const embedded = await embedChunks(batch, driver.batchSize);
  return { model: driver.model, embedded, remaining: pending.length - batch.length };
}

/**
 * How many new passages a publish embeds by itself. Two calls of the real driver (fifty texts
 * each) — a few seconds after the response, well inside the function's budget. A page with more
 * new passages than this is a manual, and waits for the job like before.
 */
export const PUBLISH_EMBED_MAX_CHUNKS = 100;

/**
 * Right after a publish: the vectors of this page's own passages that have none yet (a passage
 * the edit did not touch kept its vector in `rebuildChunks`). Without this a page published at
 * nine is invisible to the assistant until the next job — retrieval ranks the embedded passages
 * first and only looks at the rest when there are few of them.
 *
 * **Never throws.** The publish has committed; an embeddings outage must not turn it into an
 * error, and loses nothing — the passages stay pending and the job embeds them.
 */
export async function embedPublishedPage(pageId: string, maxChunks = PUBLISH_EMBED_MAX_CHUNKS): Promise<{ embedded: number; /** True when the page was left to the job: too many new passages, or the call failed. */ deferred: boolean }> {
  try {
    const driver = embeddingDriver();
    const pending = await db()
      .select({ id: kbPageChunk.id, headingPath: kbPageChunk.headingPath, content: kbPageChunk.content })
      .from(kbPageChunk)
      .where(and(eq(kbPageChunk.pageId, pageId), needsEmbedding(driver.model)))
      .orderBy(asc(kbPageChunk.chunkIndex))
      .limit(maxChunks + 1);
    if (pending.length > maxChunks) return { embedded: 0, deferred: true };
    return { embedded: await embedChunks(pending, driver.batchSize), deferred: false };
  } catch (error) {
    await reportError(error, { event: "kb.embed_after_publish.failed", source: "kb" });
    return { embedded: 0, deferred: true };
  }
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

/** A question is a sentence or two; whatever is pasted beyond this is not sent to be embedded. */
const QUESTION_EMBED_MAX = 1000;

export type RetrievedChunk = {
  chunkId: string;
  pageId: string;
  pageTitle: string;
  spaceKey: string;
  spaceName: string;
  versionId: string;
  chunkIndex: number;
  headingPath: string;
  anchor: string | null;
  content: string;
  /** Cosine similarity to the question, -1..1; 0 when the chunk has no vector of the current model. */ score: number;
};

/**
 * THE RETRIEVAL API for Phase 9. The passages of pages the viewer may read — the permission
 * filter is in the WHERE clause, so a passage they may not see is never considered — closest to
 * the question first, by pgvector's cosine distance, in one exact scan (no approximate index; see
 * the schema). Passages without a vector of the current model (just published, or waiting for a
 * re-embed after a model change) come after, score 0, those sharing a word with the question first.
 *
 * `query` is what the WORDS are matched on. `question`, when given, is what a real embeddings
 * model is asked about: the sentence as the person typed it, accents and all — passages are
 * embedded as accented prose, and a bag of accent-stripped keywords is a different text to a model
 * that reads meaning. The local fake hashes accent-stripped words and nothing else, so for it the
 * keyword form *is* the better text and stays what it embeds.
 */
export async function retrieveKbChunks(viewer: KbViewer, input: { query: string; question?: string; limit?: number; spaceId?: string | null }): Promise<RetrievedChunk[]> {
  // Up to 200 (Phase 9): the assistant asks for a wide set and ranks it again in `modules/ai`
  // against the question's words, because a vector score and a lexical score fail in different
  // places. Screens still ask for a handful.
  const limit = Math.max(1, Math.min(input.limit ?? 8, 200));
  const tokens = searchTokens(input.query);
  if (tokens.length === 0) return [];
  const asked = input.question?.trim().slice(0, QUESTION_EMBED_MAX);
  const { model, vectors } = await embedTexts([asked && !embeddingDriver().isFake ? asked : input.query], "query");
  const distance = sql<number>`(${kbPageChunk.embeddingVector} OPERATOR(extensions.<=>) ${vectorLiteral(vectors[0])}::extensions.vector)::float8`;
  const select = {
    chunkId: kbPageChunk.id,
    pageId: kbPage.id,
    pageTitle: kbPage.publishedTitle,
    spaceKey: kbSpace.key,
    spaceName: kbSpace.name,
    versionId: kbPageChunk.versionId,
    chunkIndex: kbPageChunk.chunkIndex,
    headingPath: kbPageChunk.headingPath,
    anchor: kbPageChunk.anchor,
    content: kbPageChunk.content,
  };
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
  const [row] = await db()
    .select({
      chunks: sql<number>`count(*)::int`,
      embedded: sql<number>`count(*) filter (where ${kbPageChunk.embeddingModel} = ${model} and ${kbPageChunk.embeddingVector} is not null)::int`,
      pages: sql<number>`count(distinct ${kbPageChunk.pageId})::int`,
    })
    .from(kbPageChunk);
  return { chunks: row?.chunks ?? 0, embedded: row?.embedded ?? 0, pages: row?.pages ?? 0, model };
}
