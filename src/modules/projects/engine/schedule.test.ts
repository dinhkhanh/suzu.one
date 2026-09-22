import { describe, expect, it } from "vitest";
import { addWorkingDays, criticalPath, isWorkingDay, planMove, shiftTask, workCalendar, workingDaysBetween, workingDuration } from "./schedule";

// October 2026: Thursday 1st. Weekends 3–4, 10–11, 17–18, 24–25, 31. A holiday on Friday 16th
// and a company day off on Monday 19th make a four-day weekend.
const office = workCalendar([1, 2, 3, 4, 5], ["2026-10-16", "2026-10-19"]);
// A studio that also works Saturdays.
const studio = workCalendar([1, 2, 3, 4, 5, 6], ["2026-10-16"]);

describe("working days (FR-PJM-07)", () => {
  it("skips the team's weekend and the entity's days off", () => {
    expect(isWorkingDay(office, "2026-10-02")).toBe(true);
    expect(isWorkingDay(office, "2026-10-03")).toBe(false);
    expect(isWorkingDay(office, "2026-10-16")).toBe(false);
    expect(isWorkingDay(studio, "2026-10-03")).toBe(true);
    expect(isWorkingDay(studio, "2026-10-04")).toBe(false);
  });
  it("counts forward and back over weekends and holidays", () => {
    expect(addWorkingDays(office, "2026-10-02", 1)).toBe("2026-10-05");
    expect(addWorkingDays(office, "2026-10-15", 1)).toBe("2026-10-20");
    expect(addWorkingDays(office, "2026-10-20", -1)).toBe("2026-10-15");
    expect(addWorkingDays(office, "2026-10-03", 1)).toBe("2026-10-05");
    expect(addWorkingDays(studio, "2026-10-02", 1)).toBe("2026-10-03");
    expect(addWorkingDays(office, "2026-10-08", 0)).toBe("2026-10-08");
  });
  it("measures a move in working days", () => {
    expect(workingDaysBetween(office, "2026-10-02", "2026-10-05")).toBe(1);
    expect(workingDaysBetween(office, "2026-10-15", "2026-10-20")).toBe(1);
    expect(workingDaysBetween(office, "2026-10-20", "2026-10-15")).toBe(-1);
    expect(workingDaysBetween(office, "2026-10-12", "2026-10-23")).toBe(7);
    expect(workingDuration(office, "2026-10-14", "2026-10-21")).toBe(4);
    expect(workingDuration(office, "2026-10-03", "2026-10-04")).toBe(1);
  });
  it("falls back to Monday–Friday for a team that works no day", () => {
    expect(workCalendar([], []).workingWeekdays).toEqual(new Set([1, 2, 3, 4, 5]));
  });
  it("shifts both ends of a task by working days", () => {
    expect(shiftTask(office, { startDate: "2026-10-14", dueDate: "2026-10-15" }, 2)).toEqual({ startDate: "2026-10-20", dueDate: "2026-10-21" });
    expect(shiftTask(office, { startDate: null, dueDate: "2026-10-09" }, 1)).toEqual({ startDate: null, dueDate: "2026-10-12" });
  });
});

