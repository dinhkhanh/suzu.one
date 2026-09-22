// Golden figures for the KPI actuals proposed from work (FR-PJM-62): each metric in its stored
// scale, and a period with no basis proposing nothing rather than a zero.
import { describe, expect, it } from "vitest";
import { WORK_METRICS } from "../enums";
import { availableMinutesOf, EMPTY_WORK_FACTS, isProposalDay, periodRange, previousMonth, type WorkFacts, workMetricValue } from "./work-metrics";

const month: WorkFacts = { completedDated: 8, completedOnTime: 7, completedTasks: 9, revisionRounds: 12, deliverablesAccepted: 5, loggedMinutes: 7_392, availableMinutes: 10_560, reportsRequired: 22, reportsSubmitted: 20 };

describe("workMetricValue", () => {
  it("proposes each metric in its stored scale", () => {
    expect(workMetricValue("on_time_rate", month)).toBe(8750); // 7 of 8 = 87.5 %
    expect(workMetricValue("deliverables_accepted", month)).toBe(500); // 5, in hundredths
    expect(workMetricValue("utilisation", month)).toBe(7000); // 123.2 h of 176 h = 70 %
    expect(workMetricValue("revision_rounds_avg", month)).toBe(133); // 12 ÷ 9 = 1.33
    expect(workMetricValue("eod_compliance", month)).toBe(9091); // 20 of 22 = 90.91 %
  });

  it("proposes nothing where the period gives no basis — except a count, whose zero is real", () => {
    const values = Object.fromEntries(WORK_METRICS.map((metric) => [metric, workMetricValue(metric, EMPTY_WORK_FACTS)]));
    expect(values).toEqual({ on_time_rate: null, deliverables_accepted: 0, utilisation: null, revision_rounds_avg: null, eod_compliance: null });
  });

  it("never reports more than every required report", () => {
    expect(workMetricValue("eod_compliance", { ...month, reportsRequired: 3, reportsSubmitted: 5 })).toBe(10_000);
  });

  it("lets utilisation run over 100 % — overtime is the scorer's to judge", () => {
    expect(workMetricValue("utilisation", { ...month, loggedMinutes: 12_000 })).toBe(11_364);
  });
});

describe("availableMinutesOf", () => {
  it("counts working days and unscheduled weekdays, not Saturdays, rest days or holidays", () => {
    expect(
      availableMinutesOf([
        { date: "2026-09-01", kind: "working", minutes: 480 },
        { date: "2026-09-02", kind: "holiday", minutes: 480 },
        { date: "2026-09-03", kind: "working", minutes: 240 }, // half a day of leave
        { date: "2026-09-04", kind: "unscheduled", minutes: 480 },
        { date: "2026-09-05", kind: "unscheduled", minutes: 480 }, // a Saturday
        { date: "2026-09-06", kind: "rest", minutes: 480 },
        { date: "2026-09-12", kind: "untracked", minutes: 480 },
      ]),
    ).toBe(1200);
  });
});

describe("periods", () => {
  it("spans a month or a quarter", () => {
    expect(periodRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("2026-Q3")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("proposes for the month before, on the first three days only", () => {
    expect(previousMonth("2026-10-02")).toBe("2026-09");
    expect(previousMonth("2027-01-01")).toBe("2026-12");
    expect([1, 2, 3, 4, 28].map((day) => isProposalDay(`2026-10-${String(day).padStart(2, "0")}`))).toEqual([true, true, true, false, false]);
  });
});
