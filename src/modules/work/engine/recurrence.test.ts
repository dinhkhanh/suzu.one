import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrencesBetween, ruleProblems } from "./recurrence";

describe("occurrencesBetween", () => {
  it("daily: every n days counted from the start date, whatever the window", () => {
    expect(occurrencesBetween({ freq: "daily", interval: 1 }, "2026-09-18", "2026-09-20", "2026-09-22")).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(occurrencesBetween({ freq: "daily", interval: 3 }, "2026-09-01", "2026-09-05", "2026-09-14")).toEqual(["2026-09-07", "2026-09-10", "2026-09-13"]);
    // A window that opens before the start never reaches back past it.
    expect(occurrencesBetween({ freq: "daily", interval: 2 }, "2026-09-10", "2026-09-01", "2026-09-14")).toEqual(["2026-09-10", "2026-09-12", "2026-09-14"]);
  });

  it("weekly on weekdays: Monday, Wednesday, Friday", () => {
    // 2026-09-21 is a Monday.
    expect(occurrencesBetween({ freq: "weekly", interval: 1, weekdays: [5, 1, 3] }, "2026-09-16", "2026-09-16", "2026-09-27")).toEqual(["2026-09-16", "2026-09-18", "2026-09-21", "2026-09-23", "2026-09-25"]);
  });

  it("every second week, counted from the start date's week", () => {
    // Start on Thursday 2026-09-03: its week (from Monday 08-31) is week 0, so Mondays fall on 09-14, 09-28…
    expect(occurrencesBetween({ freq: "weekly", interval: 2, weekdays: [1] }, "2026-09-03", "2026-09-01", "2026-10-15")).toEqual(["2026-09-14", "2026-09-28", "2026-10-12"]);
  });

  it("monthly on a day: a short month gives its last day, a leap year its 29th", () => {
    expect(occurrencesBetween({ freq: "monthly", interval: 1, monthDay: 31 }, "2027-01-31", "2027-01-01", "2027-05-31")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    expect(occurrencesBetween({ freq: "monthly", interval: 1, monthDay: 30 }, "2028-01-01", "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"]);
    expect(occurrencesBetween({ freq: "monthly", interval: 1, monthDay: "last" }, "2028-01-15", "2028-01-01", "2028-03-31")).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("monthly: the day of the start month that has already passed is skipped; December rolls into January", () => {
    expect(occurrencesBetween({ freq: "monthly", interval: 1, monthDay: 5 }, "2026-11-10", "2026-11-01", "2027-02-10")).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
  });

  it("every quarter, counted from the start month", () => {
    expect(occurrencesBetween({ freq: "monthly", interval: 3, monthDay: 20 }, "2026-01-01", "2026-06-01", "2027-02-01")).toEqual(["2026-07-20", "2026-10-20", "2027-01-20"]);
  });

  it("returns nothing for an empty window or a broken rule, and respects the limit", () => {
    expect(occurrencesBetween({ freq: "daily", interval: 1 }, "2026-09-01", "2026-09-10", "2026-09-09")).toEqual([]);
    expect(occurrencesBetween({ freq: "weekly", interval: 1, weekdays: [] }, "2026-09-01", "2026-09-01", "2026-09-30")).toEqual([]);
    expect(occurrencesBetween({ freq: "daily", interval: 1 }, "2020-01-01", "2020-01-01", "2030-01-01", 10)).toHaveLength(10);
  });
});

describe("nextOccurrence", () => {
  it("finds the next date and stops at the end date", () => {
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [1] }, "2026-09-01", "2026-09-22")).toBe("2026-09-28");
    expect(nextOccurrence({ freq: "monthly", interval: 12, monthDay: 1 }, "2026-01-01", "2026-02-01")).toBe("2027-01-01");
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [1] }, "2026-09-01", "2026-09-22", "2026-09-25")).toBeNull();
  });
});

describe("ruleProblems", () => {
  it("names what is wrong", () => {
    expect(ruleProblems({ freq: "daily", interval: 0 })).toEqual(["bad_interval"]);
    expect(ruleProblems({ freq: "weekly", interval: 1, weekdays: [] })).toEqual(["no_weekdays"]);
    expect(ruleProblems({ freq: "weekly", interval: 1, weekdays: [0, 8] })).toEqual(["bad_weekday"]);
    expect(ruleProblems({ freq: "monthly", interval: 1, monthDay: 32 })).toEqual(["bad_month_day"]);
    expect(ruleProblems({ freq: "monthly", interval: 2, monthDay: "last" })).toEqual([]);
  });
});
