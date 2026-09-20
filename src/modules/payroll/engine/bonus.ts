// The performance-driven year-end bonus of one person (FR-PAY-21, SRS D13). Pure: a salary, a
// service time, a performance result and a unit's OKR year in — one amount in whole đồng and the
// entire working out back. No I/O, no date handling, no configuration of its own.
//
//   combined multiplier = service factor × performance multiplier × unit OKR multiplier
//   amount              = base month salary × min(combined, cap), rounded to the scheme's unit
//
// **The trace is the phase's exit criterion.** Every band chosen, the figure that chose it, the
// arithmetic of each step and any owner override are in `BonusTrace`, so a person's amount can be
// explained from their KPI and OKR results alone — by a human, with a calculator.
//
// Basis points for every factor, integer VND for every amount, bigint arithmetic with halves
// rounded up, so nothing drifts and the same input always gives the same bytes.
import type { BonusExclusion, BonusOkrBand, BonusOkrLevel, BonusSchemeValue, BonusScoreBand, ServiceBand } from "../enums";

export const FULL_BP = 10_000;

/** One line of the arithmetic, as the screen shows it. */
export type BonusTraceStep = {
  key: "base" | "service" | "performance" | "unit_okr" | "cap" | "rounding" | "override";
  /** The expression with its actual figures, e.g. "20.000.000 × 1,0000 × 1,2500 × 1,1000". */
  expression: string;
  /** What the running total is after this step, in whole đồng. */
  valueVnd: number;
};

export type BonusServiceTrace = { months: number; label: string; minMonths: number; factorBp: number };

export type BonusPerformanceTrace = {
  source: BonusSchemeValue["performanceMultiplier"]["source"];
  /** Which settled result the figures came from — the other half of the provenance chain. */
  resultId: string | null;
  finalScoreBp: number | null;
  /** The three figures behind the final score, carried through so the trace stands on its own. */
  reviewScoreBp: number | null;
  kpiScoreBp: number | null;
  okrScoreBp: number | null;
  bandKey: string | null;
  bandLabel: string | null;
  multiplierBp: number;
  /** Did the owner override the *result*? (An override of the amount is `BonusTrace.override`.) */
  resultOverridden: boolean;
  resultOverrideReason: string | null;
};

export type BonusUnitOkrTrace = { level: BonusOkrLevel; progressBp: number | null; label: string | null; minProgressBp: number | null; multiplierBp: number };

export type BonusOverride = { amountVnd: number; reason: string; byPersonId: string | null; at: string | null };

export type BonusTrace = {
  version: 1;
  /** Which approved scheme version produced this (provenance; set by the caller). */
  schemeVersionId: string | null;
  eligible: boolean;
  /** Why not, when `eligible` is false. The amount is then 0 unless the owner grants one. */
  exclusion: BonusExclusion | null;
  base: { componentCode: string; amountVnd: number };
  service: BonusServiceTrace;
  performance: BonusPerformanceTrace;
  unitOkr: BonusUnitOkrTrace;
  /** service × performance × unit OKR, before the cap. */
  combinedMultiplierBp: number;
  cap: { capMultiplierBp: number; applied: boolean; multiplierBp: number };
  steps: BonusTraceStep[];
  rounding: { unitVnd: number; beforeVnd: number; afterVnd: number };
  /** What the formula alone comes to. An override never rewrites it. */
  computedAmountVnd: number;
  override: BonusOverride | null;
  finalAmountVnd: number;
  notes: string[];
};

/** The settled performance result, as the bonus reads it (FR-PRF-09 publishes exactly this). */
export type BonusResultInput = {
  resultId: string;
  finalScoreBp: number | null;
  bandKey: string | null;
  /** What FR-PRF-09 published for the band. Used when the scheme's source is `result_band`. */
  bandMultiplierBp: number | null;
  bandLabel: string | null;
  reviewScoreBp: number | null;
  kpiScoreBp: number | null;
  okrScoreBp: number | null;
  overridden: boolean;
  overrideReason: string | null;
};

export type BonusPersonInput = {
  /** One month's salary under the scheme's base component, whole đồng. */
  baseSalaryVnd: number | null;
  /** Whole months between the start date and the scheme's reference day. */
  serviceMonths: number;
  workforceType: string;
  /** Still employed on the reference day. */
  activeOnReferenceDay: boolean;
  result: BonusResultInput | null;
  /** The unit OKR figure the scheme's level asks for; null when the person has no such unit. */
  unitOkrProgressBp: number | null;
  /** The owner's adjustment of the amount itself, with the reason they gave. */
  override?: BonusOverride | null;
  schemeVersionId?: string | null;
};

const roundHalfUp = (numerator: bigint, denominator: bigint): number => Number((numerator * 2n + denominator) / (denominator * 2n));

