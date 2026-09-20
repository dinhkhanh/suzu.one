// Pages cut into passages for the Phase 9 assistant (FR-KB-11). Pure and deterministic: the same
// document always gives the same chunks, so a re-publish re-embeds only what changed.
//
// A heading starts a new chunk and names it (`headingPath`: page title › H1 › H2 › H3). Blocks
// under one heading are packed up to `maxChars`; a block longer than that (a long table — its
// rows are already one line each in the plain text) is split at line, then sentence, boundaries.
import { type Doc, type DocNode, docToPlainText } from "./doc";

export type Chunk = { index: number; headingPath: string; content: string; tokenEstimate: number };

export const CHUNK_MAX_CHARS = 1200;

const textOf = (node: DocNode): string => docToPlainText({ type: "doc", content: [node] });

/** Vietnamese runs to roughly three characters per token with today's tokenizers: an estimate for batching, not a bill. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let current = "";
  const push = (piece: string, joiner: string) => {
    if (current && current.length + joiner.length + piece.length > maxChars) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}${joiner}${piece}` : piece;
  };
  for (const line of text.split("\n")) {
    if (line.length <= maxChars) {
      push(line, "\n");
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?…;])\s+/)) {
      if (sentence.length <= maxChars) push(sentence, " ");
      else for (let at = 0; at < sentence.length; at += maxChars) push(sentence.slice(at, at + maxChars), " ");
    }
  }
  if (current) out.push(current);
  return out;
}

export function chunkDoc(doc: Doc, title: string, options: { maxChars?: number } = {}): Chunk[] {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const chunks: Omit<Chunk, "index" | "tokenEstimate">[] = [];
  const headings: (string | null)[] = [null, null, null];
  let buffer: string[] = [];
  let size = 0;
  const pathNow = () => [title.trim(), ...headings.filter((heading): heading is string => !!heading)].filter(Boolean).join(" › ");
  let path = pathNow();
  const flush = () => {
    if (buffer.length) chunks.push({ headingPath: path, content: buffer.join("\n") });
    buffer = [];
    size = 0;
  };

  for (const node of doc.content) {
    const text = textOf(node);
    if (node.type === "heading") {
      flush();
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      headings[level - 1] = text || null;
      for (let deeper = level; deeper < 3; deeper++) headings[deeper] = null;
      path = pathNow();
      continue;
    }
    if (!text) continue;
    for (const piece of splitLong(text, maxChars)) {
      if (size > 0 && size + 1 + piece.length > maxChars) flush();
      buffer.push(piece);
      size += (size ? 1 : 0) + piece.length;
    }
  }
  flush();
  // A page of headings only (or an empty one) is still findable by its title.
  if (chunks.length === 0 && title.trim()) chunks.push({ headingPath: title.trim(), content: docToPlainText(doc) || title.trim() });
  return chunks.map((chunk, index) => ({ index, ...chunk, tokenEstimate: estimateTokens(`${chunk.headingPath}\n${chunk.content}`) }));
}

/** What is embedded for a chunk: its heading path gives a short passage its context. */
export const chunkEmbeddingText = (chunk: Pick<Chunk, "headingPath" | "content">): string => `${chunk.headingPath}\n${chunk.content}`;
