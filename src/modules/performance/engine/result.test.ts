// Golden cases for the final yearly result (FR-PRF-09). Every expected figure below is worked
// out by hand in the comment beside it: the year-end bonus is computed from this, and a figure
// nobody can reproduce on paper is a figure nobody can defend.
import { describe, expect, it } from "vitest";
import { bandOf, DEFAULT_PERFORMANCE_WEIGHTING, type PerformanceWeightingValue } from "../enums";
import { finalResult, okrFigure, type OkrLevelInput } from "./result";

const NONE: OkrLevelInput = { progressBp: null, goals: 0 };
const okr = (values: Partial<Record<"individual" | "team" | "department" | "entity" | "group", OkrLevelInput>>) => ({
  individual: values.individual ?? NONE,
  team: values.team ?? NONE,
  department: values.department ?? NONE,
  entity: values.entity ?? NONE,
  group: values.group ?? NONE,
});

/** A deliberately simple weighting: a third each, OKR entirely individual, two bands. */
const THIRDS: PerformanceWeightingValue = {
  reviewBp: 3400,
  kpiBp: 3300,
  okrBp: 3300,
  okrMix: { individualBp: 10_000, teamBp: 0, departmentBp: 0, entityBp: 0, groupBp: 0 },
  bands: [
    { key: "low", label: "Thấp", labelEn: "Low", minScoreBp: 0, multiplierBp: 0 },
    { key: "high", label: "Cao", labelEn: "High", minScoreBp: 10_000, multiplierBp: 20_000 },
  ],
};

describe("okrFigure", () => {
  it("mixes the levels by their configured shares", () => {
    // 50 % × 120 % + 20 % × 90 % + 20 % × 80 % + 10 % × 100 %
    //   = 6000 + 1800 + 1600 + 1000 basis points of score = 10400 bp.
    const figure = okrFigure(
      okr({ individual: { progressBp: 12_000, goals: 3 }, department: { progressBp: 9000, goals: 1 }, entity: { progressBp: 8000, goals: 1 }, group: { progressBp: 10_000, goals: 1 } }),
      DEFAULT_PERFORMANCE_WEIGHTING.okrMix,
    );
    expect(figure.scoreBp).toBe(10_400);
    expect(figure.renormalised).toBe(false);
    expect(figure.lines.map((line) => line.contributionBp)).toEqual([6000, null, 1800, 1600, 1000]);
  });

  it("hands a missing level's share to the levels that do have goals", () => {
    // Only individual (50 %) and group (10 %) have goals: counted weight 6000.
    // Renormalised: individual 5000/6000 → 8333 bp, group 1000/6000 → 1667 bp.
    // Score = (5000 × 12000 + 1000 × 6000) / 6000 = 66 000 000 / 6000 = 11 000 bp.
    const figure = okrFigure(okr({ individual: { progressBp: 12_000, goals: 2 }, group: { progressBp: 6000, goals: 1 } }), DEFAULT_PERFORMANCE_WEIGHTING.okrMix);
    expect(figure.scoreBp).toBe(11_000);
    expect(figure.renormalised).toBe(true);
    expect(figure.lines[0].normalisedWeightBp).toBe(8333);
    expect(figure.lines[4].normalisedWeightBp).toBe(1667);
    expect(figure.lines[1].flags).toEqual(["zero_weight"]);
    expect(figure.lines[2].flags).toEqual(["missing"]);
  });

  it("is null when the person has no goals at any level", () => {
    const figure = okrFigure(okr({}), DEFAULT_PERFORMANCE_WEIGHTING.okrMix);
    expect(figure.scoreBp).toBeNull();
    expect(figure.renormalised).toBe(false);
  });
});

