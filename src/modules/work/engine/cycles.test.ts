import { describe, expect, it } from "vitest";
import { cycleAt, cycleEnded, cycleNumbered, cycleProgress, cyclesToMake, cycleSummary, daysLeft, rolloverIds } from "./cycles";

// Bi-weekly cycles from Monday 7 September 2026.
const START = "2026-09-07";

describe("cycle dates (FR-PJM-10)", () => {
  it("numbers boxes from the rule's start, whatever day the job runs", () => {
    expect(cycleNumbered(START, 2, 1)).toEqual({ number: 1, startDate: "2026-09-07", endDate: "2026-09-20" });
    expect(cycleAt(START, 2, "2026-09-20")).toEqual({ number: 1, startDate: "2026-09-07", endDate: "2026-09-20" });
    expect(cycleAt(START, 2, "2026-09-21")).toEqual({ number: 2, startDate: "2026-09-21", endDate: "2026-10-04" });
    expect(cycleAt(START, 1, "2026-12-31")).toEqual({ number: 17, startDate: "2026-12-28", endDate: "2027-01-03" });
    expect(cycleAt(START, 2, "2026-09-06")).toBeNull();
    expect(cycleAt(START, 5, "2026-09-10")).toBeNull();
  });
  it("makes the current and the next cycle; before the start only the first; off makes none", () => {
    expect(cyclesToMake(START, 2, "2026-09-22").map((cycle) => cycle.number)).toEqual([2, 3]);
    expect(cyclesToMake(START, 2, "2026-08-30")).toEqual([{ number: 1, startDate: "2026-09-07", endDate: "2026-09-20" }]);
    expect(cyclesToMake(null, 2, "2026-09-22")).toEqual([]);
    expect(cyclesToMake(START, null, "2026-09-22")).toEqual([]);
  });
  it("ends after its last day; counts the days left", () => {
    const first = cycleNumbered(START, 2, 1);
    expect(cycleEnded(first, "2026-09-20")).toBe(false);
    expect(cycleEnded(first, "2026-09-21")).toBe(true);
    expect(daysLeft(first, "2026-09-20")).toBe(1);
    expect(daysLeft(first, "2026-09-14")).toBe(7);
    expect(daysLeft(first, "2026-09-30")).toBe(0);
  });
});

describe("cycle review and rollover", () => {
  const tasks = [
    { id: "a", status: "done" as const },
    { id: "b", status: "in_progress" as const },
    { id: "c", status: "todo" as const },
    { id: "d", status: "cancelled" as const },
    { id: "e", status: "done" as const },
  ];
  it("planned leaves cancelled work out; open work rolls", () => {
    expect(cycleSummary(tasks)).toEqual({ planned: 4, done: 2, rolled: 2 });
    expect(rolloverIds(tasks)).toEqual(["b", "c"]);
    expect(cycleProgress(tasks)).toEqual({ planned: 4, done: 2, percent: 50 });
    expect(cycleProgress([])).toEqual({ planned: 0, done: 0, percent: 0 });
  });
});
