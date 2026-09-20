import { describe, expect, it } from "vitest";
import { type Cadence, isoDayOfWeek, nextRunAfter, nextRunOnOrAfter, periodFor, type Schedule } from "./cadence";

const daily: Schedule = { cadence: "daily", dayOfWeek: null, dayOfMonth: null };
const weekly = (dayOfWeek: number): Schedule => ({ cadence: "weekly", dayOfWeek, dayOfMonth: null });
const monthly = (dayOfMonth: number): Schedule => ({ cadence: "monthly", dayOfWeek: null, dayOfMonth });

describe("isoDayOfWeek", () => {
  it("numbers Monday 1 and Sunday 7", () => {
    // 2027-01-04 is a Monday.
    expect(isoDayOfWeek("2027-01-04")).toBe(1);
    expect(isoDayOfWeek("2027-01-10")).toBe(7);
  });
});

describe("nextRunOnOrAfter", () => {
  it("runs a daily schedule today", () => {
    expect(nextRunOnOrAfter(daily, "2027-01-06")).toBe("2027-01-06");
  });

  it("runs a weekly schedule on its own day when that is today", () => {
    expect(nextRunOnOrAfter(weekly(3), "2027-01-06")).toBe("2027-01-06"); // Wednesday
  });

  it("walks a weekly schedule forward to its next day", () => {
    expect(nextRunOnOrAfter(weekly(1), "2027-01-06")).toBe("2027-01-11");
  });

  it("runs a monthly schedule later the same month", () => {
    expect(nextRunOnOrAfter(monthly(20), "2027-01-06")).toBe("2027-01-20");
  });

  it("moves a monthly schedule to next month once its day has passed", () => {
    expect(nextRunOnOrAfter(monthly(3), "2027-01-06")).toBe("2027-02-03");
  });

  it("rolls a December monthly schedule into January", () => {
    expect(nextRunOnOrAfter(monthly(3), "2027-12-06")).toBe("2028-01-03");
  });

  it("clamps day 31 to the last day of a short month", () => {
    expect(nextRunOnOrAfter(monthly(31), "2027-02-01")).toBe("2027-02-28");
    expect(nextRunOnOrAfter(monthly(31), "2028-02-01")).toBe("2028-02-29");
  });

  it("keeps asking for day 31 after a month that clamped it", () => {
    expect(nextRunAfter(monthly(31), "2027-02-28")).toBe("2027-03-31");
  });

  it("falls back to a sane day when the stored one is nonsense", () => {
    expect(nextRunOnOrAfter({ cadence: "weekly", dayOfWeek: 0, dayOfMonth: null }, "2027-01-06")).toBe("2027-01-11");
    expect(nextRunOnOrAfter({ cadence: "monthly", dayOfWeek: null, dayOfMonth: null }, "2027-01-06")).toBe("2027-02-01");
  });
});

describe("nextRunAfter", () => {
  it("never returns the day it ran", () => {
    for (const schedule of [daily, weekly(3), monthly(6)]) {
      expect(nextRunAfter(schedule, "2027-01-06") > "2027-01-06").toBe(true);
    }
  });

  it("puts a daily schedule on tomorrow", () => {
    expect(nextRunAfter(daily, "2027-01-06")).toBe("2027-01-07");
  });

  it("puts a weekly schedule a week on", () => {
    expect(nextRunAfter(weekly(3), "2027-01-06")).toBe("2027-01-13");
  });

  it("sends a late run once, then returns to the rhythm", () => {
    // Due on the 13th, the job did not run until the 16th: the next date is a week after the 16th,
    // not three more catch-up runs.
    expect(nextRunAfter(weekly(3), "2027-01-16")).toBe("2027-01-20");
  });
});

describe("periodFor", () => {
  const cases: [Cadence, string, { from: string; to: string }][] = [
    ["daily", "2027-01-06", { from: "2027-01-05", to: "2027-01-05" }],
    ["weekly", "2027-01-06", { from: "2026-12-30", to: "2027-01-05" }],
    ["monthly", "2027-03-01", { from: "2027-02-01", to: "2027-02-28" }],
    ["monthly", "2027-01-05", { from: "2026-12-01", to: "2026-12-31" }],
  ];
  it.each(cases)("%s report run on %s covers %o", (cadence, runOn, expected) => {
    expect(periodFor(cadence, runOn)).toEqual(expected);
  });

  it("never includes the day it is sent", () => {
    for (const cadence of ["daily", "weekly", "monthly"] as const) {
      expect(periodFor(cadence, "2027-06-15").to < "2027-06-15").toBe(true);
    }
  });
});