describe("finalResult", () => {
  it("combines the three components by the approved weighting", () => {
    // review 90 % × 3400 + kpi 110 % × 3300 + okr 100 % × 3300
    //   = 30 600 000 + 36 300 000 + 33 000 000 = 99 900 000, / 10 000 = 9990 bp.
    const trace = finalResult({ reviewScoreBp: 9000, kpiScoreBp: 11_000, okr: okr({ individual: { progressBp: 10_000, goals: 2 } }) }, THIRDS);
    expect(trace.computedScoreBp).toBe(9990);
    expect(trace.countedWeightBp).toBe(10_000);
    expect(trace.renormalised).toBe(false);
    expect(trace.computedBand?.key).toBe("low");
    expect(trace.multiplierBp).toBe(0);
    // Each line's contribution adds up to the score itself.
    expect(trace.components.reduce((sum, line) => sum + (line.contributionBp ?? 0), 0)).toBe(9990);
  });

  it("renormalises when a component has no figure at all", () => {
    // No review: kpi 3300 and okr 3300 carry it. (3300 × 11000 + 3300 × 13000) / 6600 = 12 000 bp.
    const trace = finalResult({ reviewScoreBp: null, kpiScoreBp: 11_000, okr: okr({ individual: { progressBp: 13_000, goals: 1 } }) }, THIRDS);
    expect(trace.computedScoreBp).toBe(12_000);
    expect(trace.countedWeightBp).toBe(6600);
    expect(trace.renormalised).toBe(true);
    expect(trace.components[0].flags).toEqual(["missing"]);
    expect(trace.components[0].contributionBp).toBeNull();
    expect(trace.components[1].normalisedWeightBp).toBe(5000);
    expect(trace.notes).toContain("missing_review");
    expect(trace.computedBand?.key).toBe("high");
    expect(trace.multiplierBp).toBe(20_000);
  });

  it("scores nothing when no component has a figure", () => {
    const trace = finalResult({ reviewScoreBp: null, kpiScoreBp: null, okr: okr({}) }, THIRDS);
    expect(trace.computedScoreBp).toBeNull();
    expect(trace.finalScoreBp).toBeNull();
    expect(trace.computedBand).toBeNull();
    expect(trace.multiplierBp).toBeNull();
    expect(trace.notes).toContain("nothing_scored");
  });

  it("keeps the computed figure beside the owner's override, and bands the override", () => {
    const trace = finalResult(
      { reviewScoreBp: 9000, kpiScoreBp: 9000, okr: okr({ individual: { progressBp: 9000, goals: 1 } }), override: { scoreBp: 12_000, reason: "Dẫn dắt dự án cứu vãn hợp đồng lớn", byPersonId: "owner", at: "2027-01-05T00:00:00.000Z" } },
      THIRDS,
    );
    expect(trace.computedScoreBp).toBe(9000);
    expect(trace.computedBand?.key).toBe("low");
    expect(trace.finalScoreBp).toBe(12_000);
    expect(trace.finalBand?.key).toBe("high");
    expect(trace.multiplierBp).toBe(20_000);
    expect(trace.override?.reason).toContain("Dẫn dắt");
    expect(trace.notes).toContain("overridden");
  });

  it("carries the weighting version through for provenance", () => {
    const trace = finalResult({ reviewScoreBp: 10_000, kpiScoreBp: 10_000, okr: okr({ individual: { progressBp: 10_000, goals: 1 } }), weightingVersionId: "v-1" }, THIRDS);
    expect(trace.weightingVersionId).toBe("v-1");
    expect(trace.finalScoreBp).toBe(10_000);
  });

  it("uses the default weighting the demo seeds end to end", () => {
    // review 95 % × 3000 + kpi 105 % × 5000 + okr × 2000.
    // OKR: individual 50 % × 110 % + department 20 % × 100 % + entity 20 % × 90 % + group 10 % × 95 %
    //    = 5500 + 2000 + 1800 + 950 = 10 250 bp.
    // Score = (3000 × 9500 + 5000 × 10500 + 2000 × 10250) / 10 000
    //       = (28 500 000 + 52 500 000 + 20 500 000) / 10 000 = 10 150 bp → "exceeds".
    const trace = finalResult(
      {
        reviewScoreBp: 9500,
        kpiScoreBp: 10_500,
        okr: okr({ individual: { progressBp: 11_000, goals: 2 }, department: { progressBp: 10_000, goals: 1 }, entity: { progressBp: 9000, goals: 1 }, group: { progressBp: 9500, goals: 1 } }),
      },
      DEFAULT_PERFORMANCE_WEIGHTING,
    );
    expect(trace.okr.scoreBp).toBe(10_250);
    expect(trace.computedScoreBp).toBe(10_150);
    expect(trace.finalBand?.key).toBe("exceeds");
    expect(trace.multiplierBp).toBe(12_500);
  });
});

describe("bandOf", () => {
  it("takes the highest band the figure reaches, whatever order they are stored in", () => {
    const shuffled = [...DEFAULT_PERFORMANCE_WEIGHTING.bands].reverse();
    expect(bandOf(shuffled, 0)?.key).toBe("below");
    expect(bandOf(shuffled, 5999)?.key).toBe("below");
    expect(bandOf(shuffled, 6000)?.key).toBe("partly");
    expect(bandOf(shuffled, 10_999)?.key).toBe("exceeds");
    expect(bandOf(shuffled, 11_000)?.key).toBe("outstanding");
    expect(bandOf(shuffled, 99_999)?.key).toBe("outstanding");
    expect(bandOf(shuffled, null)).toBeNull();
  });
});
