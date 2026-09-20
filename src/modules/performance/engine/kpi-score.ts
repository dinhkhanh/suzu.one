// The KPI score of one person for one month (FR-PRF-02). Pure: plain data in, a figure and the
// whole working out — the year-end bonus is computed from these scores (SRS D13), so HR must be
// able to redo every one by hand from the trace alone. Integers only: attainment and scores in
// basis points (10000 = 100 %), ratios through BigInt, halves rounded up.
//
//   attainment   higher is better: actual / target        lower is better: target / actual
//                then the floor (below it the line scores 0), then the cap (default 120 %)
//   month score  Σ weight × attainment / Σ weight over the lines that count
//   year score   Σ weight × months × attainment / Σ weight × months over the closed months' lines,
//                months = 3 for a quarterly line — so a quarterly KPI keeps its intended weight
import type { KpiDirection, KpiFrequency, KpiUnit } from "../enums";

export type KpiLineInput = {
  assignmentId: string;
  kpiCode: string;
  kpiName: string;
  unit: KpiUnit;
  direction: KpiDirection;
  frequency: KpiFrequency;
  /** The period the actual reports for: the month, or the quarter that ends in it. */
  periodKey: string;
  weight: number;
  targetValue: number;
  capBp: number;
  floorBp: number;
  actualValue: number | null;
  notApplicable: boolean;
  note?: string | null;
};

export type KpiLineFlag = "missing" | "not_applicable" | "capped" | "floored" | "invalid_target";

export type KpiTraceLine = KpiLineInput & {
  monthsCovered: 1 | 3;
  /** actual against target before floor and cap; null when there is nothing to divide. */
  rawBp: number | null;
  /** What the line scores; null when it is left out. */
  finalBp: number | null;
  /** In the average or not. Left-out lines hand their weight to the others. */
  counted: boolean;
  /** The line's share of the month score (weight × final / total weight), for reading only. */
  contributionBp: number | null;
  flags: KpiLineFlag[];
};

export type KpiTrace = {
  version: 1;
  month: string;
  /** "zero": the month was closed with actuals missing — those lines score 0. "excluded": a provisional figure over what has been entered. */
  missingAs: "zero" | "excluded";
  lines: KpiTraceLine[];
  totalWeight: number;
  scoreBp: number | null;
  notes: string[];
};

const roundHalfUp = (numerator: bigint, denominator: bigint): number => Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
const ratioBp = (numerator: number, denominator: number): number => roundHalfUp(BigInt(numerator) * BigInt(10000), BigInt(denominator));

/** Attainment before floor and cap. `unbounded` = better than any ratio can say (nothing at all of a thing that should be low). */
export function rawAttainment(line: Pick<KpiLineInput, "direction" | "targetValue">, actual: number): { rawBp: number; unbounded?: true } | { invalid: true } {
  if (line.direction === "higher_better") {
    if (line.targetValue <= 0) return { invalid: true };
    return { rawBp: actual <= 0 ? 0 : ratioBp(actual, line.targetValue) };
  }
  if (line.targetValue < 0) return { invalid: true };
  if (actual <= 0) return { rawBp: 0, unbounded: true };
  if (line.targetValue === 0) return { rawBp: 0 };
  return { rawBp: ratioBp(line.targetValue, actual) };
}

function scoreLine(line: KpiLineInput, missingAs: KpiTrace["missingAs"]): Omit<KpiTraceLine, "contributionBp"> {
  const base = { ...line, note: line.note ?? null, monthsCovered: (line.frequency === "quarterly" ? 3 : 1) as 1 | 3 };
  if (line.notApplicable) return { ...base, rawBp: null, finalBp: null, counted: false, flags: ["not_applicable"] };
  if (line.weight <= 0) return { ...base, rawBp: null, finalBp: null, counted: false, flags: ["invalid_target"] };
  if (line.actualValue === null) return missingAs === "zero" ? { ...base, rawBp: null, finalBp: 0, counted: true, flags: ["missing"] } : { ...base, rawBp: null, finalBp: null, counted: false, flags: ["missing"] };
  const raw = rawAttainment(line, line.actualValue);
  if ("invalid" in raw) return { ...base, rawBp: null, finalBp: null, counted: false, flags: ["invalid_target"] };
  if (raw.unbounded) return { ...base, rawBp: null, finalBp: line.capBp, counted: true, flags: ["capped"] };
  if (raw.rawBp < line.floorBp) return { ...base, rawBp: raw.rawBp, finalBp: 0, counted: true, flags: ["floored"] };
  if (raw.rawBp > line.capBp) return { ...base, rawBp: raw.rawBp, finalBp: line.capBp, counted: true, flags: ["capped"] };
  return { ...base, rawBp: raw.rawBp, finalBp: raw.rawBp, counted: true, flags: [] };
}

