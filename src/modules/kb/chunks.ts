// Chunks and retrieval for the Phase 9 assistant (FR-KB-11; development plan: "embeddings for
// every page are generated from Phase 4 on").
//  - `rebuildChunks` runs inside `publishPage`: the chunks always describe the published version.
//    A passage that did not change keeps its vector.
//  - `embedPendingChunks` (the `kb-embeddings` job, and right after a publish while the local fake
//    is the driver) fills in vectors, and re-embeds everything when the model changes.
//  - `retrieveKbChunks` is THE RETRIEVAL API: permission-filtered in SQL, ranked in the
//    application. It is the seam to swap for a pgvector `<=>` query once Phase 9 picks a model.
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { pagePublishedVisibleSql } from "./access-sql";
import { embeddingDriver, embedTexts } from "./embeddings";
import { chunkDoc, chunkEmbeddingText } from "./engine/chunk";
import type { Doc } from "./engine/doc";
import { cosine } from "./engine/fake-embedding";
import { searchTokens } from "./engine/search";
import type { KbViewer } from "./policy";

const { kbPage, kbPageChunk, kbSpace } = schema;

const hashOf = (headingPath: string, content: string) => createHash("sha256").update(`${headingPath}\n${content}`).digest("hex");

/** Replaces a page's chunks with those of the version just published. Same transaction as the publish. */
export async function rebuildChunks(tx: Tx, page: { id: string }, version: { id: string; title: string; content: unknown }): Promise<{ chunks: number; reused: number }> {
  const before = await tx.select({ contentHash: kbPageChunk.contentHash, embedding: kbPageChunk.embedding, embeddingModel: kbPageChunk.embeddingModel, embeddedAt: kbPageChunk.embeddedAt }).from(kbPageChunk).where(eq(kbPageChunk.pageId, page.id));
  const known = new Map(before.filter((row) => row.embedding).map((row) => [row.contentHash, row]));
  await tx.delete(kbPageChunk).where(eq(kbPageChunk.pageId, page.id));
  const chunks = chunkDoc(version.content as Doc, version.title);
  let reused = 0;
  if (chunks.length) {
    await tx.insert(kbPageChunk).values(
      chunks.map((chunk) => {
        const contentHash = hashOf(chunk.headingPath, chunk.content);
        const kept = known.get(contentHash);
        if (kept) reused++;
        return { pageId: page.id, versionId: version.id, chunkIndex: chunk.index, headingPath: chunk.headingPath, content: chunk.content, contentHash, tokenEstimate: chunk.tokenEstimate, embedding: kept?.embedding ?? null, embeddingModel: kept?.embeddingModel ?? null, embeddedAt: kept?.embeddedAt ?? null };
      }),
    );
  }
  return { chunks: chunks.length, reused };
}

/** A page readers no longer see has nothing for the assistant to quote. */
export async function removeChunks(tx: Tx, pageId: string): Promise<void> {
  await tx.delete(kbPageChunk).where(eq(kbPageChunk.pageId, pageId));
}

/** Embeds chunks that have no vector, or one from another model. Safe to run again: it only ever fills in what is missing. */
export async function embedPendingChunks(limit = 2000): Promise<{ model: string; embedded: number; remaining: number }> {
  const driver = embeddingDriver();
  const pending = await db()
    .select({ id: kbPageChunk.id, headingPath: kbPageChunk.headingPath, content: kbPageChunk.content })
    .from(kbPageChunk)
    .where(or(isNull(kbPageChunk.embedding), isNull(kbPageChunk.embeddingModel), ne(kbPageChunk.embeddingModel, driver.model)))
    .orderBy(asc(kbPageChunk.createdAt))
    .limit(limit + 1);
  const batch = pending.slice(0, limit);
  let embedded = 0;
  for (let at = 0; at < batch.length; at += driver.batchSize) {
    const rows = batch.slice(at, at + driver.batchSize);
    const { model, vectors } = await embedTexts(rows.map(chunkEmbeddingText), "document");
    await db().transaction(async (tx) => {
      for (const [index, row] of rows.entries()) await tx.update(kbPageChunk).set({ embedding: vectors[index], embeddingModel: model, embeddedAt: new Date() }).where(eq(kbPageChunk.id, row.id));
    });
    embedded += rows.length;
  }
  return { model: driver.model, embedded, remaining: pending.length - batch.length };
}