describe("moving a task with dependents (FR-PJM-07)", () => {
  // Script → Storyboard → Shoot → Edit, plus Music that waits for the storyboard, and a
  // Thumbnail that waits for Script but has plenty of room.
  const tasks = [
    { id: "script", startDate: "2026-10-05", dueDate: "2026-10-07" },
    { id: "board", startDate: "2026-10-08", dueDate: "2026-10-09" },
    { id: "shoot", startDate: "2026-10-12", dueDate: "2026-10-13" },
    { id: "edit", startDate: "2026-10-20", dueDate: "2026-10-23" },
    { id: "music", startDate: null, dueDate: "2026-10-12" },
    { id: "thumb", startDate: "2026-10-26", dueDate: "2026-10-27" },
    { id: "undated", startDate: null, dueDate: null },
  ];
  const deps = [
    { blocker: "script", blocked: "board" },
    { blocker: "board", blocked: "shoot" },
    { blocker: "shoot", blocked: "edit" },
    { blocker: "board", blocked: "music" },
    { blocker: "script", blocked: "thumb" },
    { blocker: "script", blocked: "undated" },
  ];

  it("shifts the chain that would start too early by the same working days, and nothing with room", () => {
    // Script's end moves from Wed 7th to Fri 9th: two working days.
    const plan = planMove(office, tasks, deps, { taskId: "script", startDate: "2026-10-05", dueDate: "2026-10-09" });
    expect(plan.shiftDays).toBe(2);
    expect(plan.shifts).toEqual([
      { taskId: "board", from: { startDate: "2026-10-08", dueDate: "2026-10-09" }, to: { startDate: "2026-10-12", dueDate: "2026-10-13" } },
      { taskId: "shoot", from: { startDate: "2026-10-12", dueDate: "2026-10-13" }, to: { startDate: "2026-10-14", dueDate: "2026-10-15" } },
      { taskId: "music", from: { startDate: null, dueDate: "2026-10-12" }, to: { startDate: null, dueDate: "2026-10-14" } },
    ]);
    // Edit starts on the 20th, after the shoot now ends on the 15th: it keeps its dates, and so
    // does everything after it. The thumbnail and the undated task are never touched.
  });

  it("crosses the holiday weekend when a shift runs into it", () => {
    const plan = planMove(office, tasks, deps, { taskId: "shoot", startDate: "2026-10-12", dueDate: "2026-10-20" });
    // 13th → 20th is 3 working days: 14, 15, then the 16th–19th are off, and the 20th.
    expect(plan.shiftDays).toBe(3);
    expect(plan.shifts).toEqual([{ taskId: "edit", from: { startDate: "2026-10-20", dueDate: "2026-10-23" }, to: { startDate: "2026-10-23", dueDate: "2026-10-28" } }]);
  });

  it("pushes nothing when a task moves earlier or keeps its end", () => {
    expect(planMove(office, tasks, deps, { taskId: "script", startDate: "2026-10-01", dueDate: "2026-10-06" }).shifts).toEqual([]);
    expect(planMove(office, tasks, deps, { taskId: "script", startDate: "2026-10-06", dueDate: "2026-10-07" })).toMatchObject({ shiftDays: 0, shifts: [] });
  });

  it("follows the team's calendar: a Saturday is a working day for the studio", () => {
    const plan = planMove(studio, tasks, deps, { taskId: "script", startDate: "2026-10-05", dueDate: "2026-10-08" });
    expect(plan.shiftDays).toBe(1);
    expect(plan.shifts[0]).toEqual({ taskId: "board", from: { startDate: "2026-10-08", dueDate: "2026-10-09" }, to: { startDate: "2026-10-09", dueDate: "2026-10-10" } });
  });
});

describe("the critical path (C)", () => {
  it("marks the chain that holds up the end date, not work with slack", () => {
    const tasks = [
      { id: "script", startDate: "2026-10-05", dueDate: "2026-10-07", open: true },
      { id: "board", startDate: "2026-10-08", dueDate: "2026-10-09", open: true },
      { id: "shoot", startDate: "2026-10-12", dueDate: "2026-10-13", open: true },
      { id: "music", startDate: "2026-10-08", dueDate: "2026-10-08", open: true },
      { id: "edit", startDate: "2026-10-14", dueDate: "2026-10-15", open: true },
      { id: "done", startDate: "2026-10-01", dueDate: "2026-10-30", open: false },
    ];
    const deps = [
      { blocker: "script", blocked: "board" },
      { blocker: "board", blocked: "shoot" },
      { blocker: "shoot", blocked: "edit" },
      { blocker: "script", blocked: "music" },
      { blocker: "music", blocked: "edit" },
    ];
    expect(criticalPath(office, tasks, deps)).toEqual(new Set(["script", "board", "shoot", "edit"]));
  });
  it("is empty without dated open work", () => {
    expect(criticalPath(office, [{ id: "a", startDate: null, dueDate: null, open: true }], [])).toEqual(new Set());
  });
});