/**
 * Whole months of service between two "YYYY-MM-DD" days — the figure the service bands read.
 * A month counts once the same day of the month has come round: 15 March → 14 April is 0 months,
 * 15 April is 1. Negative spans (somebody who starts after the reference day) come back as 0.
 */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth) - (toDay < fromDay ? 1 : 0);
  return Math.max(0, months);
}

/** The highest band whose floor the figure reaches. */
const pick = <B>(bands: readonly B[], floorOf: (band: B) => number, figure: number): B | null => [...bands].sort((a, b) => floorOf(a) - floorOf(b)).filter((band) => figure >= floorOf(band)).pop() ?? null;

export const serviceBandFor = (bands: readonly ServiceBand[], months: number): ServiceBand | null => pick(bands, (band) => band.minMonths, months);
export const scoreBandFor = (bands: readonly BonusScoreBand[], scoreBp: number): BonusScoreBand | null => pick(bands, (band) => band.minScoreBp, scoreBp);
export const okrBandFor = (bands: readonly BonusOkrBand[], progressBp: number): BonusOkrBand | null => pick(bands, (band) => band.minProgressBp, progressBp);

/** "1,2500" — a basis-point factor as a plain multiplier, for the trace's expressions. */
const factorText = (bp: number): string => (bp / FULL_BP).toFixed(4);
const vndText = (amount: number): string => amount.toLocaleString("vi-VN");

/** Why this person gets nothing, or null if they qualify. Checked in a fixed order so it is stable. */
function exclusionOf(input: BonusPersonInput, scheme: BonusSchemeValue): BonusExclusion | null {
  if (scheme.eligibility.requireActive && !input.activeOnReferenceDay) return "not_active";
  if (scheme.eligibility.excludeWorkforceTypes.includes(input.workforceType)) return "workforce_type";
  if (input.serviceMonths < scheme.eligibility.minServiceMonths) return "service_too_short";
  if (scheme.eligibility.requireResult && !input.result) return "no_result";
  if (input.baseSalaryVnd === null) return "no_salary";
  if (scheme.eligibility.requireResult && input.result && input.result.finalScoreBp === null) return "no_band";
  return null;
}

/** The individual multiplier: the band FR-PRF-09 published, or the scheme's own table. */
function performanceOf(input: BonusPersonInput, scheme: BonusSchemeValue): BonusPerformanceTrace {
  const { source, bands } = scheme.performanceMultiplier;
  const result = input.result;
  const common = {
    source,
    resultId: result?.resultId ?? null,
    finalScoreBp: result?.finalScoreBp ?? null,
    reviewScoreBp: result?.reviewScoreBp ?? null,
    kpiScoreBp: result?.kpiScoreBp ?? null,
    okrScoreBp: result?.okrScoreBp ?? null,
    resultOverridden: result?.overridden ?? false,
    resultOverrideReason: result?.overrideReason ?? null,
  };
  if (source === "result_band") {
    return { ...common, bandKey: result?.bandKey ?? null, bandLabel: result?.bandLabel ?? null, multiplierBp: result?.bandMultiplierBp ?? 0 };
  }
  const band = result?.finalScoreBp === null || result?.finalScoreBp === undefined ? null : scoreBandFor(bands, result.finalScoreBp);
  return { ...common, bandKey: band?.key ?? null, bandLabel: band?.label ?? null, multiplierBp: band?.multiplierBp ?? 0 };
}

function unitOkrOf(input: BonusPersonInput, scheme: BonusSchemeValue): BonusUnitOkrTrace {
  const { level, bands } = scheme.unitOkr;
  // No collective half, or the person belongs to no such unit: the multiplier is neutral, not zero.
  if (level === "none" || input.unitOkrProgressBp === null) return { level, progressBp: input.unitOkrProgressBp, label: null, minProgressBp: null, multiplierBp: FULL_BP };
  const band = okrBandFor(bands, input.unitOkrProgressBp);
  return { level, progressBp: input.unitOkrProgressBp, label: band?.label ?? null, minProgressBp: band?.minProgressBp ?? null, multiplierBp: band?.multiplierBp ?? FULL_BP };
}

/**
 * One person's year-end bonus under one scheme version.
 *
 * An ineligible person stays in the run with an amount of 0 and the reason on their line — they
 * are not silently dropped, because "why did I get nothing?" is the question the run has to
 * answer. The owner may still grant them an amount; that is an override with a reason like any
 * other, and it is recorded as one.
 */
