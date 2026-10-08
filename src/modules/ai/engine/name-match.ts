// Names as people type them (Phase 13): a person, a project, a team or a type named with a typo,
// shortened, in another order, without its marks, or by its initials. Pure.
//
// Every name the asker gives is weighed against the names a list holds, in three bands:
//   whole   — every word asked for is a whole word of the name, or the name is exactly what was asked;
//   partial — what was asked is inside the name, or every word starts one of its words ("Tet camp");
//   guess   — a typo ("Campain"), an abbreviation ("mkt" for marketing), initials ("NTH", "TC"), or
//             the name run together or split apart.
// Only the best band found is returned: a whole match hides the partial ones beside it, and a guess
// is offered only when nothing better is there — and is flagged, so the answer says it guessed.
import { toSearchKey } from "@/lib/text";

export type NameBand = "whole" | "partial" | "guess";
export type NameMatch<Row> = { row: Row; score: number; band: NameBand };

const BAND_RANK: Record<NameBand, number> = { whole: 3, partial: 2, guess: 1 };
/** A guess this far below the best one is noise, not a second candidate. */
const GUESS_SPREAD = 0.15;
const GUESS_FLOOR = 0.6;

const wordsOf = (key: string): string[] => key.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isNumber = (word: string) => /^\d+$/u.test(word);

/** Edits allowed in a word of this length: none under four letters, one up to seven, two beyond. */
const allowedEdits = (length: number) => (length < 4 ? 0 : length < 8 ? 1 : 2);

/** Damerau–Levenshtein distance (adjacent swaps count once), stopping early past `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = rows[i][0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

/** "mkt" in "marketing": the same first letter, then the rest in order. */
function isAbbreviation(short: string, word: string): boolean {
  if (short.length < 2 || short.length >= word.length || short[0] !== word[0] || isNumber(short)) return false;
  let at = 0;
  for (const letter of word) if (letter === short[at]) at++;
  return at === short.length;
}

/** How well one word asked for meets one word of the name: 1 the same, 0 not at all. */
function wordScore(asked: string, own: string): { score: number; band: NameBand } | null {
  if (asked === own) return { score: 1, band: "whole" };
  if (isNumber(asked)) {
    // Numbers are not misspelt: "26" is 2026 or job 026, nothing else.
    return isNumber(own) && (own.startsWith(asked) || own.endsWith(asked)) ? { score: 0.85, band: "partial" } : null;
  }
  if (own.startsWith(asked)) return { score: 0.9 - Math.min(0.1, (own.length - asked.length) / 50), band: "partial" };
  const limit = allowedEdits(Math.max(asked.length, own.length));
  if (limit > 0) {
    const edits = editDistance(asked, own, limit);
    if (edits <= limit) return { score: edits === 1 ? 0.8 : 0.7, band: "guess" };
  } else if (asked.length === 3 && own.length === 3 && [...asked].sort().join("") === [...own].sort().join("") && editDistance(asked, own, 1) === 1) {
    // A short word takes no typo but two letters swapped: "Ahn" is Anh, while "Lam" is not Lan.
    return { score: 0.75, band: "guess" };
  }
  // The start of a word, typed with a slip: "campi" for "campaign".
  if (asked.length >= 4 && own.length > asked.length && editDistance(asked, own.slice(0, asked.length), 1) <= 1) return { score: 0.64, band: "guess" };
  if (isAbbreviation(asked, own)) return { score: 0.6, band: "guess" };
  return null;
}

