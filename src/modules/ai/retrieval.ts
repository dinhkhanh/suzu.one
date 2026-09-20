// Retrieval for the assistant. THE WHOLE PERMISSION STORY IS ONE LINE: it calls the knowledge
// base's own `retrieveKbChunks(viewer, …)`, whose WHERE clause carries `pagePublishedVisibleSql`.
// A passage the asker could not open by going to /kb is never loaded, so it can never be ranked,
// quoted, cited, sent to a model, or counted in the evaluation. There is no second path, no
// "system" viewer and no post-filter: filtering after generation is how assistants leak.
//
// What this module adds on top is ranking only (`engine/answer.ts`), and ranking cannot widen a
// set. The red-team tests in `ai.test.ts` assert exactly that from the outside.
import "server-only";
import { type KbViewer, retrieveKbChunks } from "@/modules/kb/service";
import type { Passage } from "./engine/answer";
import { rankPassages, type RankedPassage } from "./engine/answer";
import { retrievalQuery } from "./engine/question";

/** How many permission-filtered passages are pulled back for re-ranking. */
export const CANDIDATES = 120;

export async function retrievePassages(viewer: KbViewer, question: string, options: { spaceId?: string | null } = {}): Promise<RankedPassage[]> {
  const query = retrievalQuery(question);
  if (!query) return [];
  const chunks = await retrieveKbChunks(viewer, { query, limit: CANDIDATES, spaceId: options.spaceId ?? null });
  const passages: Passage[] = chunks.map((chunk) => ({ chunkId: chunk.chunkId, pageId: chunk.pageId, pageTitle: chunk.pageTitle, spaceKey: chunk.spaceKey, spaceName: chunk.spaceName, headingPath: chunk.headingPath, content: chunk.content, vectorScore: chunk.score }));
  // The question, not the stripped query, decides the lexical score: "bao nhiêu ngày" tells us the
  // asker wants a number even though those words are not search terms.
  return rankPassages(question, passages);
}
