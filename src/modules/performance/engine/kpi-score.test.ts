// Golden tests: each figure below was worked out by hand first (the comment shows the sum).
import { describe, expect, it } from "vitest";
import { annualKpiScore, canonicalInputs, type KpiLineInput, kpiMonthScore, rawAttainment, targetProblem } from "./kpi-score";

const line = (kpiCode: string, weight: number, targetValue: number, actualValue: number | null, extra: Partial<KpiLineInput> = {}): KpiLineInput => ({
  assignmentId: `a-${kpiCode}`,
  kpiCode,
  kpiName: kpiCode,
  unit: "number",
  direction: "higher_better",
  frequency: "monthly",
  periodKey: "2027-01",
  weight,
  targetValue,
  capBp: 12000,
  floorBp: 0,
  actualValue,
  notApplicable: false,
  ...extra,
});

describe("attainment of one line", () => {
  it("higher is better: actual / target, halves rounded up", () => {
    expect(rawAttainment({ direction: "higher_better", targetValue: 9500 }, 9025)).toEqual({ rawBp: 9500 });
    // 1 / 3 = 33.333… % → 3333; 2 / 3 = 66.666… % → 6667
    expect(rawAttainment({ direction: "higher_better", targetValue: 300 }, 100)).toEqual({ rawBp: 3333 });
    expect(rawAttainment({ direction: "higher_better", targetValue: 300 }, 200)).toEqual({ rawBp: 6667 });
    // 1 / 16 = 6.25 % = 625 bp exactly; 1 / 32 = 312.5 bp → 313
    expect(rawAttainment({ direction: "higher_better", targetValue: 3200 }, 100)).toEqual({ rawBp: 313 });
    expect(rawAttainment({ direction: "higher_better", targetValue: 100 }, -50)).toEqual({ rawBp: 0 });
  });

  it("higher is better needs a target above zero", () => {
    expect(rawAttainment({ direction: "higher_better", targetValue: 0 }, 10)).toEqual({ invalid: true });
    expect(targetProblem("higher_better", 0)).toBe("target_must_be_positive");
    expect(targetProblem("higher_better", 1)).toBeNull();
    expect(targetProblem("lower_better", 0)).toBeNull();
    expect(targetProblem("lower_better", -1)).toBe("target_must_not_be_negative");
  });

  it("lower is better: target / actual, with its edges", () => {
    // 2 revision rounds allowed, 2.5 taken: 200 / 250 = 80 %
    expect(rawAttainment({ direction: "lower_better", targetValue: 200 }, 250)).toEqual({ rawBp: 8000 });
    // 2 allowed, 1 taken: 200 %, the cap comes later
    expect(rawAttainment({ direction: "lower_better", targetValue: 200 }, 100)).toEqual({ rawBp: 20000 });
    // none at all: better than any ratio
    expect(rawAttainment({ direction: "lower_better", targetValue: 200 }, 0)).toEqual({ rawBp: 0, unbounded: true });
    expect(rawAttainment({ direction: "lower_better", targetValue: 0 }, 0)).toEqual({ rawBp: 0, unbounded: true });
    // target zero and something happened: nothing
    expect(rawAttainment({ direction: "lower_better", targetValue: 0 }, 100)).toEqual({ rawBp: 0 });
    expect(rawAttainment({ direction: "lower_better", targetValue: -1 }, 100)).toEqual({ invalid: true });
  });

  it("survives money-sized values", () => {
    // 1.35 billion of 1.5 billion VND = 90 %
    expect(rawAttainment({ direction: "higher_better", targetValue: 1_500_000_000 }, 1_350_000_000)).toEqual({ rawBp: 9000 });
    expect(rawAttainment({ direction: "higher_better", targetValue: 9_000_000_000_000 }, 8_999_999_999_999)).toEqual({ rawBp: 10000 });
  });
});

