// Duplicate detection for the candidate database (FR-REC-04). Pure: no I/O.
//
// The same person applies twice — once through the careers page, once because a colleague
// forwarded their CV — and the two records then collect half a history each. So a new candidate is
// matched against the ones already on file before being created.
//
// Three signals, and they are not equal:
//   · **email** and **phone** are identifiers: an exact match on the normalised form is as close
//     to certain as this can get, and the use-case refuses outright.
//   · **name** is not. Vietnamese given names repeat constantly — there are a great many people
//     called Nguyễn Văn An — so a name match is a *warning* a recruiter overrules by ticking a box,
//     never a refusal by itself.
//
// Normalisation is deliberately conservative. `a.b@gmail.com` and `ab@gmail.com` are the same
// mailbox at Gmail and different mailboxes almost everywhere else, so dots are only dropped for
// the Google domains; a `+tag` is dropped everywhere, because no mail system routes on it.
import { toSearchKey } from "@/lib/text";

export type DuplicateSignal = "email" | "phone" | "name";

export type CandidateLike = { id: string; fullName: string; searchName: string; emailKey: string | null; phoneKey: string | null };

/**
 * `certain` is the field that decides, and it is deliberately not derived from `score`. Two
 * candidates can share a name exactly — which scores 1 — without being the same person at all, so
 * certainty follows the *signal* (an identifier matched) and never the number. Writing the first
 * version the other way round made an identical name indistinguishable from a matching mailbox.
 */
export type DuplicateMatch = { id: string; fullName: string; signals: DuplicateSignal[]; certain: boolean; /** 0..1, for ordering within a kind of match. */ score: number };

const GOOGLE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * `"  Trần.Linh+jobs@Gmail.com "` → `"tranlinh@gmail.com"`; anything that is not an address at all
 * → null, so a junk value never matches another junk value.
 */
export function normaliseEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || /\s/.test(trimmed)) return null;
  let local = trimmed.slice(0, at);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GOOGLE_MAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return local === "" ? null : `${local}@${domain}`;
}

/**
 * A Vietnamese mobile number in every shape people type it — `0912 345 678`, `+84 912 345 678`,
 * `84912345678` — down to the national significant digits `912345678`. Numbers too short to
 * identify anybody are dropped rather than matched loosely.
 */
export function normalisePhone(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  // +84 / 0084 / 84 in front of a national number that starts with a 3–9.
  if (digits.startsWith("0084")) digits = digits.slice(4);
  else if (digits.startsWith("84") && digits.length >= 11) digits = digits.slice(2);
  // Domestic trunk prefix.
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits.length >= 8 ? digits : null;
}

/** The search key a candidate row stores: accent-stripped and lower-cased, one space between words. */
export const normaliseName = (value: string): string => toSearchKey(value);

/**
 * The name with its words in alphabetical order, so "Trần Thị Mai" and "Mai Trần Thị" — the same
 * person filling in a Western-ordered form — compare equal. Used only for the *name* signal.
 */
const sortedTokens = (searchName: string): string =>
  searchName
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

/** Dice coefficient over character bigrams: 1 = identical, 0 = nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const left = sortedTokens(normaliseName(a)).replace(/\s/g, "");
  const right = sortedTokens(normaliseName(b)).replace(/\s/g, "");
  if (left === "" || right === "") return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index++) {
    const pair = left.slice(index, index + 2);
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < right.length - 1; index++) {
    const pair = right.slice(index, index + 2);
    const left_ = bigrams.get(pair) ?? 0;
    if (left_ > 0) {
      bigrams.set(pair, left_ - 1);
      shared++;
    }
  }
  return (2 * shared) / (left.length - 1 + (right.length - 1));
}

/** Above this, two names are close enough to be worth a recruiter's glance. */
export const NAME_MATCH_THRESHOLD = 0.9;

/** The identifiers a new candidate is looked up by. Null fields simply do not match anything. */
export type DuplicateProbe = { fullName: string; emailKey: string | null; phoneKey: string | null };

export const probeFor = (input: { fullName: string; email?: string | null; phone?: string | null }): DuplicateProbe => ({
  fullName: input.fullName,
  emailKey: normaliseEmail(input.email),
  phoneKey: normalisePhone(input.phone),
});

function signalsBetween(probe: DuplicateProbe, existing: CandidateLike): DuplicateSignal[] {
  const signals: DuplicateSignal[] = [];
  if (probe.emailKey && existing.emailKey && probe.emailKey === existing.emailKey) signals.push("email");
  if (probe.phoneKey && existing.phoneKey && probe.phoneKey === existing.phoneKey) signals.push("phone");
  if (nameSimilarity(probe.fullName, existing.fullName) >= NAME_MATCH_THRESHOLD) signals.push("name");
  return signals;
}

/** The candidates on file that look like this one: certain matches first, then by how close the name is. */
export function rankDuplicates(probe: DuplicateProbe, existing: readonly CandidateLike[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const row of existing) {
    const signals = signalsBetween(probe, row);
    if (signals.length === 0) continue;
    matches.push({
      id: row.id,
      fullName: row.fullName,
      signals,
      certain: signals.includes("email") || signals.includes("phone"),
      score: nameSimilarity(probe.fullName, row.fullName),
    });
  }
  return matches.sort((a, b) => Number(b.certain) - Number(a.certain) || b.score - a.score || a.fullName.localeCompare(b.fullName)).slice(0, 10);
}

/**
 * Is this refused outright, or only queried? An identifier match is the same person until proven
 * otherwise; a bare name match is a question, and a recruiter answers it by saying so.
 */
export const isCertainDuplicate = (matches: readonly DuplicateMatch[]): boolean => matches.some((match) => match.certain);
