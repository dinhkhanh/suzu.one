// Pure helpers for search (FR-KB-06): the query as a tsquery, and a snippet that keeps its accents.
import { toSearchKey } from "@/lib/text";

/** "Nghỉ phép năm" → ["nghi", "phep", "nam"]: what the accent-stripped index holds. */
export function searchTokens(query: string): string[] {
  return [...new Set(toSearchKey(query).split(/[^a-z0-9]+/).filter((token) => token.length > 0))].slice(0, 12);
}

/** Every word must match; the last one as a prefix, so results follow the typing. null = nothing to search for. */
export function toTsQuery(query: string): string | null {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return null;
  return tokens.map((token, index) => (index === tokens.length - 1 ? `${token}:*` : token)).join(" & ");
}

/**
 * A window of the ORIGINAL words around the first word that matches a token. The index is
 * accent-stripped, so Postgres' `ts_headline` would show "nghi phep"; this shows "nghỉ phép".
 */
export function snippetOf(text: string, query: string, options: { before?: number; after?: number } = {}): { text: string; matched: boolean } {
  const { before = 8, after = 22 } = options;
  const words = text.split(/\s+/).filter(Boolean);
  const tokens = searchTokens(query);
  const hits = (word: string) => {
    const parts = toSearchKey(word).split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.some((token, index) => parts.some((part) => (index === tokens.length - 1 ? part.startsWith(token) : part === token)));
  };
  const at = tokens.length ? words.findIndex(hits) : -1;
  const from = Math.max(0, (at < 0 ? 0 : at) - before);
  const to = Math.min(words.length, (at < 0 ? 0 : at) + after);
  return { text: `${from > 0 ? "… " : ""}${words.slice(from, to).join(" ")}${to < words.length ? " …" : ""}`, matched: at >= 0 };
}