export function bonusForPerson(input: BonusPersonInput, scheme: BonusSchemeValue): BonusTrace {
  const notes: string[] = [];
  const exclusion = exclusionOf(input, scheme);
  const base = input.baseSalaryVnd ?? 0;
  const serviceBand = serviceBandFor(scheme.serviceBands, input.serviceMonths);
  const service: BonusServiceTrace = { months: input.serviceMonths, label: serviceBand?.label ?? "", minMonths: serviceBand?.minMonths ?? 0, factorBp: serviceBand?.factorBp ?? 0 };
  const performance = performanceOf(input, scheme);
  const unitOkr = unitOkrOf(input, scheme);

  // service × performance × unit OKR, kept exact until the one rounding at the end.
  const combinedMultiplierBp = exclusion ? 0 : roundHalfUp(BigInt(service.factorBp) * BigInt(performance.multiplierBp) * BigInt(unitOkr.multiplierBp), BigInt(FULL_BP) * BigInt(FULL_BP));
  const capped = Math.min(combinedMultiplierBp, scheme.capMultiplierBp);
  const capApplied = capped < combinedMultiplierBp;
  if (capApplied) notes.push("capped");

  const beforeRounding = exclusion ? 0 : roundHalfUp(BigInt(base) * BigInt(capped), BigInt(FULL_BP));
  const unit = BigInt(scheme.roundingVnd);
  const computedAmountVnd = exclusion ? 0 : Number(((BigInt(beforeRounding) * 2n + unit) / (unit * 2n)) * unit);

  const steps: BonusTraceStep[] = [];
  if (exclusion) {
    notes.push(`excluded_${exclusion}`);
    steps.push({ key: "base", expression: `— (${exclusion})`, valueVnd: 0 });
  } else {
    steps.push({ key: "base", expression: `${scheme.baseComponentCode} = ${vndText(base)} ₫`, valueVnd: base });
    const afterService = roundHalfUp(BigInt(base) * BigInt(service.factorBp), BigInt(FULL_BP));
    steps.push({ key: "service", expression: `${vndText(base)} × ${factorText(service.factorBp)} (${service.label}, ${service.months} tháng)`, valueVnd: afterService });
    const afterPerformance = roundHalfUp(BigInt(base) * BigInt(service.factorBp) * BigInt(performance.multiplierBp), BigInt(FULL_BP) * BigInt(FULL_BP));
    steps.push({ key: "performance", expression: `${vndText(afterService)} × ${factorText(performance.multiplierBp)} (${performance.bandLabel ?? "—"})`, valueVnd: afterPerformance });
    const afterOkr = roundHalfUp(BigInt(base) * BigInt(combinedMultiplierBp), BigInt(FULL_BP));
    steps.push({ key: "unit_okr", expression: `${vndText(afterPerformance)} × ${factorText(unitOkr.multiplierBp)} (${unitOkr.label ?? "—"})`, valueVnd: afterOkr });
    if (capApplied) steps.push({ key: "cap", expression: `trần ${factorText(scheme.capMultiplierBp)} × ${vndText(base)}`, valueVnd: beforeRounding });
    if (computedAmountVnd !== beforeRounding) steps.push({ key: "rounding", expression: `làm tròn ${vndText(beforeRounding)} → bội số ${vndText(scheme.roundingVnd)} ₫`, valueVnd: computedAmountVnd });
  }

  const override = input.override ?? null;
  if (override) {
    notes.push("overridden");
    steps.push({ key: "override", expression: `chủ sở hữu điều chỉnh: ${override.reason}`, valueVnd: override.amountVnd });
  }

  return {
    version: 1,
    schemeVersionId: input.schemeVersionId ?? null,
    eligible: exclusion === null,
    exclusion,
    base: { componentCode: scheme.baseComponentCode, amountVnd: base },
    service,
    performance,
    unitOkr,
    combinedMultiplierBp,
    cap: { capMultiplierBp: scheme.capMultiplierBp, applied: capApplied, multiplierBp: capped },
    steps,
    rounding: { unitVnd: scheme.roundingVnd, beforeVnd: beforeRounding, afterVnd: computedAmountVnd },
    computedAmountVnd,
    override,
    finalAmountVnd: override ? override.amountVnd : computedAmountVnd,
    notes,
  };
}

/** What a simulation adds up to. Money only; who is in it is the caller's business. */
export type BonusTotals = { headcount: number; eligible: number; excluded: number; overridden: number; totalVnd: number; computedTotalVnd: number };

export const EMPTY_BONUS_TOTALS: BonusTotals = { headcount: 0, eligible: 0, excluded: 0, overridden: 0, totalVnd: 0, computedTotalVnd: 0 };

export function sumBonus(traces: readonly BonusTrace[]): BonusTotals {
  return traces.reduce<BonusTotals>(
    (totals, trace) => ({
      headcount: totals.headcount + 1,
      eligible: totals.eligible + (trace.eligible ? 1 : 0),
      excluded: totals.excluded + (trace.eligible ? 0 : 1),
      overridden: totals.overridden + (trace.override ? 1 : 0),
      totalVnd: totals.totalVnd + trace.finalAmountVnd,
      computedTotalVnd: totals.computedTotalVnd + trace.computedAmountVnd,
    }),
    EMPTY_BONUS_TOTALS,
  );
}
