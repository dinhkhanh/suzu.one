// The final performance result of one person for one year (FR-PRF-09). Pure: three figures, a
// weighting version and an optional owner override in, one score, one band and the whole working
// out back. The year-end bonus (FR-PAY-21) is computed from the band this produces, so the exit
// criterion of the phase rests here: everything in `ResultTrace` must be reproducible by hand.
//
//   OKR figure   Σ mixWeight × levelProgress / Σ mixWeight, over the levels the person has goals at
//   score        Σ weight × componentScore / Σ weight, over the components that have a figure
//   band         the highest band whose floor the score reaches
//
// **A missing component hands its weight to the others** rather than scoring zero — somebody whose
// review was never released must not silently lose a bonus band because of it. The use-case
// decides whether a result with a missing component may be locked at all; the engine only says
// what the figures given add up to, and flags what was missing.
//
// Basis points throughout, halves rounded up, integer arithmetic (bigint) so nothing drifts.
import { bandOf, FULL_WEIGHT_BP, type OkrLevel, type PerformanceWeightingValue, type ResultBand, type ResultComponentKey } from "../enums";

export type ResultFlag = "missing" | "zero_weight";

export type ResultComponentLine = {
  key: ResultComponentKey;
  scoreBp: number | null;
  /** The weight the approved version gives this component. */
  weightBp: number;
  /** The weight it actually carried once the missing components dropped out. */
  normalisedWeightBp: number;
  /** normalisedWeight × score / 10000 — the component's share of the final score. */
  contributionBp: number | null;
  flags: ResultFlag[];
};

export type OkrMixLine = {
  level: OkrLevel;
  progressBp: number | null;
  weightBp: number;
  normalisedWeightBp: number;
  contributionBp: number | null;
  /** How many goals stood behind the figure — an empty level is not a zero. */
  goals: number;
  flags: ResultFlag[];
};

export type ResultOverride = { scoreBp: number; reason: string; byPersonId: string | null; at: string | null };

export type ResultTrace = {
  version: 1;
  /** Which approved weighting version the figures were combined by (provenance, set by the caller). */
  weightingVersionId: string | null;
  okr: { lines: OkrMixLine[]; scoreBp: number | null; renormalised: boolean };
  components: ResultComponentLine[];
  /** Total weight of the components that had a figure. 0 = nothing to score at all. */
  countedWeightBp: number;
  renormalised: boolean;
  computedScoreBp: number | null;
  computedBand: ResultBand | null;
  /** The owner's figure, with the reason they gave. The computed one above is never overwritten. */
  override: ResultOverride | null;
  finalScoreBp: number | null;
  finalBand: ResultBand | null;
  /** What the multiplier the bonus reads comes out at — the band's, or 0 when there is no band. */
  multiplierBp: number | null;
  notes: string[];
};

export type OkrLevelInput = { progressBp: number | null; goals: number };

export type ResultInput = {
  reviewScoreBp: number | null;
  kpiScoreBp: number | null;
  okr: Record<OkrLevel, OkrLevelInput>;
  override?: ResultOverride | null;
  weightingVersionId?: string | null;
};

const roundHalfUp = (numerator: bigint, denominator: bigint): number => Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));

/** weight × score / 10000, as a share of the final figure. */
const share = (weightBp: number, scoreBp: number): number => roundHalfUp(BigInt(weightBp) * BigInt(scoreBp), BigInt(FULL_WEIGHT_BP));

type Weighted = { weightBp: number; scoreBp: number | null };

/** Σ weight × score / Σ weight over the lines that have a figure, and what each line then weighed. */
function combine(lines: readonly Weighted[]): { scoreBp: number | null; countedWeightBp: number; normalised: number[] } {
  const counted = lines.map((line) => (line.scoreBp !== null && line.weightBp > 0 ? line.weightBp : 0));
  const countedWeightBp = counted.reduce((sum, weight) => sum + weight, 0);
  if (countedWeightBp === 0) return { scoreBp: null, countedWeightBp: 0, normalised: lines.map(() => 0) };
  // Renormalise to a full 10 000 so every line's contribution adds up to the score itself.
  const normalised = counted.map((weight) => (weight === 0 ? 0 : roundHalfUp(BigInt(weight) * BigInt(FULL_WEIGHT_BP), BigInt(countedWeightBp))));
  const numerator = lines.reduce((sum, line, index) => (counted[index] === 0 ? sum : sum + BigInt(counted[index]) * BigInt(line.scoreBp!)), BigInt(0));
  return { scoreBp: roundHalfUp(numerator, BigInt(countedWeightBp)), countedWeightBp, normalised };
}