/** One name weighed against what was asked, or null when it is not a candidate at all. */
export function scoreName(query: string, name: string): { score: number; band: NameBand } | null {
  const asked = toSearchKey(query);
  const own = toSearchKey(name);
  if (!asked || !own) return null;
  if (asked === own) return { score: 1, band: "whole" };
  const askedWords = wordsOf(asked);
  const ownWords = wordsOf(own);
  const askedCompact = askedWords.join("");
  const ownCompact = ownWords.join("");
  if (!askedCompact || !ownCompact) return null;
  if (askedCompact === ownCompact) return { score: 0.98, band: "whole" };

  // Word by word: each word asked for meets its best word of the name.
  let total = 0;
  let band: NameBand = "whole";
  for (const word of askedWords) {
    let best: { score: number; band: NameBand } | null = null;
    for (const candidate of ownWords) {
      const met = wordScore(word, candidate);
      if (met && (!best || met.score > best.score)) best = met;
    }
    if (!best) {
      total = -1;
      break;
    }
    total += best.score;
    if (BAND_RANK[best.band] < BAND_RANK[band]) band = best.band;
  }
  const byWords = total >= 0 ? { score: (total / askedWords.length) * (band === "whole" ? 1 : 0.98), band } : null;
  if (byWords?.band === "whole") return { score: 0.95 + 0.05 * (askedWords.length / Math.max(askedWords.length, ownWords.length)), band: "whole" };

  // The old search's rule stands: what was asked, inside the name.
  const inside = own.includes(asked) || ownCompact.includes(askedCompact) ? { score: askedCompact.length >= 3 ? 0.88 : 0.82, band: "partial" as const } : null;

  // Initials: "NTH" for Nguyễn Thị Hoa, "TC" for Tết Campaign 2026 — all the words, or a run of them.
  let initials: { score: number; band: NameBand } | null = null;
  if (askedWords.length === 1 && /^\p{L}{2,6}$/u.test(askedCompact)) {
    const letters = ownWords.filter((word) => !isNumber(word)).map((word) => word[0]).join("");
    if (letters === askedCompact) initials = { score: 0.86, band: "guess" };
    else if (askedCompact.length >= 2 && letters.includes(askedCompact)) initials = { score: 0.76, band: "guess" };
  }

  // Run together, split apart or mistyped as a whole: "tetcampain", "Tet Cam paign". Its numbers
  // still have to be the name's own.
  const limit = allowedEdits(askedCompact.length);
  const digits = (text: string) => text.replace(/\D+/gu, "");
  const whole = limit > 0 && digits(askedCompact) === digits(ownCompact) && editDistance(askedCompact, ownCompact, limit) <= limit ? { score: 0.75, band: "guess" as const } : null;

  const found = [byWords, inside, initials, whole].filter((option): option is { score: number; band: NameBand } => !!option);
  if (found.length === 0) return null;
  return found.reduce((best, option) => (BAND_RANK[option.band] > BAND_RANK[best.band] || (option.band === best.band && option.score > best.score) ? option : best));
}

/**
 * The rows a name means, best first, from the best band any of them reaches. `names` gives each
 * row's names (a person's full name, a project's name, job number and client); the row counts as
 * its best one. A guess is kept only above a floor and close to the best guess.
 */
export function rankNamed<Row>(rows: readonly Row[], query: string, names: (row: Row) => readonly (string | null | undefined)[]): NameMatch<Row>[] {
  if (!toSearchKey(query)) return [];
  const matches: NameMatch<Row>[] = [];
  for (const row of rows) {
    let best: { score: number; band: NameBand } | null = null;
    for (const name of names(row)) {
      if (!name) continue;
      const met = scoreName(query, name);
      if (met && (!best || BAND_RANK[met.band] > BAND_RANK[best.band] || (met.band === best.band && met.score > best.score))) best = met;
    }
    if (best) matches.push({ row, ...best });
  }
  if (matches.length === 0) return [];
  const top = matches.reduce((rank, match) => Math.max(rank, BAND_RANK[match.band]), 0);
  const kept = matches.filter((match) => BAND_RANK[match.band] === top);
  const bestScore = Math.max(...kept.map((match) => match.score));
  // The sort is stable: rows of one score keep the order the list gave them.
  return kept.filter((match) => match.band !== "guess" || (match.score >= GUESS_FLOOR && match.score >= bestScore - GUESS_SPREAD)).sort((a, b) => b.score - a.score);
}

/** One row a name means, several to ask between, or none — and whether it was a guess. Pure. */
export function pickNamedRow<Row>(rows: readonly Row[], query: string, names: (row: Row) => readonly (string | null | undefined)[]): { one: Row; guessed: boolean } | { many: Row[]; guessed: boolean } | { none: true } {
  const ranked = rankNamed(rows, query, names);
  if (ranked.length === 0) return { none: true };
  const guessed = ranked[0].band === "guess";
  // A whole match that is plainly the best (the only exact name among names that hold it) is the one.
  const exact = ranked.filter((match) => match.score === 1);
  if (exact.length === 1) return { one: exact[0].row, guessed: false };
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.1) return { one: ranked[0].row, guessed };
  return { many: ranked.map((match) => match.row), guessed };
}

/** The rows a name means, as a list: the one when one is plainly meant, else every candidate. */
export type Named<Row> = { rows: Row[]; guessed: boolean };

export function namedRows<Row>(rows: readonly Row[], query: string, names: (row: Row) => readonly (string | null | undefined)[]): Named<Row> {
  const picked = pickNamedRow(rows, query, names);
  if ("none" in picked) return { rows: [], guessed: false };
  return "one" in picked ? { rows: [picked.one], guessed: picked.guessed } : { rows: picked.many, guessed: picked.guessed };
}

/** What the model is told when a name was matched by a guess: say so, and which. */
export const GUESS_NOTE = "Nothing is named exactly as asked; these are the closest names (a typo, a shortened name, initials or an abbreviation). Say which one you took it to mean; when more than one could be meant, ask.";

/** The guess note for a tool's result, when the name was a guess. */
export const nameGuess = (named: { guessed: boolean }) => (named.guessed ? { nameGuessed: GUESS_NOTE } : {});
