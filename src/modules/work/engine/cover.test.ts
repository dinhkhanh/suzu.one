import { describe, expect, it } from "vitest";
import { coverOf, coverStartsOn, movesOnCover, needsCover, reconcileItems, selectCoverItems, workingDaysOf } from "./cover";

// Leave Wednesday 7 → Tuesday 13 October 2026: the leave module counts 5 working days (the weekend is not leave).
const absence = { from: "2026-10-07", to: "2026-10-13" };
const days = [{ amountCenti: 100 }, { amountCenti: 100 }, { amountCenti: 100 }, { amountCenti: 100 }, { amountCenti: 50 }];

describe("when a cover plan is asked for (FR-PJM-44)", () => {
  it("counts working days, half days as half", () => {
    expect(workingDaysOf(days)).toBe(4.5);
    expect(needsCover(4.5, 2)).toBe(true);
    expect(needsCover(1.5, 2)).toBe(false);
    expect(needsCover(2, 2)).toBe(true);
    // A team that set 0 still does not ask for a plan for no leave at all.
    expect(needsCover(0, 0)).toBe(false);
    expect(needsCover(1, 0)).toBe(true);
  });
});

describe("what goes into the plan", () => {
  it("tasks due in the absence or running through it, every waiting review, recurrences that come round, bookings of the weeks", () => {
    const selection = selectCoverItems(
      {
        tasks: [
          { id: "due-in", dueDate: "2026-10-09", startDate: null },
          { id: "due-first-day", dueDate: "2026-10-07", startDate: null },
          { id: "due-before", dueDate: "2026-10-06", startDate: null },
          { id: "due-after-running", dueDate: "2026-10-20", startDate: "2026-10-01" },
          { id: "due-after-not-started", dueDate: "2026-10-20", startDate: "2026-10-15" },
          { id: "undated", dueDate: null, startDate: null },
        ],
        reviews: [{ taskId: "review-1" }, { taskId: "review-1" }],
        recurrences: [
          { id: "weekly-monday", rule: { freq: "weekly", interval: 1, weekdays: [1] }, startDate: "2026-09-07", endDate: null },
          { id: "monthly-25th", rule: { freq: "monthly", interval: 1, monthDay: 25 }, startDate: "2026-01-25", endDate: null },
          { id: "ended", rule: { freq: "weekly", interval: 1, weekdays: [1] }, startDate: "2026-09-07", endDate: "2026-10-05" },
        ],
        bookings: [
          { id: "week-of-5th", weekStart: "2026-10-05" },
          { id: "week-of-12th", weekStart: "2026-10-12" },
          { id: "week-of-19th", weekStart: "2026-10-19" },
          { id: "week-of-28th-sep", weekStart: "2026-09-28" },
        ],
      },
      absence,
    );
    expect(selection).toEqual([
      { itemType: "task", itemId: "due-in" },
      { itemType: "task", itemId: "due-first-day" },
      { itemType: "task", itemId: "due-after-running" },
      { itemType: "review", itemId: "review-1" },
      { itemType: "recurrence", itemId: "weekly-monday" },
      { itemType: "booking", itemId: "week-of-5th" },
      { itemType: "booking", itemId: "week-of-12th" },
    ]);
  });
  it("a draft keeps what still fits, adds what is new, drops what no longer falls in unless a cover was named", () => {
    const current = [
      { id: "1", itemType: "task", itemId: "kept", coverPersonId: "huy" },
      { id: "2", itemType: "task", itemId: "gone", coverPersonId: null },
      { id: "3", itemType: "task", itemId: "gone-but-named", coverPersonId: "huy" },
    ];
    const { add, remove } = reconcileItems(current, [
      { itemType: "task", itemId: "kept" },
      { itemType: "review", itemId: "new" },
    ]);
    expect(add).toEqual([{ itemType: "review", itemId: "new" }]);
    expect(remove.map((item) => item.itemId)).toEqual(["gone"]);
  });
  it("a cover per item beats the one for all; bookings never move; reassignment waits for the first day", () => {
    expect(coverOf({ coverPersonId: "huy" }, "tam")).toBe("huy");
    expect(coverOf({ coverPersonId: null }, "tam")).toBe("tam");
    expect(coverOf({ coverPersonId: null }, null)).toBeNull();
    expect(movesOnCover("booking")).toBe(false);
    expect(movesOnCover("review")).toBe(true);
    expect(coverStartsOn(absence, "2026-10-06")).toBe(false);
    expect(coverStartsOn(absence, "2026-10-07")).toBe(true);
  });
});
