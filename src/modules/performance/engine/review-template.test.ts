// What makes a review form usable (FR-PRF-03), and the starter forms the seed writes (PRF-01).
import { describe, expect, it } from "vitest";
import type { RatingPoint, ReviewSection } from "../enums";
import { REVIEW_TEMPLATE_SEED } from "../seed-review-templates";
import { type TemplateDraft, templateProblems } from "./review-template";

const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: null, scoreBp: 5000 },
  { value: 2, label: "Đạt", labelEn: null, scoreBp: 10000 },
];
const RATED: ReviewSection = { key: "quality", title: "Chất lượng", titleEn: null, kind: "rating", weight: 2, required: true, askedOf: ["self", "manager"] };
const TEXT: ReviewSection = { key: "notes", title: "Ghi chú", titleEn: null, kind: "text", weight: 0, required: false, askedOf: ["self", "manager", "peer"] };
const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({ name: "Đánh giá năm", sections: [RATED, TEXT], ratingScale: SCALE, kinds: [], ...over });

describe("templateProblems", () => {
  it("passes a usable form", () => {
    expect(templateProblems(draft())).toEqual([]);
    expect(templateProblems(draft({ kinds: ["annual", "mid_year"] }))).toEqual([]);
  });

  it("names everything wrong, in the order a person would fix it", () => {
    expect(templateProblems(draft({ name: "  ", sections: [] }))).toEqual(["review_template_name_empty", "review_template_empty"]);
    expect(templateProblems(draft({ sections: [{ ...RATED, key: "Chất lượng" }] }))).toEqual(["review_template_bad_key"]);
    expect(templateProblems(draft({ sections: [RATED, { ...TEXT, key: "quality" }] }))).toEqual(["review_template_duplicate_key"]);
    expect(templateProblems(draft({ sections: [RATED, { ...TEXT, title: "" }] }))).toEqual(["review_template_untitled_section"]);
    expect(templateProblems(draft({ sections: [RATED, { ...TEXT, askedOf: [] }] }))).toEqual(["review_template_unasked_section"]);
    expect(templateProblems(draft({ sections: [{ ...RATED, weight: 1.5 }] }))).toContain("review_template_bad_section");
    expect(templateProblems(draft({ ratingScale: [SCALE[0]] }))).toEqual(["review_template_scale_short"]);
    expect(templateProblems(draft({ ratingScale: [SCALE[0], { ...SCALE[1], value: 1 }] }))).toEqual(["review_template_duplicate_point"]);
    expect(templateProblems(draft({ ratingScale: [SCALE[0], { ...SCALE[1], label: "" }] }))).toEqual(["review_template_bad_point"]);
    expect(templateProblems(draft({ ratingScale: [SCALE[0], { ...SCALE[1], scoreBp: Number.NaN }] }))).toEqual(["review_template_bad_point"]);
    expect(templateProblems(draft({ kinds: ["yearly" as never] }))).toEqual(["review_template_bad_kind"]);
  });

  it("refuses a form that scores nothing, and a manager's form of prose alone", () => {
    expect(templateProblems(draft({ sections: [TEXT] }))).toEqual(["review_template_unscored"]);
    // A scored question nobody's manager is asked: the manager's figure — the one the year's result reads — would be empty.
    expect(templateProblems(draft({ sections: [{ ...RATED, askedOf: ["self", "peer"] }, TEXT] }))).toEqual(["review_template_manager_unscored"]);
    // A text question with a weight scores nothing either.
    expect(templateProblems(draft({ sections: [{ ...TEXT, weight: 5 }] }))).toEqual(["review_template_unscored"]);
  });
});

describe("the starter forms (PRF-01)", () => {
  it("are all usable, one per kind of cycle, with keys the seed never repeats", () => {
    for (const seed of REVIEW_TEMPLATE_SEED) expect(templateProblems(seed), seed.seedKey).toEqual([]);
    expect(REVIEW_TEMPLATE_SEED.flatMap((seed) => seed.kinds).sort()).toEqual(["annual", "mid_year", "probation"]);
    expect(new Set(REVIEW_TEMPLATE_SEED.map((seed) => seed.seedKey)).size).toBe(REVIEW_TEMPLATE_SEED.length);
  });

  it("make “meets expectations” worth exactly 100 % and weigh the scored questions to 100", () => {
    for (const seed of REVIEW_TEMPLATE_SEED) {
      expect(
        seed.ratingScale.filter((point) => point.scoreBp === 10000),
        seed.seedKey,
      ).toHaveLength(1);
      expect(
        seed.sections.filter((section) => section.kind === "rating").reduce((sum, section) => sum + section.weight, 0),
        seed.seedKey,
      ).toBe(100);
    }
  });
});