/** Pages published before chunking existed (or whose chunks were lost): cut them now. Used by the job. */
export async function chunkUnchunkedPages(limit = 500): Promise<{ pages: number }> {
  const rows = await db()
    .select({ id: kbPage.id, versionId: schema.kbPageVersion.id, title: schema.kbPageVersion.title, content: schema.kbPageVersion.content })
    .from(kbPage)
    .innerJoin(schema.kbPageVersion, eq(schema.kbPageVersion.id, kbPage.publishedVersionId))
    .where(and(isNull(kbPage.deletedAt), ne(kbPage.status, "archived"), sql`not exists (select 1 from ${kbPageChunk} where ${kbPageChunk.pageId} = ${kbPage.id} and ${kbPageChunk.versionId} = ${kbPage.publishedVersionId})`))
    .limit(limit);
  for (const row of rows) await db().transaction((tx) => rebuildChunks(tx, { id: row.id }, { id: row.versionId, title: row.title, content: row.content }));
  return { pages: rows.length };
}

export type RetrievedChunk = { chunkId: string; pageId: string; pageTitle: string; spaceKey: string; spaceName: string; versionId: string; chunkIndex: number; headingPath: string; content: string; /** Cosine similarity to the question, -1..1; 0 when the chunk has no vector of the current model. */ score: number };

const CANDIDATE_CAP = 2000;

/**
 * THE RETRIEVAL API for Phase 9. The passages of pages the viewer may read — the permission
 * filter is in the WHERE clause, so a passage they may not see is never loaded — closest to the
 * question first. Candidates: chunks of pages whose text shares a word with the question; when
 * that is thin, every visible chunk up to a cap.
 */
export async function retrieveKbChunks(viewer: KbViewer, input: { query: string; limit?: number; spaceId?: string | null }): Promise<RetrievedChunk[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
  const tokens = searchTokens(input.query);
  if (tokens.length === 0) return [];
  const select = { chunkId: kbPageChunk.id, pageId: kbPage.id, pageTitle: kbPage.publishedTitle, spaceKey: kbSpace.key, spaceName: kbSpace.name, versionId: kbPageChunk.versionId, chunkIndex: kbPageChunk.chunkIndex, headingPath: kbPageChunk.headingPath, content: kbPageChunk.content, embedding: kbPageChunk.embedding, embeddingModel: kbPageChunk.embeddingModel };
  const visible = and(pagePublishedVisibleSql(viewer), eq(kbPageChunk.versionId, kbPage.publishedVersionId), input.spaceId ? eq(kbPage.spaceId, input.spaceId) : undefined);
  const from = () => db().select(select).from(kbPageChunk).innerJoin(kbPage, eq(kbPage.id, kbPageChunk.pageId)).innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId));
  // Any word of the question, not all of them: a question is not a keyword search.
  const anyWord = sql`to_tsquery('simple', ${tokens.join(" | ")})`;
  let candidates = await from().where(and(visible, sql`${kbPage.searchVector} @@ ${anyWord}`)).limit(CANDIDATE_CAP);
  if (candidates.length < limit * 3) {
    const seen = new Set(candidates.map((row) => row.chunkId));
    const more = await from().where(and(visible, seen.size ? notInArray(kbPageChunk.id, [...seen]) : undefined)).limit(CANDIDATE_CAP - candidates.length);
    candidates = [...candidates, ...more];
  }
  if (candidates.length === 0) return [];
  const { model, vectors } = await embedTexts([input.query], "query");
  const [question] = vectors;
  return candidates
    .map(({ embedding, embeddingModel, pageTitle, ...row }) => ({ ...row, pageTitle: pageTitle ?? "", score: embedding && embeddingModel === model ? cosine(question, embedding) : 0 }))
    .sort((a, b) => b.score - a.score || a.pageId.localeCompare(b.pageId) || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);
}

/** How much of the knowledge base is ready for the assistant. */
export async function chunkStats(): Promise<{ chunks: number; embedded: number; pages: number; model: string }> {
  const model = embeddingDriver().model;
  const [row] = await db().select({ chunks: sql<number>`count(*)::int`, embedded: sql<number>`count(*) filter (where ${kbPageChunk.embeddingModel} = ${model})::int`, pages: sql<number>`count(distinct ${kbPageChunk.pageId})::int` }).from(kbPageChunk);
  return { chunks: row?.chunks ?? 0, embedded: row?.embedded ?? 0, pages: row?.pages ?? 0, model };
}
