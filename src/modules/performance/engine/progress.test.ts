// Golden cases for the progress roll-up. Every expected figure here was worked out by hand; if one
// changes, a bonus changes (SRS D13) — so change them only on purpose.
import { describe, expect, it } from "vitest";
import { metricValueText, parseMetricValue } from "../enums";
import { type GoalInput, goalProgress, isStale, type KeyResultInput, keyResultProgressBp, weekStartOf, weightedAverageBp, worstConfidence } from "./progress";

const kr = (over: Partial<KeyResultInput>): KeyResultInput => ({ id: "kr", metricType: "number", startValue: 0, targetValue: 10_000, currentValue: 0, milestones: null, weight: 1, confidence: null, ...over });
const goal = (id: string, over: Partial<GoalInput> = {}): GoalInput => ({ id, status: "active", weight: 1, finalProgressBp: null, keyResults: [], childIds: [], ...over });
const tree = (...goals: GoalInput[]) => new Map(goals.map((item) => [item.id, item]));

describe("keyResultProgressBp", () => {
  it("measures the distance from start to target", () => {
    expect(keyResultProgressBp(kr({ startValue: 2_000, targetValue: 10_000, currentValue: 5_000 }))).toBe(3750); // (50 − 20) / (100 − 20)
    expect(keyResultProgressBp(kr({ startValue: 0, targetValue: 300, currentValue: 100 }))).toBe(3333); // 1/3 → 33.33 %
    expect(keyResultProgressBp(kr({ startValue: 0, targetValue: 300, currentValue: 200 }))).toBe(6667); // 2/3 → 66.67 %, half rounds up
    expect(keyResultProgressBp(kr({ startValue: 0, targetValue: 20_000, currentValue: 1 }))).toBe(1); // 0.005 % → rounds up to 0.01 %
  });

  it("handles a metric that has to come down", () => {
    // Revision rounds per video from 4.00 to 2.00, now 2.50 → 75 %.
    expect(keyResultProgressBp(kr({ startValue: 400, targetValue: 200, currentValue: 250 }))).toBe(7500);
    expect(keyResultProgressBp(kr({ startValue: 400, targetValue: 200, currentValue: 450 }))).toBe(0); // got worse
    expect(keyResultProgressBp(kr({ startValue: 400, targetValue: 200, currentValue: 150 }))).toBe(10_000); // better than the target
  });

  it("clamps to 0 … 100 %", () => {
    expect(keyResultProgressBp(kr({ currentValue: 25_000 }))).toBe(10_000);
    expect(keyResultProgressBp(kr({ startValue: 5_000, currentValue: 1_000 }))).toBe(0);
  });

  it("treats start = target as reached or not", () => {
    expect(keyResultProgressBp(kr({ startValue: 9_500, targetValue: 9_500, currentValue: 9_600 }))).toBe(10_000);
    expect(keyResultProgressBp(kr({ startValue: 9_500, targetValue: 9_500, currentValue: 9_500 }))).toBe(10_000);
    expect(keyResultProgressBp(kr({ startValue: 9_500, targetValue: 9_500, currentValue: 9_400 }))).toBe(0);
  });

  it("keeps money exact at the size of a yearly revenue", () => {
    // 61,234,567,891 of 120,000,000,000 VND → 51.03 %
    expect(keyResultProgressBp(kr({ metricType: "currency", targetValue: 120_000_000_000, currentValue: 61_234_567_891 }))).toBe(5103);
  });

  it("counts milestones done", () => {
    const milestones = [{ title: "a", done: true }, { title: "b", done: true }, { title: "c", done: false }];
    expect(keyResultProgressBp(kr({ metricType: "milestone", milestones }))).toBe(6667);
    expect(keyResultProgressBp(kr({ metricType: "milestone", milestones: [] }))).toBe(0);
    expect(keyResultProgressBp(kr({ metricType: "milestone", milestones: null }))).toBe(0);
  });
});

describe("weightedAverageBp", () => {
  it("weights the lines and rounds halves up", () => {
    expect(weightedAverageBp([{ weight: 3, progressBp: 10_000 }, { weight: 1, progressBp: 0 }])).toBe(7500);
    expect(weightedAverageBp([{ weight: 1, progressBp: 3333 }, { weight: 1, progressBp: 3334 }])).toBe(3334); // 3333.5
    expect(weightedAverageBp([{ weight: 2, progressBp: null }, { weight: 1, progressBp: 4000 }])).toBe(4000);
    expect(weightedAverageBp([])).toBeNull();
    expect(weightedAverageBp([{ weight: 1, progressBp: null }])).toBeNull();
  });
});

