// Ranking passages and building an extractive answer out of them. Pure — no database, no model,
// no permission decisions: whatever reaches this file is already a passage the asker may read.
//
// Why rank again after retrieval. `retrieveKbChunks` ranks by vector distance; the local driver's
// vectors are feature-hashed bags of words and the real ones are a model's guess. A lexical score
// over the passage text is a second, independent opinion, and the two fail in different places —
// so the assistant uses both, with the heading path counted as part of the passage (a chunk titled
// "Lương và ngày trả lương › Kỳ lương" is about pay even if the sentence inside does not say so).
import { questionVariants } from "./glossary";
import { buildIdf, keywordScore, keywords, lexicalScore, words } from "./question";

export type Passage = {
  chunkId: string;
  pageId: string;
  pageTitle: string;
  spaceKey: string;
  spaceName: string;
  headingPath: string;
  content: string;
  /** Cosine similarity from retrieval, -1..1; 0 when the chunk has no vector of the current model. */
  vectorScore: number;
};

export type RankedPassage = Passage & { score: number; lexical: number };

export type Citation = { pageId: string; pageTitle: string; spaceKey: string; spaceName: string; headingPath: string; chunkId: string; score: number };

/** How a passage is weighed. The lexical half dominates: it is the half that is true on any driver. */
const VECTOR_WEIGHT = 0.35;
const LEXICAL_WEIGHT = 0.65;
// A page whose title answers the question is nearly always the right page.
const TITLE_BONUS = 0.18;

/** "Trang › Mục › Mục con" → "Mục › Mục con": the headings under the page's own title. */
export const sectionOf = (headingPath: string): string => headingPath.split("›").slice(1).join(" ").trim();

export function rankPassages(question: string, passages: readonly Passage[]): RankedPassage[] {
  // The question as asked and, when the glossary knows the words, the same question in the other
  // language. A passage is scored against each and keeps its best: an English question can then
  // match a Vietnamese page without a Vietnamese question losing anything, because its own form is
  // always one of the variants. See `engine/glossary.ts`.
  const variants = questionVariants(question);
  // Counted over the candidates themselves — the passages this asker can see, and nothing else.
  const idf = buildIdf(passages.map((passage) => `${sectionOf(passage.headingPath)}\n${passage.content}`));
  const askedPerVariant = variants.map((variant) => [...new Set(keywords(variant))]);
  return passages
    .map((passage) => {
      // The section heading counts as part of the passage ("› Kỳ lương" is what the paragraph under
      // it is about), but the PAGE TITLE at the head of the path does not: it has its own term
      // below, and counting it twice is what lets a page's stock opening paragraph — whose heading
      // path is nothing but the page title — beat the section that holds the answer.
      const text = `${sectionOf(passage.headingPath)}\n${passage.content}`;
      const titleWords = new Set(words(`${passage.pageTitle} ${passage.headingPath}`));
      let lexical = 0;
      let titleBonus = 0;
      for (const [index, variant] of variants.entries()) {
        const asked = askedPerVariant[index];
        const score = lexicalScore(variant, text, idf).score;
        // A word in the heading counts for what it is worth: "lương" in "Lương và ngày trả lương"
        // says more than "việc" in "Quy trình nghỉ việc và bàn giao".
        const inTitle = asked.filter((word) => titleWords.has(word)).reduce((sum, word) => sum + idf.of(word), 0);
        const askedWeight = asked.reduce((sum, word) => sum + idf.of(word), 0);
        const bonus = askedWeight === 0 ? 0 : TITLE_BONUS * (inTitle / askedWeight);
        // One variant decides both halves: a passage should not take its lexical score from the
        // English form and its title bonus from the Vietnamese one.
        if (score + bonus > lexical + titleBonus) {
          lexical = score;
          titleBonus = bonus;
        }
      }
      // A negative cosine says "unlike"; it should not drag a good lexical match below zero.
      const vector = Math.max(0, passage.vectorScore);
      return { ...passage, lexical, score: Math.min(1, VECTOR_WEIGHT * vector + LEXICAL_WEIGHT * lexical + titleBonus) };
    })
    .sort((a, b) => b.score - a.score || a.pageId.localeCompare(b.pageId) || a.chunkId.localeCompare(b.chunkId));
}

