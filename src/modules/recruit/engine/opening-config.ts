// What an opening asks — of its applicants (custom questions, FR-REC-03) and of its interviewers
// (the interview kit, FR-REC-06). Pure: the rows the editor posts in, the rows to store out.
//
// Both are lists whose **keys** carry meaning after the fact: an application's answers are stored
// by question key, and a scorecard's ratings by criterion key. So a row keeps its key for as long
// as it exists — renaming a question does not orphan the answers already given to it — and a new
// row is given one here, from its label, never from the browser.
import { slugify } from "@/lib/slug";
import type { OpeningQuestion, ScorecardCriterion } from "../enums";

export const QUESTION_KINDS = ["text", "long_text", "choice"] as const;

export const OPENING_CONFIG_LIMITS = { questions: 15, criteria: 12, label: 200, hint: 300, choices: 12, choice: 100 } as const;

const KEY = /^[a-z0-9][a-z0-9_]{0,39}$/;

/** A key for a new row: the label, ascii and snake-cased, made unique against the keys already taken. */
export function keyFor(label: string, taken: ReadonlySet<string>, fallback: string): string {
  const base = (slugify(label, { separator: "_", maxLength: 32 }) || fallback).replace(/^[^a-z0-9]+/, "") || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Keys kept where the row had one (and it is well-formed and not repeated), minted where it did not. */
function withKeys<Row extends { key: string | null; label: string }>(rows: readonly Row[], fallback: string): (Row & { key: string })[] {
  const kept = new Set<string>();
  for (const row of rows) if (row.key && KEY.test(row.key)) kept.add(row.key);
  const taken = new Set<string>();
  return rows.map((row) => {
    const key = row.key && KEY.test(row.key) && !taken.has(row.key) ? row.key : keyFor(row.label, new Set([...kept, ...taken]), fallback);
    taken.add(key);
    return { ...row, key };
  });
}

export type QuestionDraft = { key: string | null; label: string; labelEn: string | null; kind: OpeningQuestion["kind"]; required: boolean; choices: string[] };
export type QuestionProblem = "opening_question_label_required" | "opening_question_choices_required" | "opening_questions_too_many";

/** The questions as they will be stored, or the first thing wrong with them. */
export function cleanQuestions(drafts: readonly QuestionDraft[]): { questions: OpeningQuestion[] } | { problem: QuestionProblem } {
  if (drafts.length > OPENING_CONFIG_LIMITS.questions) return { problem: "opening_questions_too_many" };
  const trimmed = drafts.map((draft) => ({
    ...draft,
    label: draft.label.trim().slice(0, OPENING_CONFIG_LIMITS.label),
    labelEn: draft.labelEn?.trim().slice(0, OPENING_CONFIG_LIMITS.label) || null,
    // A choice question's options, each once; any other kind has none.
    choices: draft.kind === "choice" ? [...new Set(draft.choices.map((choice) => choice.trim().slice(0, OPENING_CONFIG_LIMITS.choice)).filter(Boolean))].slice(0, OPENING_CONFIG_LIMITS.choices) : [],
  }));
  if (trimmed.some((draft) => draft.label === "")) return { problem: "opening_question_label_required" };
  // One option is not a choice; it is a statement with a button.
  if (trimmed.some((draft) => draft.kind === "choice" && draft.choices.length < 2)) return { problem: "opening_question_choices_required" };
  return { questions: withKeys(trimmed, "question").map(({ key, label, labelEn, kind, required, choices }) => ({ key, label, labelEn, kind, required, choices })) };
}

export type CriterionDraft = { key: string | null; label: string; labelEn: string | null; hint: string | null };
export type KitProblem = "interview_kit_label_required" | "interview_kit_too_many";

/**
 * The kit as it will be stored. An empty kit is allowed and means the module's default
 * (`DEFAULT_INTERVIEW_KIT`), which is what "start again" on the editor saves.
 */
export function cleanKit(drafts: readonly CriterionDraft[]): { kit: ScorecardCriterion[] } | { problem: KitProblem } {
  if (drafts.length > OPENING_CONFIG_LIMITS.criteria) return { problem: "interview_kit_too_many" };
  const trimmed = drafts.map((draft) => ({
    ...draft,
    label: draft.label.trim().slice(0, OPENING_CONFIG_LIMITS.label),
    labelEn: draft.labelEn?.trim().slice(0, OPENING_CONFIG_LIMITS.label) || null,
    hint: draft.hint?.trim().slice(0, OPENING_CONFIG_LIMITS.hint) || null,
  }));
  if (trimmed.some((draft) => draft.label === "")) return { problem: "interview_kit_label_required" };
  return { kit: withKeys(trimmed, "criterion").map(({ key, label, labelEn, hint }) => ({ key, label, labelEn, hint })) };
}