describe("goalProgress", () => {
  it("averages a goal's own key results by weight and takes the worst confidence", () => {
    const goals = tree(
      goal("g", {
        keyResults: [kr({ id: "a", currentValue: 5_000, weight: 2, confidence: "on_track" }), kr({ id: "b", currentValue: 10_000, weight: 1, confidence: "at_risk" }), kr({ id: "c", currentValue: 0, weight: 1, confidence: null })],
      }),
    );
    expect(goalProgress("g", goals)).toEqual({
      progressBp: 5000, // (2 × 50 + 1 × 100 + 1 × 0) / 4
      confidence: "at_risk",
      source: "key_results",
      lines: [
        { kind: "key_result", id: "a", weight: 2, progressBp: 5000, skipped: null },
        { kind: "key_result", id: "b", weight: 1, progressBp: 10_000, skipped: null },
        { kind: "key_result", id: "c", weight: 1, progressBp: 0, skipped: null },
      ],
    });
  });

  it("ignores children for the number when the goal has key results of its own", () => {
    const goals = tree(goal("parent", { keyResults: [kr({ currentValue: 2_000 })], childIds: ["child"] }), goal("child", { keyResults: [kr({ currentValue: 10_000 })] }));
    expect(goalProgress("parent", goals).progressBp).toBe(2000);
  });

  it("rolls children up through several levels, leaving out cancelled, draft and unmeasured ones", () => {
    const goals = tree(
      goal("group", { childIds: ["entity-a", "entity-b"] }),
      goal("entity-a", { weight: 3, childIds: ["dept-1", "dept-2", "dept-cancelled", "dept-draft", "dept-empty"] }),
      goal("entity-b", { weight: 1, keyResults: [kr({ currentValue: 2_000, confidence: "on_track" })] }),
      goal("dept-1", { keyResults: [kr({ currentValue: 8_000, confidence: "off_track" })] }),
      goal("dept-2", { keyResults: [kr({ currentValue: 4_000, confidence: "on_track" })] }),
      goal("dept-cancelled", { status: "cancelled", keyResults: [kr({ currentValue: 0 })] }),
      goal("dept-draft", { status: "draft", keyResults: [kr({ currentValue: 0 })] }),
      goal("dept-empty"),
    );
    const entityA = goalProgress("entity-a", goals);
    expect(entityA.progressBp).toBe(6000); // (80 + 40) / 2
    expect(entityA.lines.map((line) => [line.id, line.progressBp, line.skipped])).toEqual([
      ["dept-1", 8000, null],
      ["dept-2", 4000, null],
      ["dept-cancelled", null, "cancelled"],
      ["dept-draft", null, "draft"],
      ["dept-empty", null, "not_measured"],
    ]);
    const group = goalProgress("group", goals);
    expect(group.progressBp).toBe(5000); // (3 × 60 + 1 × 20) / 4
    expect(group.source).toBe("children");
    expect(group.confidence).toBe("off_track");
  });

  it("gives nothing, not zero, for a goal with nothing to measure", () => {
    expect(goalProgress("g", tree(goal("g")))).toEqual({ progressBp: null, confidence: null, source: "none", lines: [] });
    expect(goalProgress("missing", tree())).toEqual({ progressBp: null, confidence: null, source: "none", lines: [] });
  });

  it("uses the frozen figure of a closed goal, also inside a parent's average", () => {
    const goals = tree(goal("parent", { childIds: ["closed", "open"] }), goal("closed", { status: "closed", finalProgressBp: 9000, keyResults: [kr({ currentValue: 1_000 })] }), goal("open", { keyResults: [kr({ currentValue: 5_000 })] }));
    expect(goalProgress("closed", goals)).toEqual({ progressBp: 9000, confidence: null, source: "frozen", lines: [] });
    expect(goalProgress("parent", goals).progressBp).toBe(7000);
  });

  it("survives a cycle in the data", () => {
    const goals = tree(goal("a", { childIds: ["b"] }), goal("b", { childIds: ["a", "c"] }), goal("c", { keyResults: [kr({ currentValue: 5_000 })] }));
    const result = goalProgress("a", goals);
    expect(result.progressBp).toBe(5000);
    // Seen from b: a leads straight back to b, so a has nothing to add; c still counts.
    expect(goalProgress("b", goals).lines.map((line) => [line.id, line.progressBp, line.skipped])).toEqual([["a", null, "not_measured"], ["c", 5000, null]]);
    expect(goalProgress("b", goals, new Set(["a"])).lines[0]).toMatchObject({ id: "a", skipped: "cycle" });
  });
});

describe("helpers", () => {
  it("finds the worst confidence", () => {
    expect(worstConfidence([null, "on_track", "off_track", "at_risk"])).toBe("off_track");
    expect(worstConfidence([null])).toBeNull();
  });

  it("flags key results of active goals without a check-in in the last week", () => {
    const now = new Date("2026-09-20T03:00:00Z");
    expect(isStale(null, "active", now)).toBe(true);
    expect(isStale("2026-09-14T03:00:00Z", "active", now)).toBe(false);
    expect(isStale("2026-09-12T03:00:00Z", "active", now)).toBe(true);
    expect(isStale(null, "draft", now)).toBe(false);
    expect(isStale(null, "closed", now)).toBe(false);
  });

  it("puts a date in its week (Monday)", () => {
    expect(weekStartOf("2026-09-20")).toBe("2026-09-14"); // a Sunday
    expect(weekStartOf("2026-09-21")).toBe("2026-09-21");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
  });

  it("reads and writes metric values as people type them", () => {
    expect(parseMetricValue("number", "12,5")).toBe(1250);
    expect(parseMetricValue("percent", "12.05")).toBe(1205);
    expect(parseMetricValue("number", "-3")).toBe(-300);
    expect(parseMetricValue("number", "1.234")).toBeNull();
    expect(parseMetricValue("currency", "1.500.000")).toBe(1_500_000);
    expect(parseMetricValue("currency", "1,500,000 ")).toBe(1_500_000);
    expect(parseMetricValue("currency", "1.5tr")).toBeNull();
    expect(metricValueText("number", 1250)).toBe("12,5");
    expect(metricValueText("percent", 1205)).toBe("12,05");
    expect(metricValueText("number", 300)).toBe("3");
    expect(metricValueText("currency", 1_500_000)).toBe("1500000");
  });
});