describe("month score", () => {
  it("is the weighted average of the lines", () => {
    // on time 95 % of 95 % → 100 %, w 40; output 18 of 20 → 90 %, w 35; engagement 3.0 of 4.0 → 75 %, w 25
    // (40 × 10000 + 35 × 9000 + 25 × 7500) / 100 = 9025
    const trace = kpiMonthScore("2027-01", [line("ON_TIME", 40, 9500, 9500, { unit: "percent" }), line("OUTPUT", 35, 2000, 1800), line("ENGAGE", 25, 400, 300, { unit: "percent" })], { missingAs: "zero" });
    expect(trace.scoreBp).toBe(9025);
    expect(trace.totalWeight).toBe(100);
    expect(trace.lines.map((item) => [item.kpiCode, item.rawBp, item.finalBp, item.contributionBp])).toEqual([
      ["ENGAGE", 7500, 7500, 1875],
      ["ON_TIME", 10000, 10000, 4000],
      ["OUTPUT", 9000, 9000, 3150],
    ]);
    expect(trace.notes).toEqual([]);
  });

  it("caps over-achievement and floors under-achievement", () => {
    // A: 150 % capped at 120 %, w 1; B: 40 % under a 50 % floor → 0, w 1 → (12000 + 0) / 2 = 6000
    const trace = kpiMonthScore("2027-01", [line("A", 1, 100, 150), line("B", 1, 100, 40, { floorBp: 5000 })], { missingAs: "zero" });
    expect(trace.lines.map((item) => [item.rawBp, item.finalBp, item.flags])).toEqual([
      [15000, 12000, ["capped"]],
      [4000, 0, ["floored"]],
    ]);
    expect(trace.scoreBp).toBe(6000);
    // exactly on the floor or the cap is neither
    expect(kpiMonthScore("2027-01", [line("A", 1, 100, 120), line("B", 1, 100, 50, { floorBp: 5000 })], { missingAs: "zero" }).lines.map((item) => item.flags)).toEqual([[], []]);
    // a KPI with its own ceiling
    expect(kpiMonthScore("2027-01", [line("A", 1, 100, 150, { capBp: 10000 })], { missingAs: "zero" }).scoreBp).toBe(10000);
  });

  it("nothing of a lower-is-better thing scores the cap", () => {
    const trace = kpiMonthScore("2027-01", [line("ERRORS", 1, 200, 0, { direction: "lower_better" })], { missingAs: "zero" });
    expect(trace.lines[0]).toMatchObject({ rawBp: null, finalBp: 12000, flags: ["capped"] });
  });

  it("leaves a not-applicable line out and hands its weight to the others", () => {
    // ROAS did not apply (no campaign): (50 × 8000 + 30 × 10000) / 80 = 8750, not / 100
    const trace = kpiMonthScore("2027-01", [line("A", 50, 100, 80), line("B", 30, 100, 100), line("ROAS", 20, 300, null, { notApplicable: true, note: "Không chạy chiến dịch" })], { missingAs: "zero" });
    expect(trace.scoreBp).toBe(8750);
    expect(trace.totalWeight).toBe(80);
    expect(trace.lines[2]).toMatchObject({ counted: false, finalBp: null, contributionBp: null, flags: ["not_applicable"] });
    expect(trace.notes).toEqual(["not_applicable_renormalised"]);
  });

  it("a missing actual is zero at the close and left out of a provisional figure", () => {
    const lines = [line("A", 60, 100, 90), line("B", 40, 100, null)];
    // closed over a missing line: (60 × 9000 + 40 × 0) / 100 = 5400
    const closed = kpiMonthScore("2027-01", lines, { missingAs: "zero" });
    expect(closed.scoreBp).toBe(5400);
    expect(closed.lines[1]).toMatchObject({ counted: true, finalBp: 0, flags: ["missing"] });
    expect(closed.notes).toEqual(["missing_scored_zero"]);
    const provisional = kpiMonthScore("2027-01", lines, { missingAs: "excluded" });
    expect(provisional.scoreBp).toBe(9000);
    expect(provisional.notes).toEqual(["missing_left_out"]);
  });

  it("reports an invalid line instead of guessing", () => {
    const trace = kpiMonthScore("2027-01", [line("A", 1, 100, 80), line("BAD", 1, 0, 50)], { missingAs: "zero" });
    expect(trace.scoreBp).toBe(8000);
    expect(trace.lines[1]).toMatchObject({ counted: false, flags: ["invalid_target"] });
    expect(trace.notes).toEqual(["invalid_line_left_out"]);
  });

  it("has no score when nothing counts", () => {
    expect(kpiMonthScore("2027-01", [], { missingAs: "zero" })).toMatchObject({ scoreBp: null, totalWeight: 0, notes: ["nothing_to_score"] });
    expect(kpiMonthScore("2027-01", [line("A", 1, 100, null, { notApplicable: true })], { missingAs: "zero" }).scoreBp).toBeNull();
  });

  it("rounds the score half up", () => {
    // (1 × 10000 + 2 × 9000 + 3 × 8000) / 6 = 8666.67 → 8667; (1 × 1 + 1 × 0) / 2 = 0.5 → 1
    expect(kpiMonthScore("2027-01", [line("A", 1, 100, 100), line("B", 2, 100, 90), line("C", 3, 100, 80)], { missingAs: "zero" }).scoreBp).toBe(8667);
    expect(kpiMonthScore("2027-01", [line("A", 1, 10000, 1), line("B", 1, 10000, 0)], { missingAs: "zero" }).scoreBp).toBe(1);
  });

  it("a quarter-end month carries the quarterly lines too", () => {
    // March: monthly 80 % w 70, quarterly client satisfaction 4.5 of 4.5 → 100 % w 30 → 8600
    const trace = kpiMonthScore("2027-03", [line("M", 70, 100, 80, { periodKey: "2027-03" }), line("CSAT", 30, 450, 450, { frequency: "quarterly", periodKey: "2027-Q1" })], { missingAs: "zero" });
    expect(trace.scoreBp).toBe(8600);
    expect(trace.lines.map((item) => item.monthsCovered)).toEqual([3, 1]);
  });

  it("does not depend on the order of the lines", () => {
    const lines = [line("B", 2, 100, 90), line("A", 1, 100, 100)];
    expect(kpiMonthScore("2027-01", lines, { missingAs: "zero" })).toEqual(kpiMonthScore("2027-01", [...lines].reverse(), { missingAs: "zero" }));
    expect(canonicalInputs("2027-01", lines, "zero")).toBe(canonicalInputs("2027-01", [...lines].reverse(), "zero"));
    expect(canonicalInputs("2027-01", lines, "zero")).not.toBe(canonicalInputs("2027-01", [{ ...lines[0], actualValue: 91 }, lines[1]], "zero"));
  });
});

