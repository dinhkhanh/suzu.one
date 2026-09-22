import { describe, expect, it } from "vitest";
import { availableMinutes, lastWeeks, personWeeks, type ScheduledDay, totalOf, UNSCHEDULED_DAY_MINUTES } from "./utilisation";

// 2026-09-21 is a Monday; 2026-09-26 the untracked Saturday.
const W = "2026-09-21";
const dates = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
const fullTime = (overrides: Partial<Record<string, Partial<ScheduledDay>>> = {}): ScheduledDay[] =>
  dates.map((date, index) => ({ date, kind: index < 5 ? "working" : index === 5 ? "untracked" : "rest", requiredMinutes: index < 5 ? 480 : 0, leaveCenti: 0, ...overrides[date] }));

describe("hours available", () => {
  it("a working day is its schedule; untracked Saturdays, rest days and holidays are none", () => {
    expect(availableMinutes({ date: W, kind: "working", requiredMinutes: 480, leaveCenti: 0 })).toBe(480);
    expect(availableMinutes({ date: "2026-09-26", kind: "untracked", requiredMinutes: 0, leaveCenti: 0 })).toBe(0);
    expect(availableMinutes({ date: "2026-09-27", kind: "rest", requiredMinutes: 0, leaveCenti: 0 })).toBe(0);
    expect(availableMinutes({ date: "2026-09-02", kind: "holiday", requiredMinutes: 0, leaveCenti: 0 })).toBe(0);
    expect(availableMinutes({ date: W, kind: "company_off", requiredMinutes: 0, leaveCenti: 0 })).toBe(0);
  });

  it("leave takes its share off the day", () => {
    expect(availableMinutes({ date: W, kind: "working", requiredMinutes: 480, leaveCenti: 50 })).toBe(240);
    expect(availableMinutes({ date: W, kind: "working", requiredMinutes: 480, leaveCenti: 100 })).toBe(0);
    // Two half-day requests on one day never take more than the day.
    expect(availableMinutes({ date: W, kind: "working", requiredMinutes: 480, leaveCenti: 150 })).toBe(0);
  });

  it("nobody scheduled the person: eight hours on weekdays", () => {
    expect(availableMinutes({ date: W, kind: "unscheduled", requiredMinutes: 0, leaveCenti: 0 })).toBe(UNSCHEDULED_DAY_MINUTES);
    expect(availableMinutes({ date: "2026-09-26", kind: "unscheduled", requiredMinutes: 0, leaveCenti: 0 })).toBe(0);
  });
});

describe("a person's weeks", () => {
  it("full time: 32 h logged of 40 h is 80 %, three quarters billable", () => {
    const [week] = personWeeks([W], fullTime(), new Map([[W, { minutes: 32 * 60, billable: 24 * 60 }]]));
    expect(week).toEqual({ available: 2400, logged: 1920, billable: 1440, ratio: 0.8, billableRatio: 0.75 });
  });

  it("a day and a half of leave and a holiday shrink the week", () => {
    const days = fullTime({ "2026-09-22": { leaveCenti: 100 }, "2026-09-23": { leaveCenti: 50 }, "2026-09-24": { kind: "holiday", requiredMinutes: 0 } });
    const [week] = personWeeks([W], days, new Map([[W, { minutes: 960, billable: 0 }]]));
    // Monday 8 + Wednesday 4 + Friday 8 = 20 h available; 16 h logged.
    expect(week.available).toBe(1200);
    expect(week.ratio).toBe(0.8);
    expect(week.billableRatio).toBe(0);
  });

  it("part time: four hours a day", () => {
    const days = fullTime(Object.fromEntries(dates.slice(0, 5).map((date) => [date, { requiredMinutes: 240 }])));
    const [week] = personWeeks([W], days, new Map([[W, { minutes: 1200, billable: 600 }]]));
    expect(week).toMatchObject({ available: 1200, ratio: 1, billableRatio: 0.5 });
  });

  it("a week of leave has no ratio; a week with nothing logged has no billable ratio", () => {
    const away = fullTime(Object.fromEntries(dates.slice(0, 5).map((date) => [date, { leaveCenti: 100 }])));
    expect(personWeeks([W], away, new Map())[0]).toEqual({ available: 0, logged: 0, billable: 0, ratio: null, billableRatio: null });
    expect(personWeeks([W], fullTime(), new Map())[0]).toMatchObject({ ratio: 0, billableRatio: null });
  });

  it("the week in progress counts the days behind it", () => {
    // Wednesday: Monday to Wednesday are 24 h.
    const [week] = personWeeks([W], fullTime(), new Map([[W, { minutes: 1080, billable: 0 }]]), "2026-09-23");
    expect(week).toMatchObject({ available: 1440, ratio: 0.75 });
  });

  it("time logged on an untracked Saturday counts; the Saturday adds no hours", () => {
    const [week] = personWeeks([W], fullTime(), new Map([[W, { minutes: 2400 + 240, billable: 0 }]]));
    expect(week.ratio).toBe(1.1);
  });
});

describe("a team's week", () => {
  it("is the sum of its people's, not an average of ratios", () => {
    const total = totalOf([
      { available: 2400, logged: 2400, billable: 2400, ratio: 1, billableRatio: 1 },
      { available: 1200, logged: 0, billable: 0, ratio: 0, billableRatio: null },
    ]);
    expect(total).toEqual({ available: 3600, logged: 2400, billable: 2400, ratio: 2400 / 3600, billableRatio: 1 });
    expect(totalOf([])).toMatchObject({ ratio: null, billableRatio: null });
  });
});

describe("the last weeks", () => {
  it("counts back from this week's Monday, oldest first", () => {
    expect(lastWeeks("2026-09-24", 3)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(lastWeeks("2026-09-27", 1)).toEqual(["2026-09-21"]);
    expect(lastWeeks("2026-01-05", 2)).toEqual(["2025-12-29", "2026-01-05"]);
  });
});
