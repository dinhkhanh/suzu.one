import { describe, expect, it } from "vitest";
import type { RatingPoint, ReviewFormShape, ReviewSection } from "../enums";
import { missingRequired, scoreReviewForm } from "./review-score";

// A five-point scale where "meets expectations" is worth exactly 100 %: the mapping is the
// company's to set, which is why it lives in the template and not in the code.
const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: "Below", scoreBp: 4000 },
  { value: 2, label: "Cần cải thiện", labelEn: "Needs improvement", scoreBp: 7000 },
  { value: 3, label: "Đạt yêu cầu", labelEn: "Meets", scoreBp: 10000 },
  { value: 4, label: "Vượt mong đợi", labelEn: "Exceeds", scoreBp: 11500 },
  { value: 5, label: "Xuất sắc", labelEn: "Outstanding", scoreBp: 13000 },
];

const section = (key: string, over: Partial<ReviewSection> = {}): ReviewSection => ({ key, title: key, titleEn: null, kind: "rating", weight: 1, required: false, askedOf: ["self", "manager", "peer"], ...over });

const shape: ReviewFormShape = {
  ratingScale: SCALE,
  sections: [
    section("quality", { weight: 3 }),
    section("teamwork", { weight: 2 }),
    section("initiative", { weight: 1, askedOf: ["manager"] }),
    section("highlights", { kind: "text", weight: 0, required: true }),
    section("private_note", { kind: "text", weight: 0, askedOf: ["manager"] }),
  ],
};

describe("scoreReviewForm", () => {
  it("weights the rating sections asked of this form and nothing else", () => {
    const trace = scoreReviewForm(shape, "manager", { quality: 4, teamwork: 3, initiative: 5, highlights: "Good year.", private_note: "n/a" });
    // (3 × 11500 + 2 × 10000 + 1 × 13000) / 6 = 67500 / 6 = 11250
    expect(trace.scoreBp).toBe(11250);
    expect(trace.countedWeight).toBe(6);
    expect(trace.totalWeight).toBe(6);
    expect(trace.notes).toEqual([]);
    expect(trace.lines.map((line) => line.key)).toEqual(["quality", "teamwork", "initiative", "highlights", "private_note"]);
    // The contributions add up to the score, so the trace explains the figure on its own.
    expect(trace.lines.filter((line) => line.counted).reduce((sum, line) => sum + line.contributionBp!, 0)).toBe(11250);
    expect(trace.lines.find((line) => line.key === "highlights")!.flags).toEqual(["not_rated"]);
  });

  it("leaves a self form's manager-only sections out entirely", () => {
    const trace = scoreReviewForm(shape, "self", { quality: 3, teamwork: 3, initiative: 5, highlights: "x" });
    expect(trace.lines.map((line) => line.key)).toEqual(["quality", "teamwork", "highlights"]);
    expect(trace.scoreBp).toBe(10000);
    expect(trace.totalWeight).toBe(5);
  });

  it("hands an unanswered section's weight to the others rather than scoring it zero", () => {
    const trace = scoreReviewForm(shape, "manager", { quality: 5, teamwork: "", initiative: 3 });
    // (3 × 13000 + 1 × 10000) / 4 = 49000 / 4 = 12250
    expect(trace.scoreBp).toBe(12250);
    expect(trace.countedWeight).toBe(4);
    expect(trace.totalWeight).toBe(6);
    expect(trace.notes).toContain("renormalised");
    expect(trace.lines.find((line) => line.key === "teamwork")!.flags).toEqual(["unanswered"]);
  });

  it("reads a rating posted as a string, and flags one that is not on the scale", () => {
    // (3 × 11500 + 2 × 10000) / 5 = 54500 / 5 = 10900
    expect(scoreReviewForm(shape, "self", { quality: "4", teamwork: "3" }).scoreBp).toBe(10900);
    const off = scoreReviewForm(shape, "self", { quality: 9, teamwork: 3 });
    expect(off.lines.find((line) => line.key === "quality")!.flags).toEqual(["off_scale"]);
    expect(off.scoreBp).toBe(10000);
    expect(off.notes).toContain("off_scale_answers");
  });

  it("says nothing rather than zero when nothing was rated", () => {
    const trace = scoreReviewForm(shape, "self", { highlights: "only prose" });
    expect(trace.scoreBp).toBeNull();
    expect(trace.notes).toEqual(["nothing_rated"]);
  });

  it("rounds halves up and stays in integers", () => {
    const odd: ReviewFormShape = { ratingScale: SCALE, sections: [section("a", { weight: 1 }), section("b", { weight: 2 })] };
    // (1 × 4000 + 2 × 7000) / 3 = 18000 / 3 = 6000 exactly
    expect(scoreReviewForm(odd, "self", { a: 1, b: 2 }).scoreBp).toBe(6000);
    // (1 × 10000 + 2 × 11500) / 3 = 33000 / 3 = 11000
    expect(scoreReviewForm(odd, "self", { a: 3, b: 4 }).scoreBp).toBe(11000);
    // (1 × 7000 + 2 × 10000) / 3 = 27000 / 3 = 9000
    expect(scoreReviewForm(odd, "self", { a: 2, b: 3 }).scoreBp).toBe(9000);
    // A genuine half: (1 × 4000 + 2 × 11500) / 3 = 27000/3 = 9000; use a 2-line odd split instead.
    const half: ReviewFormShape = { ratingScale: [{ value: 1, label: "x", labelEn: null, scoreBp: 10001 }, { value: 2, label: "y", labelEn: null, scoreBp: 10000 }], sections: [section("a"), section("b")] };
    // (10001 + 10000) / 2 = 10000.5 → 10001
    expect(scoreReviewForm(half, "self", { a: 1, b: 2 }).scoreBp).toBe(10001);
  });
});

describe("missingRequired", () => {
  it("names the required sections of this form that are blank", () => {
    expect(missingRequired(shape, "manager", { quality: 3 })).toEqual(["highlights"]);
    expect(missingRequired(shape, "manager", { highlights: "   " })).toEqual(["highlights"]);
    expect(missingRequired(shape, "manager", { highlights: "done" })).toEqual([]);
    // A required section nobody is asked on this form does not block it.
    const managerOnly: ReviewFormShape = { ...shape, sections: [section("only", { kind: "text", required: true, askedOf: ["manager"] }), section("q")] };
    expect(missingRequired(managerOnly, "self", {})).toEqual([]);
    expect(missingRequired(managerOnly, "manager", {})).toEqual(["only"]);
  });
});