describe("year score from the stored months", () => {
  const month = (key: string, lines: KpiLineInput[]) => kpiMonthScore(key, lines.map((item) => ({ ...item, periodKey: item.frequency === "quarterly" ? item.periodKey : key })), { missingAs: "zero" });

  it("gives a quarterly KPI three months of weight", () => {
    // Monthly M (w 70): 80 %, 90 %, 100 %. Quarterly Q (w 30) in March: 50 %.
    // Σ w·m·a = 70 × (8000 + 9000 + 10000) + 30 × 3 × 5000 = 1 890 000 + 450 000 = 2 340 000
    // Σ w·m   = 70 × 3 + 30 × 3 = 300 → 7800 — the same as 70 % × mean(M) 9000 + 30 % × 5000.
    const traces = [month("2027-01", [line("M", 70, 100, 80)]), month("2027-02", [line("M", 70, 100, 90)]), month("2027-03", [line("M", 70, 100, 100), line("Q", 30, 100, 50, { frequency: "quarterly", periodKey: "2027-Q1" })])];
    const year = annualKpiScore(traces);
    expect(year.scoreBp).toBe(7800);
    expect(year.weightMonths).toBe(300);
    expect(year.months).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(year.byKpi).toEqual([
      { kpiCode: "M", kpiName: "M", periods: ["2027-01", "2027-02", "2027-03"], weightMonths: 210, averageBp: 9000 },
      { kpiCode: "Q", kpiName: "Q", periods: ["2027-Q1"], weightMonths: 90, averageBp: 5000 },
    ]);
    // …whereas the plain mean of the month scores (8000, 9000, 8500) would say 8500.
    expect(traces.map((trace) => trace.scoreBp)).toEqual([8000, 9000, 8500]);
  });

  it("follows a weight change in the middle of the year", () => {
    // Jan: A w 50 100 %, B w 50 60 %. Feb (new weights): A w 80 100 %, B w 20 60 %.
    // (50 × 10000 + 50 × 6000 + 80 × 10000 + 20 × 6000) / 200 = 8600
    const year = annualKpiScore([month("2027-01", [line("A", 50, 100, 100), line("B", 50, 100, 60)]), month("2027-02", [line("A", 80, 100, 100), line("B", 20, 100, 60)])]);
    expect(year.scoreBp).toBe(8600);
  });

  it("leaves out what the months left out, and counts a closed-over gap as zero", () => {
    // Jan: A 100 % w 1, B n/a. Feb: A missing at close → 0. (10000 + 0) / 2 = 5000
    const year = annualKpiScore([month("2027-01", [line("A", 1, 100, 100), line("B", 1, 100, null, { notApplicable: true })]), month("2027-02", [line("A", 1, 100, null)])]);
    expect(year.scoreBp).toBe(5000);
    expect(year.byKpi.map((item) => item.kpiCode)).toEqual(["A"]);
  });

  it("is empty without closed months", () => {
    expect(annualKpiScore([])).toEqual({ scoreBp: null, months: [], weightMonths: 0, byKpi: [] });
  });
});