const OKR_ORDER: readonly OkrLevel[] = ["individual", "team", "department", "entity", "group"];

/** The one OKR figure the weighting asks for: the mix of the person's own goals and their units'. */
export function okrFigure(okr: Record<OkrLevel, OkrLevelInput>, mix: PerformanceWeightingValue["okrMix"]): { lines: OkrMixLine[]; scoreBp: number | null; renormalised: boolean } {
  const weightOf: Record<OkrLevel, number> = { individual: mix.individualBp, team: mix.teamBp, department: mix.departmentBp, entity: mix.entityBp, group: mix.groupBp };
  const inputs = OKR_ORDER.map((level) => ({ level, weightBp: weightOf[level], scoreBp: okr[level].progressBp, goals: okr[level].goals }));
  const { scoreBp, countedWeightBp, normalised } = combine(inputs);
  const askedWeight = inputs.reduce((sum, line) => sum + line.weightBp, 0);
  const lines: OkrMixLine[] = inputs.map((line, index) => {
    const flags: ResultFlag[] = [];
    if (line.weightBp === 0) flags.push("zero_weight");
    else if (line.scoreBp === null) flags.push("missing");
    return { level: line.level, progressBp: line.scoreBp, weightBp: line.weightBp, normalisedWeightBp: normalised[index], contributionBp: normalised[index] === 0 || line.scoreBp === null ? null : share(normalised[index], line.scoreBp), goals: line.goals, flags };
  });
  return { lines, scoreBp, renormalised: countedWeightBp > 0 && countedWeightBp < askedWeight };
}

export function finalResult(input: ResultInput, weighting: PerformanceWeightingValue): ResultTrace {
  const notes: string[] = [];
  const okr = okrFigure(input.okr, weighting.okrMix);
  if (okr.renormalised) notes.push("okr_renormalised");

  const inputs: { key: ResultComponentKey; weightBp: number; scoreBp: number | null }[] = [
    { key: "review", weightBp: weighting.reviewBp, scoreBp: input.reviewScoreBp },
    { key: "kpi", weightBp: weighting.kpiBp, scoreBp: input.kpiScoreBp },
    { key: "okr", weightBp: weighting.okrBp, scoreBp: okr.scoreBp },
  ];
  const { scoreBp: computedScoreBp, countedWeightBp, normalised } = combine(inputs);
  const components: ResultComponentLine[] = inputs.map((line, index) => {
    const flags: ResultFlag[] = [];
    if (line.weightBp === 0) flags.push("zero_weight");
    else if (line.scoreBp === null) flags.push("missing");
    return { key: line.key, scoreBp: line.scoreBp, weightBp: line.weightBp, normalisedWeightBp: normalised[index], contributionBp: normalised[index] === 0 || line.scoreBp === null ? null : share(normalised[index], line.scoreBp), flags };
  });

  const askedWeight = inputs.reduce((sum, line) => sum + line.weightBp, 0);
  const renormalised = countedWeightBp > 0 && countedWeightBp < askedWeight;
  if (renormalised) notes.push("renormalised");
  if (countedWeightBp === 0) notes.push("nothing_scored");
  for (const line of components) if (line.flags.includes("missing")) notes.push(`missing_${line.key}`);

  const computedBand = bandOf(weighting.bands, computedScoreBp);
  const override = input.override ?? null;
  if (override) notes.push("overridden");
  const finalScoreBp = override ? override.scoreBp : computedScoreBp;
  const finalBand = override ? bandOf(weighting.bands, finalScoreBp) : computedBand;

  return {
    version: 1,
    weightingVersionId: input.weightingVersionId ?? null,
    okr,
    components,
    countedWeightBp,
    renormalised,
    computedScoreBp,
    computedBand,
    override,
    finalScoreBp,
    finalBand,
    multiplierBp: finalBand?.multiplierBp ?? null,
    notes,
  };
}
