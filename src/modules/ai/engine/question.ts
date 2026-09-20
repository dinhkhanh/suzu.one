// Turning a question into something retrieval can use. Pure.
//
// Two jobs. First, a question is not a query: "Tôi được nghỉ phép bao nhiêu ngày một năm?" carries
// six words that say nothing about the subject. The stop list below drops them, which matters more
// here than in a search box, because the embedding of the whole question is diluted by every word
// that means nothing — the local driver's vectors are feature-hashed bags of words, and the real
// ones are not immune either.
//
// Second, scoring: the passages that come back are ranked again in the application against the
// question's content words (`keywordScore`), because a lexical signal and a vector signal fail in
// different places. Nothing here touches the database or decides access.
import { toSearchKey } from "@/lib/text";

// Vietnamese question and function words, plus the English ones, that carry no subject. Kept short
// on purpose: a stop list that grows starts removing the answer.
const STOP_WORDS = new Set([
  // vi — questions
  "ai", "bao", "nhieu", "gi", "gì", "nao", "sao", "the", "nhu", "khi", "dau", "may", "bao_lau", "lam",
  // vi — function words
  "la", "co", "cua", "va", "voi", "cho", "trong", "tren", "duoi", "den", "tu", "toi", "minh", "em",
  "anh", "chi", "ban", "duoc", "phai", "thi", "ma", "neu", "hay", "hoac", "mot", "nhung", "cac",
  "nay", "do", "kia", "se", "da", "dang", "ve", "ra", "vao", "boi", "no", "ho", "chung", "ta", "tui",
  "xin", "vui", "long", "hoi", "muon", "can", "biet", "noi", "cau",
  // "không" stays a content word: in a policy it is usually the answer ("Nghỉ không lương … Không").
  // en
  "a", "an", "the", "is", "are", "was", "were", "be", "do", "does", "did", "how", "what", "when",
  "where", "which", "who", "whom", "why", "can", "could", "should", "would", "will", "shall", "may",
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "they", "their", "of", "for", "to", "in",
  "on", "at", "by", "with", "from", "and", "or", "if", "as", "that", "this", "these", "those", "many",
  "much", "long", "have", "has", "had", "get", "am", "about", "there", "here", "any", "some",
]);

/** Words of a text, accent-stripped and lower-cased, in order. Numbers count: "5 ngày" is a fact. */
export function words(text: string): string[] {
  return toSearchKey(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** The words that carry the subject: no stop words, no single letters (except digits). */
export function keywords(text: string): string[] {
  return words(text).filter((word) => !STOP_WORDS.has(word) && (word.length > 1 || /^[0-9]$/.test(word)));
}

/**
 * What is actually sent to retrieval. Content words only, de-duplicated, in the order they were
 * asked; the whole question when nothing survives the stop list (a one-word question, or one
 * written entirely in words this list happens to hold).
 */
export function retrievalQuery(question: string): string {
  const content = [...new Set(keywords(question))];
  return (content.length > 0 ? content : [...new Set(words(question))]).join(" ");
}

/**
 * How rare each word is in the passages that came back, so that "thẻ nhân viên" is not outscored
 * by "công việc". Handbook prose repeats a small vocabulary — công ty, nhân viên, làm việc, ngày,
 * tháng — and without this the boilerplate note at the top of every page beats the paragraph that
 * holds the answer. Standard inverse document frequency over the candidate set, which is exactly
 * the right corpus: it is what THIS asker can see, so a word that is everywhere in their part of
 * the knowledge base counts for little to them.
 *
 * A word in the question that appears in no passage at all gets the maximum weight and can never
 * be matched — which is how "có tài trợ thẻ tập gym không?" ends up below the answering threshold
 * while every word of it except "gym" is ordinary handbook vocabulary.
 */
export type Idf = { of: (word: string) => number; max: number };

export function buildIdf(texts: readonly string[]): Idf {
  const total = texts.length;
  const documents = new Map<string, number>();
  for (const text of texts) for (const word of new Set(words(text))) documents.set(word, (documents.get(word) ?? 0) + 1);
  const max = Math.log(1 + total);
  return { of: (word) => (total === 0 ? 1 : Math.log(1 + total / (1 + (documents.get(word) ?? 0)))), max: total === 0 ? 1 : max };
}

/** Every word equally rare: the fallback when there is no corpus to count (unit tests, one passage). */
export const FLAT_IDF: Idf = { of: () => 1, max: 1 };

/** Adjacent pairs of content words: "vợ sinh con" → "vo sinh", "sinh con". */
export function phrases(text: string): string[] {
  const content = keywords(text);
  return content.slice(1).map((word, index) => `${content[index]} ${word}`);
}

export type LexicalScore = {
  /** Share of the question's information the passage covers, 0..1. */
  coverage: number;
  /** How distinctive the best word it did match is, 0..1 — one rare hit beats five common ones. */
  peak: number;
  /** Share of the question's word pairs the passage repeats, 0..1. */
  phrase: number;
  /** The blend the ranker uses. */
  score: number;
};

const COVERAGE_WEIGHT = 0.44;
const PEAK_WEIGHT = 0.36;
const PHRASE_WEIGHT = 0.2;

/**
 * How well a passage answers the question, 0..1. Three parts, because each one alone has a known
 * way of being wrong:
 *  - coverage — "most of what was asked about is in here". Alone, a page of stock phrases matches
 *    everything.
 *  - peak — "the word that made this question specific is in here". Alone, one stray word drags in
 *    the wrong page.
 *  - phrase — "the words are together, in that order". "quấy rối" is a different thing from a page
 *    that happens to contain "quay" (a film take) and "rồi"; accent-stripped search cannot tell
 *    them apart by word, only by company.
 */
export function lexicalScore(question: string, text: string, idf: Idf = FLAT_IDF): LexicalScore {
  const asked = [...new Set(keywords(question))];
  if (asked.length === 0) return { coverage: 0, peak: 0, phrase: 0, score: 0 };
  const found = new Set(words(text));
  // An unmatched word is never free: weighed at the ceiling, a question about something the
  // knowledge base has no word for cannot reach the threshold by matching its filler.
  let total = 0;
  let hit = 0;
  let best = 0;
  for (const word of asked) {
    const weight = idf.of(word);
    total += weight;
    if (found.has(word)) {
      hit += weight;
      best = Math.max(best, weight);
    }
  }
  const asksFor = [...new Set(phrases(question))];
  const inText = new Set(phrases(text));
  const phrase = asksFor.length === 0 ? 0 : asksFor.filter((pair) => inText.has(pair)).length / asksFor.length;
  const coverage = total === 0 ? 0 : hit / total;
  const peak = idf.max === 0 ? 0 : Math.min(1, best / idf.max);
  return { coverage, peak, phrase, score: COVERAGE_WEIGHT * coverage + PEAK_WEIGHT * peak + PHRASE_WEIGHT * phrase };
}

/** The simple form, for picking the best line inside a passage that has already won. */
export const keywordScore = (question: string, text: string): number => lexicalScore(question, text).coverage;