/** One person's month. Lines are the KPIs due that month (monthly ones, and quarterly ones when a quarter ends). */
export function kpiMonthScore(month: string, lines: readonly KpiLineInput[], options: { missingAs: KpiTrace["missingAs"] }): KpiTrace {
  const scored = [...lines].sort((a, b) => a.kpiCode.localeCompare(b.kpiCode) || a.assignmentId.localeCompare(b.assignmentId)).map((line) => scoreLine(line, options.missingAs));
  const counted = scored.filter((line) => line.counted);
  const totalWeight = counted.reduce((sum, line) => sum + line.weight, 0);
  const weighted = counted.reduce((sum, line) => sum + BigInt(line.weight) * BigInt(line.finalBp ?? 0), BigInt(0));
  const notes: string[] = [];
  if (scored.some((line) => line.flags.includes("not_applicable"))) notes.push("not_applicable_renormalised");
  if (scored.some((line) => line.flags.includes("missing"))) notes.push(options.missingAs === "zero" ? "missing_scored_zero" : "missing_left_out");
  if (scored.some((line) => line.flags.includes("invalid_target"))) notes.push("invalid_line_left_out");
  if (totalWeight === 0) notes.push("nothing_to_score");
  return {
    version: 1,
    month,
    missingAs: options.missingAs,
    lines: scored.map((line) => ({ ...line, contributionBp: line.counted && totalWeight > 0 ? roundHalfUp(BigInt(line.weight) * BigInt(line.finalBp ?? 0), BigInt(totalWeight)) : null })),
    totalWeight,
    scoreBp: totalWeight === 0 ? null : roundHalfUp(weighted, BigInt(totalWeight)),
    notes,
  };
}

export type AnnualKpiLine = { kpiCode: string; kpiName: string; periods: string[]; weightMonths: number; averageBp: number };
export type AnnualKpiScore = { scoreBp: number | null; months: string[]; weightMonths: number; byKpi: AnnualKpiLine[] };

/**
 * The year from the stored month traces — and from nothing else: whatever the library or the
 * assignments say today, the figure is what the closed months recorded.
 */
export function annualKpiScore(traces: readonly Pick<KpiTrace, "month" | "lines">[]): AnnualKpiScore {
  const byKpi = new Map<string, { kpiName: string; periods: string[]; weightMonths: number; weighted: bigint }>();
  let weightMonths = 0;
  let weighted = BigInt(0);
  for (const trace of [...traces].sort((a, b) => a.month.localeCompare(b.month))) {
    for (const line of trace.lines) {
      if (!line.counted || line.finalBp === null) continue;
      const share = line.weight * line.monthsCovered;
      weightMonths += share;
      weighted += BigInt(share) * BigInt(line.finalBp);
      const entry = byKpi.get(line.kpiCode) ?? { kpiName: line.kpiName, periods: [], weightMonths: 0, weighted: BigInt(0) };
      entry.kpiName = line.kpiName;
      entry.periods.push(line.periodKey);
      entry.weightMonths += share;
      entry.weighted += BigInt(share) * BigInt(line.finalBp);
      byKpi.set(line.kpiCode, entry);
    }
  }
  return {
    scoreBp: weightMonths === 0 ? null : roundHalfUp(weighted, BigInt(weightMonths)),
    months: [...new Set(traces.map((trace) => trace.month))].sort(),
    weightMonths,
    byKpi: [...byKpi.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kpiCode, entry]) => ({ kpiCode, kpiName: entry.kpiName, periods: entry.periods, weightMonths: entry.weightMonths, averageBp: roundHalfUp(entry.weighted, BigInt(entry.weightMonths)) })),
  };
}

/** What a snapshot's hash is taken over: every input of every line, in the engine's order. */
export function canonicalInputs(month: string, lines: readonly KpiLineInput[], missingAs: KpiTrace["missingAs"]): string {
  const ordered = [...lines].sort((a, b) => a.kpiCode.localeCompare(b.kpiCode) || a.assignmentId.localeCompare(b.assignmentId));
  return JSON.stringify([month, missingAs, ordered.map((line) => [line.assignmentId, line.kpiCode, line.unit, line.direction, line.frequency, line.periodKey, line.weight, line.targetValue, line.capBp, line.floorBp, line.actualValue, line.notApplicable])]);
}

/** Can this target be scored at all? Checked when a KPI is assigned, so that an invalid line never reaches a close. */
export const targetProblem = (direction: KpiDirection, targetValue: number): "target_must_be_positive" | "target_must_not_be_negative" | null => (direction === "higher_better" ? (targetValue <= 0 ? "target_must_be_positive" : null) : targetValue < 0 ? "target_must_not_be_negative" : null);
