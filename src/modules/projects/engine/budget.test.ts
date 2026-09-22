import { describe, expect, it } from "vitest";
import { alertsDue, budgetBurn, remainingOf, totalOfRoles } from "./budget";

describe("budget burn (FR-PJM-09)", () => {
  it("adds the open estimates to what was logged", () => {
    expect(budgetBurn({ loggedMinutes: 3600, remainingMinutes: 1800, budgetMinutes: 6000 })).toEqual({ loggedMinutes: 3600, remainingMinutes: 1800, burnMinutes: 5400, budgetMinutes: 6000, percent: 90, loggedPercent: 60, level: "warning" });
    expect(budgetBurn({ loggedMinutes: 6000, remainingMinutes: 0, budgetMinutes: 6000 }).level).toBe("over");
    expect(budgetBurn({ loggedMinutes: 100, remainingMinutes: 0, budgetMinutes: 6000 }).level).toBe("ok");
    expect(budgetBurn({ loggedMinutes: 100, remainingMinutes: 50, budgetMinutes: null })).toMatchObject({ burnMinutes: 150, percent: null, level: "none" });
    expect(budgetBurn({ loggedMinutes: 100, remainingMinutes: 0, budgetMinutes: 0 }).percent).toBeNull();
  });
  it("counts what is left of a task's estimate, never below zero", () => {
    expect(remainingOf(600, 240)).toBe(360);
    expect(remainingOf(600, 900)).toBe(0);
    expect(remainingOf(null, 60)).toBe(0);
  });
  it("alerts at 80% and 100% once each", () => {
    expect(alertsDue(79, [])).toEqual([]);
    expect(alertsDue(80, [])).toEqual([80]);
    expect(alertsDue(95, [80])).toEqual([]);
    expect(alertsDue(110, [])).toEqual([80, 100]);
    expect(alertsDue(120, [80, 100])).toEqual([]);
    expect(alertsDue(null, [])).toEqual([]);
  });
  it("totals a budget by role", () => {
    expect(totalOfRoles([{ minutes: 2400 }, { minutes: 600 }, { minutes: -5 }])).toBe(3000);
  });
});