/** Below this the assistant says it does not know rather than quoting something unrelated. */
export const ANSWER_THRESHOLD = 0.36;
/** A further passage is only worth showing when it is nearly as good as the first. */
const NEXT_PASSAGE_RATIO = 0.72;
const MAX_PASSAGE_CHARS = 900;
/** The follow-on quotes are shorter: they are context, not the answer. */
const NEXT_PASSAGE_CHARS = 600;
const MAX_PASSAGES = 3;

/** The lines of a passage, around the one that matches the question best, inside a character budget. */
export function excerpt(question: string, content: string, budget = MAX_PASSAGE_CHARS): string {
  const text = content.trim();
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  // Scored against both forms of the question for the same reason the ranking is (glossary.ts):
  // otherwise an English question picks line 1 of a Vietnamese passage every time.
  const variants = questionVariants(question);
  const scores = lines.map((line) => Math.max(...variants.map((variant) => keywordScore(variant, line))));
  let best = 0;
  for (let index = 1; index < lines.length; index++) if (scores[index] > scores[best]) best = index;
  // Grow outwards from the best line, preferring the line after (a heading's list follows it).
  let from = best;
  let to = best;
  let size = lines[best].length;
  for (;;) {
    const next = to + 1 < lines.length ? lines[to + 1].length + 1 : Infinity;
    const previous = from - 1 >= 0 ? lines[from - 1].length + 1 : Infinity;
    if (next === Infinity && previous === Infinity) break;
    if (next <= previous) {
      if (size + next > budget) break;
      size += next;
      to++;
    } else {
      if (size + previous > budget) break;
      size += previous;
      from--;
    }
  }
  const head = from > 0 ? "… " : "";
  const tail = to < lines.length - 1 ? " …" : "";
  return `${head}${lines.slice(from, to + 1).join("\n")}${tail}`;
}

export type ExtractedAnswer = { passages: { citation: Citation; excerpt: string }[] };

/**
 * The extractive answer: the passages themselves, cut to size, with their citations. No sentence
 * is written by the machine — everything the reader sees is the knowledge base's own words, which
 * is the only honest thing an assistant with no model can do, and is also what makes the local
 * driver a fair test of retrieval: if the wrong passage comes back, the answer is visibly wrong.
 */
export function extractAnswer(question: string, ranked: readonly RankedPassage[]): ExtractedAnswer {
  const best = ranked[0];
  if (!best || best.score < ANSWER_THRESHOLD) return { passages: [] };
  const chosen: RankedPassage[] = [best];
  for (const passage of ranked.slice(1)) {
    if (chosen.length >= MAX_PASSAGES) break;
    if (passage.score < best.score * NEXT_PASSAGE_RATIO) break;
    // A second section of the same page is welcome — a policy's answer often sits one heading away
    // from the words that matched ("Cách đăng ký" under "Ai được làm việc từ xa"). The same
    // passage twice is not: one chunk, one quote.
    if (chosen.some((already) => already.chunkId === passage.chunkId)) continue;
    chosen.push(passage);
  }
  return {
    passages: chosen.map((passage, index) => ({
      citation: { pageId: passage.pageId, pageTitle: passage.pageTitle, spaceKey: passage.spaceKey, spaceName: passage.spaceName, headingPath: passage.headingPath, chunkId: passage.chunkId, score: Math.round(passage.score * 1000) / 1000 },
      excerpt: excerpt(question, passage.content, index === 0 ? MAX_PASSAGE_CHARS : NEXT_PASSAGE_CHARS),
    })),
  };
}

/** The answer as one body of text: each quoted passage under the heading it came from. */
export function renderExtractedAnswer(answer: ExtractedAnswer): string {
  return answer.passages.map((passage) => `${passage.citation.headingPath}\n${passage.excerpt}`).join("\n\n");
}
