// Pages cut into passages for the Phase 9 assistant (FR-KB-11). Pure and deterministic: the same
// document always gives the same chunks, so a re-publish re-embeds only what changed.
//
// A heading starts a new chunk and names it (`headingPath`: page title › H1 › H2 › H3) and gives
// it the anchor of that heading on the reading view. The content is Markdown (`doc-markdown.ts`):
// blocks under one heading are packed up to `maxChars` with a blank line between them; a block
// longer than that is split at line, then sentence, boundaries — a long table at row boundaries,
// with its header repeated so every piece is still a table.
import { blockMarkdown, headingsIn } from "./doc-markdown";
import { type Doc, docToPlainText, headingId, inlineText } from "./doc";

export type Chunk = { index: number; headingPath: string; anchor: string | null; content: string; tokenEstimate: number };

export const CHUNK_MAX_CHARS = 1200;
/**
 * What the stored chunks look like. 1: plain text; 2: Markdown with anchors. Chunks written in an
 * older format are rebuilt by the embeddings job (`kb/chunks.ts`), so raising this re-chunks every
 * page without anybody re-publishing one.
 */
export const CHUNK_FORMAT = 2;

const TABLE_RULE = /^\|( --- \|)+$/;

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

/** A block cut to size. A table keeps its header on every piece. */
function piecesOf(markdown: string, maxChars: number): string[] {
  const lines = markdown.split("\n");
  if (markdown.length > maxChars && lines.length > 2 && TABLE_RULE.test(lines[1])) {
    const header = `${lines[0]}\n${lines[1]}`;
    return splitLong(lines.slice(2).join("\n"), Math.max(maxChars - header.length - 1, 1)).map((rows) => `${header}\n${rows}`);
  }
  return splitLong(markdown, maxChars);
}

export function chunkDoc(doc: Doc, title: string, options: { maxChars?: number } = {}): Chunk[] {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const chunks: Omit<Chunk, "index" | "tokenEstimate">[] = [];
  const headings: (string | null)[] = [null, null, null];
  let buffer: string[] = [];
  let size = 0;
  let headingsSeen = 0;
  let anchor: string | null = null;
  const pathNow = () => [title.trim(), ...headings.filter((heading): heading is string => !!heading)].filter(Boolean).join(" › ");
  let path = pathNow();
  const flush = () => {
    if (buffer.length) chunks.push({ headingPath: path, anchor, content: buffer.join("\n\n") });
    buffer = [];
    size = 0;
  };

  for (const node of doc.content) {
    if (node.type === "heading") {
      flush();
      const text = inlineText(node).replace(/\s+/g, " ").trim();
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      headings[level - 1] = text || null;
      for (let deeper = level; deeper < 3; deeper++) headings[deeper] = null;
      path = pathNow();
      anchor = headingId(headingsSeen);
      headingsSeen++;
      continue;
    }
    // Headings nested inside a block (a callout, a table cell) are numbered by the reading view
    // too, so they count here even though they do not start a chunk.
    const nested = headingsIn(node);
    const markdown = blockMarkdown(node).join("\n").trim();
    headingsSeen += nested;
    if (!markdown) continue;
    for (const piece of piecesOf(markdown, maxChars)) {
      if (size > 0 && size + 2 + piece.length > maxChars) flush();
      buffer.push(piece);
      size += (size ? 2 : 0) + piece.length;
    }
  }
  flush();
  // A page of headings only (or an empty one) is still findable by its title.
  if (chunks.length === 0 && title.trim()) chunks.push({ headingPath: title.trim(), anchor: null, content: docToPlainText(doc) || title.trim() });
  return chunks.map((chunk, index) => ({ index, ...chunk, tokenEstimate: estimateTokens(`${chunk.headingPath}\n${chunk.content}`) }));
}

/** What is embedded for a chunk: its heading path gives a short passage its context. */
export const chunkEmbeddingText = (chunk: Pick<Chunk, "headingPath" | "content">): string => `${chunk.headingPath}\n${chunk.content}`;
