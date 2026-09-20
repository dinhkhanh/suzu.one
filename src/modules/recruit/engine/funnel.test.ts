import { describe, expect, it } from "vitest";
import type { CandidateSource, StageCategory } from "../enums";
import { type FunnelApplication, funnelReport, funnelSteps, furthestIndex, median, sourceEffectiveness, timeToHire } from "./funnel";

const app = (category: StageCategory, status: FunnelApplication["status"] = "active", extra: Partial<FunnelApplication> = {}): FunnelApplication => ({
  category,
  status,
  source: "careers_page",
  daysToHire: null,
  ...extra,
});

const stepFor = (steps: ReturnType<typeof funnelSteps>, category: StageCategory) => steps.find((step) => step.category === category)!;

describe("furthestIndex", () => {
  it("reads how far an application got from the stage it stands in", () => {
    expect(furthestIndex(app("applied"))).toBe(0);
    expect(furthestIndex(app("interview"))).toBeGreaterThan(furthestIndex(app("screening")));
  });

  it("counts a rejection at the stage it was rejected at", () => {
    // The whole reason a rejection keeps its stage: this is where the person fell out.
    expect(furthestIndex(app("interview", "rejected"))).toBe(furthestIndex(app("interview")));
  });

  it("counts a hire as having reached the end, whatever column the card sits in", () => {
    expect(furthestIndex(app("offer", "hired"))).toBe(furthestIndex(app("hired")));
  });
});

describe("funnelSteps", () => {
  const applications = [
    app("applied"),
    app("applied", "rejected"),
    app("screening"),
    app("interview", "rejected"),
    app("offer"),
    app("hired", "hired", { daysToHire: 30 }),
  ];

  it("counts everybody who got at least that far", () => {
    const steps = funnelSteps(applications);
    expect(stepFor(steps, "applied").reached).toBe(6);
    expect(stepFor(steps, "screening").reached).toBe(4);
    expect(stepFor(steps, "interview").reached).toBe(3);
    expect(stepFor(steps, "offer").reached).toBe(2);
    expect(stepFor(steps, "hired").reached).toBe(1);
  });

  it("is monotonically non-increasing — a funnel cannot widen", () => {
    const reached = funnelSteps(applications).map((step) => step.reached);
    for (let index = 1; index < reached.length; index++) expect(reached[index]).toBeLessThanOrEqual(reached[index - 1]);
  });

  it("converts from the step before, not from the top", () => {
    const steps = funnelSteps(applications);
    expect(stepFor(steps, "applied").conversionFromPrevious).toBeNull();
    // 3 of the 4 that reached screening reached interview.
    expect(stepFor(steps, "interview").conversionFromPrevious).toBe(75);
    expect(stepFor(steps, "interview").shareOfApplied).toBe(50);
  });

  it("answers zeroes rather than dividing by nothing", () => {
    const steps = funnelSteps([]);
    expect(steps).toHaveLength(6);
    expect(steps.every((step) => step.reached === 0 && step.shareOfApplied === 0)).toBe(true);
  });
});

describe("median", () => {
  it("is the middle of an odd list and the mean of the middle two of an even one", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("is null for nothing at all", () => {
    expect(median([])).toBeNull();
  });
});

describe("timeToHire", () => {
  it("counts only the hires, and only the ones whose days are known", () => {
    const report = timeToHire([app("hired", "hired", { daysToHire: 20 }), app("hired", "hired", { daysToHire: 40 }), app("hired", "hired"), app("offer", "rejected", { daysToHire: 5 })]);
    expect(report).toMatchObject({ hires: 2, median: 30, mean: 30, fastest: 20, slowest: 40 });
  });

  it("says nothing rather than zero when nobody has been hired", () => {
    expect(timeToHire([app("interview")])).toEqual({ hires: 0, median: null, mean: null, fastest: null, slowest: null });
  });
});

describe("sourceEffectiveness", () => {
  const source = (name: CandidateSource, status: FunnelApplication["status"], category: StageCategory, daysToHire: number | null = null) => app(category, status, { source: name, daysToHire });

  it("counts applications, interviews and hires per source", () => {
    const rows = sourceEffectiveness([
      source("referral", "hired", "hired", 25),
      source("referral", "rejected", "interview"),
      source("careers_page", "rejected", "applied"),
      source("careers_page", "active", "screening"),
    ]);
    const referral = rows.find((row) => row.source === "referral")!;
    expect(referral).toMatchObject({ applications: 2, interviewed: 2, hires: 1, hireRate: 50, medianDaysToHire: 25 });
    const careers = rows.find((row) => row.source === "careers_page")!;
    expect(careers).toMatchObject({ applications: 2, interviewed: 0, hires: 0, hireRate: 0, medianDaysToHire: null });
  });

  it("puts the sources that produced colleagues first", () => {
    const rows = sourceEffectiveness([source("job_board", "active", "applied"), source("job_board", "active", "applied"), source("referral", "hired", "hired", 10)]);
    expect(rows[0].source).toBe("referral");
  });
});

describe("funnelReport", () => {
  it("brings the three together and counts the outcomes", () => {
    const report = funnelReport([app("applied", "rejected"), app("screening"), app("interview", "withdrawn"), app("hired", "hired", { daysToHire: 12 })]);
    expect(report).toMatchObject({ applications: 4, active: 1, rejected: 1, withdrawn: 1 });
    expect(report.timeToHire.hires).toBe(1);
    expect(report.steps).toHaveLength(6);
    expect(report.sources).toHaveLength(1);
  });
});
