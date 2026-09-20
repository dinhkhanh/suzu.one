// What a filled review form is worth (FR-PRF-03). Pure: the form's shape, its rating scale and
// the answers in, a figure and the whole working out back — the final yearly result (FR-PRF-09)
// and, through it, the year-end bonus (FR-PAY-21) are computed from it, so every figure must be
// reproducible by hand from the trace alone.
//
//   section score   the scale point the author chose, worth what the scale says it is worth
//   form score      Σ weight × scoreBp / Σ weight over the rating sections that were answered
//
// An unanswered rating section hands its weight to the others rather than scoring zero: a review
// left half-written must not quietly cost somebody a bonus band. Whether that is allowed at all
// is the use-case's business (a required section blocks submission); the engine only says what
// the answers given add up to. Basis points throughout, halves rounded up.
import type { RatingPoint, ReviewAnswers, ReviewFormShape, ReviewFormKind, ReviewSection } from "../enums";

export type ReviewScoreFlag = "unanswered" | "off_scale" | "not_rated";

export type ReviewScoreLine = {
  key: string;
  title: string;
  kind: ReviewSection["kind"];
  weight: number;
  /** The scale point chosen, when the section is a rating and the answer is on the scale. */
  value: number | null;
  label: string | null;
  /** What that point is worth. null = nothing counted. */
  scoreBp: number | null;
  counted: boolean;
  /** weight × scoreBp / total counted weight — the line's share of the form score, for reading only. */
  contributionBp: number | null;
  flags: ReviewScoreFlag[];
};

export type ReviewScoreTrace = {
  version: 1;
  kind: ReviewFormKind;
  lines: ReviewScoreLine[];
  /** Weight of the rating sections that were answered; the others are left out of the average. */
  countedWeight: number;
  totalWeight: number;
  /** null = nothing was rated at all (a text-only form, or nothing answered). */
  scoreBp: number | null;
  notes: string[];
};

const roundHalfUp = (numerator: bigint, denominator: bigint): number => Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));

const pointOf = (scale: readonly RatingPoint[], value: unknown): RatingPoint | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : null;
  return number === null ? null : (scale.find((point) => point.value === number) ?? null);
};

/** Is this answer something a person actually filled in? A blank string is not. */
export const isAnswered = (answer: unknown): boolean => (typeof answer === "string" ? answer.trim() !== "" : answer !== null && answer !== undefined);

/** Which required sections of this form have not been answered — what blocks a submission. */
export function missingRequired(shape: ReviewFormShape, kind: ReviewFormKind, answers: ReviewAnswers): string[] {
  return shape.sections.filter((section) => section.askedOf.includes(kind) && section.required && !isAnswered(answers[section.key])).map((section) => section.key);
}

export function scoreReviewForm(shape: ReviewFormShape, kind: ReviewFormKind, answers: ReviewAnswers): ReviewScoreTrace {
  const asked = shape.sections.filter((section) => section.askedOf.includes(kind));
  const notes: string[] = [];
  const lines: ReviewScoreLine[] = asked.map((section) => {
    const answer = answers[section.key];
    const flags: ReviewScoreFlag[] = [];
    if (section.kind !== "rating") flags.push("not_rated");
    else if (!isAnswered(answer)) flags.push("unanswered");
    const point = section.kind === "rating" && isAnswered(answer) ? pointOf(shape.ratingScale, answer) : null;
    if (section.kind === "rating" && isAnswered(answer) && !point) flags.push("off_scale");
    const counted = point !== null && section.weight > 0;
    return { key: section.key, title: section.title, kind: section.kind, weight: section.weight, value: point?.value ?? null, label: point?.label ?? null, scoreBp: point?.scoreBp ?? null, counted, contributionBp: null, flags };
  });

  const countedWeight = lines.filter((line) => line.counted).reduce((sum, line) => sum + line.weight, 0);
  const totalWeight = asked.filter((section) => section.kind === "rating").reduce((sum, section) => sum + section.weight, 0);
  if (countedWeight === 0) {
    if (totalWeight > 0) notes.push("nothing_rated");
    return { version: 1, kind, lines, countedWeight, totalWeight, scoreBp: null, notes };
  }
  if (countedWeight < totalWeight) notes.push("renormalised");
  if (lines.some((line) => line.flags.includes("off_scale"))) notes.push("off_scale_answers");

  const numerator = lines.filter((line) => line.counted).reduce((sum, line) => sum + BigInt(line.weight) * BigInt(line.scoreBp!), BigInt(0));
  const scoreBp = roundHalfUp(numerator, BigInt(countedWeight));
  return {
    version: 1,
    kind,
    lines: lines.map((line) => (line.counted ? { ...line, contributionBp: roundHalfUp(BigInt(line.weight) * BigInt(line.scoreBp!), BigInt(countedWeight)) } : line)),
    countedWeight,
    totalWeight,
    scoreBp,
    notes,
  };
}
