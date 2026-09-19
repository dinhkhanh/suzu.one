import { describe, expect, it } from "vitest";
import { isMonthKey, monthGrid, placeByDueDate, shiftMonth } from "./calendar";

describe("month grid", () => {
  it("covers September 2026 with whole Monday-first weeks", () => {
    const grid = monthGrid("2026-09");
    expect(grid.from).toBe("2026-08-31");
    expect(grid.to).toBe("2026-10-04");
    expect(grid.weeks).toHaveLength(5);
    expect(grid.weeks[0].map((day) => day.inMonth)).toEqual([false, true, true, true, true, true, true]);
    expect(grid.weeks[4].at(-1)).toEqual({ date: "2026-10-04", inMonth: false });
  });

  it("needs six weeks when a 31-day month starts late in the week, four for February 2027", () => {
    expect(monthGrid("2026-08").weeks).toHaveLength(6);
    expect(monthGrid("2026-08").from).toBe("2026-07-27");
    const february = monthGrid("2027-02");
    expect(february.weeks).toHaveLength(4);
    expect([february.from, february.to]).toEqual(["2027-02-01", "2027-02-28"]);
  });

  it("moves across year ends", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-09")).toBe(true);
  });

  it("places tasks on their due date, urgent first", () => {
    const placed = placeByDueDate([
      { title: "b", dueDate: "2026-09-21", priority: null },
      { title: "a", dueDate: "2026-09-21", priority: 3 },
      { title: "c", dueDate: "2026-09-21", priority: 1 },
      { title: "undated", dueDate: null, priority: 1 },
    ]);
    expect(placed.get("2026-09-21")?.map((task) => task.title)).toEqual(["c", "a", "b"]);
    expect(placed.size).toBe(1);
  });
});
