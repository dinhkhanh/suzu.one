import { describe, expect, it } from "vitest";
import { daysUntil, recentJoiners, upcomingAnniversaries, upcomingBirthdays } from "./occasions";

describe("daysUntil", () => {
  it("counts to the next occurrence, today included", () => {
    expect(daysUntil(9, 20, "2026-09-20")).toBe(0);
    expect(daysUntil(9, 27, "2026-09-20")).toBe(7);
    expect(daysUntil(9, 19, "2026-09-20")).toBe(364);
  });
  it("wraps over the new year", () => {
    expect(daysUntil(1, 2, "2026-12-29")).toBe(4);
    expect(daysUntil(12, 31, "2026-12-29")).toBe(2);
  });
  it("celebrates 29 February on the 28th when the year has none", () => {
    expect(daysUntil(2, 29, "2027-02-25")).toBe(3);
    expect(daysUntil(2, 29, "2028-02-25")).toBe(4);
    // The day after the stand-in: the next one is the real 29th of the leap year.
    expect(daysUntil(2, 29, "2027-03-01")).toBe(365);
  });
});

describe("upcomingBirthdays", () => {
  const people = [
    { personId: "a", birthMonth: 9, birthDay: 22 },
    { personId: "b", birthMonth: 9, birthDay: 20 },
    { personId: "c", birthMonth: 10, birthDay: 5 },
    { personId: "d", birthMonth: null, birthDay: null },
    { personId: "e", birthMonth: 1, birthDay: 1 },
  ];
  it("keeps the window, soonest first, and returns day and month only", () => {
    expect(upcomingBirthdays(people, "2026-09-20", 7)).toEqual([
      { personId: "b", month: 9, day: 20, inDays: 0 },
      { personId: "a", month: 9, day: 22, inDays: 2 },
    ]);
  });
  it("sees across the year end", () => {
    expect(upcomingBirthdays(people, "2026-12-28", 7).map((row) => row.personId)).toEqual(["e"]);
  });
});

describe("upcomingAnniversaries", () => {
  it("counts whole years at the coming anniversary and skips the first day", () => {
    const people = [
      { personId: "five", seniorityDate: "2021-09-23" },
      { personId: "new", seniorityDate: "2026-09-21" },
      { personId: "far", seniorityDate: "2020-03-01" },
      { personId: "wrap", seniorityDate: "2024-01-02" },
    ];
    expect(upcomingAnniversaries(people, "2026-09-20", 7)).toEqual([{ personId: "five", month: 9, day: 23, inDays: 3, years: 5 }]);
    expect(upcomingAnniversaries(people, "2026-12-29", 7)).toEqual([{ personId: "wrap", month: 1, day: 2, inDays: 4, years: 3 }]);
  });
});

describe("recentJoiners", () => {
  it("keeps the last days, not the future", () => {
    const people = [
      { personId: "old", startDate: "2026-08-01" },
      { personId: "edge", startDate: "2026-09-06" },
      { personId: "today", startDate: "2026-09-20" },
      { personId: "soon", startDate: "2026-09-25" },
    ];
    expect(recentJoiners(people, "2026-09-20", 14).map((row) => row.personId)).toEqual(["today", "edge"]);
  });
});
