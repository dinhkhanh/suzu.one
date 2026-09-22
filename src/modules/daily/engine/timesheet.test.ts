import { describe, expect, it } from "vitest";
import { stopTimer, TIMER_CAP_MINUTES, vietnamDateOf } from "./timer";
import { attendanceHint, buildWeekGrid, type GridEntry, isWeekEditable, parseRowKey, planCellChange, rowsToCopy, transition } from "./timesheet";

// 2026-09-21 is a Monday.
const W = "2026-09-21";
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const at = (minute: number) => new Date(Date.UTC(2026, 8, 21, 3, minute));
const entry = (id: string, date: string, minutes: number, extra: Partial<GridEntry> = {}): GridEntry => ({ id, date, taskId: "t1", category: null, minutes, billable: false, createdAt: at(Number(id.replace(/\D/g, "")) || 0), ...extra });

describe("the timer", () => {
  it("rounds to the nearest minute", () => {
    expect(stopTimer(vn(W, "09:00"), new Date(vn(W, "09:47").getTime() + 29_000))).toEqual({ date: W, minutes: 47, capped: false });
    expect(stopTimer(vn(W, "09:00"), new Date(vn(W, "09:47").getTime() + 30_000))).toEqual({ date: W, minutes: 48, capped: false });
    // Under half a minute is nothing.
    expect(stopTimer(vn(W, "09:00"), new Date(vn(W, "09:00").getTime() + 20_000)).minutes).toBe(0);
  });

  it("across midnight the entry belongs to the start date, Vietnam time", () => {
    // 22:30 Monday to 01:15 Tuesday: 165 minutes of Monday evening.
    expect(stopTimer(vn(W, "22:30"), vn("2026-09-22", "01:15"))).toEqual({ date: W, minutes: 165, capped: false });
    // 06:30 Tuesday in Vietnam is still Monday in UTC: the Vietnam date wins.
    expect(vietnamDateOf(vn("2026-09-22", "06:30"))).toBe("2026-09-22");
  });

  it("a timer left running is cut at 16 hours, with a flag", () => {
    expect(stopTimer(vn(W, "09:00"), vn("2026-09-22", "01:00"))).toEqual({ date: W, minutes: 16 * 60, capped: false });
    expect(stopTimer(vn(W, "09:00"), vn("2026-09-23", "10:00"))).toEqual({ date: W, minutes: TIMER_CAP_MINUTES, capped: true });
  });

  it("a clock that went backwards records nothing", () => {
    expect(stopTimer(vn(W, "10:00"), vn(W, "09:00")).minutes).toBe(0);
  });
});

describe("the week grid", () => {
  const entries: GridEntry[] = [
    entry("e1", W, 90, { billable: true }),
    entry("e2", W, 30, { billable: true }),
    entry("e3", "2026-09-22", 120, { taskId: "t2", billable: true }),
    entry("e4", "2026-09-22", 45, { taskId: null, category: "admin" }),
    entry("e5", "2026-09-26", 60, { taskId: null, category: "admin" }),
    // Last week's: not in this grid.
    entry("e6", "2026-09-18", 480),
  ];

  it("sums rows, days and the week", () => {
    const grid = buildWeekGrid(W, entries);
    expect(grid.dates).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(grid.rows.map((row) => [row.key, row.cells, row.total, row.billable])).toEqual([
      ["task:t1", [120, 0, 0, 0, 0, 0, 0], 120, 120],
      ["task:t2", [0, 120, 0, 0, 0, 0, 0], 120, 120],
      ["category:admin", [0, 45, 0, 0, 0, 60, 0], 105, 0],
    ]);
    expect(grid.dayTotals).toEqual([120, 165, 0, 0, 0, 60, 0]);
    expect(grid.total).toBe(345);
    expect(grid.billable).toBe(240);
  });

  it("adds empty rows copied from last week, once", () => {
    const copy = rowsToCopy(
      [
        { taskId: "t1", category: null },
        { taskId: "t9", category: null },
        { taskId: null, category: "training" },
        { taskId: "t9", category: null },
      ],
      entries,
    );
    expect(copy).toEqual(["task:t9", "category:training"]);
    const grid = buildWeekGrid(W, entries, copy);
    expect(grid.rows.map((row) => row.key)).toEqual(["task:t1", "task:t2", "category:admin", "task:t9", "category:training"]);
    expect(grid.rows.at(-1)).toMatchObject({ total: 0, cells: [0, 0, 0, 0, 0, 0, 0] });
    expect(grid.total).toBe(345);
  });

  it("reads row keys", () => {
    expect(parseRowKey("task:abc")).toEqual({ taskId: "abc", category: null });
    expect(parseRowKey("category:idle")).toEqual({ taskId: null, category: "idle" });
    expect(parseRowKey("nonsense")).toBeNull();
  });
});

describe("typing a total into a cell", () => {
  const cell = [
    { id: "a", minutes: 60, createdAt: at(1) },
    { id: "b", minutes: 30, createdAt: at(2) },
  ];

  it("an empty cell gets one entry; the same total changes nothing", () => {
    expect(planCellChange([], 90)).toEqual({ updates: [], deletes: [], insert: 90 });
    expect(planCellChange([], 0)).toEqual({ updates: [], deletes: [], insert: null });
    expect(planCellChange(cell, 90)).toEqual({ updates: [], deletes: [], insert: null });
  });

  it("more time goes on the newest entry", () => {
    expect(planCellChange(cell, 120)).toEqual({ updates: [{ id: "b", minutes: 60 }], deletes: [], insert: null });
  });

  it("less time comes off the newest first, removing what reaches nothing", () => {
    expect(planCellChange(cell, 75)).toEqual({ updates: [{ id: "b", minutes: 15 }], deletes: [], insert: null });
    expect(planCellChange(cell, 45)).toEqual({ updates: [{ id: "a", minutes: 45 }], deletes: ["b"], insert: null });
    expect(planCellChange(cell, 0)).toEqual({ updates: [], deletes: ["b", "a"], insert: null });
  });
});

describe("the approval states", () => {
  it("open → submitted → approved, and locked", () => {
    expect(transition("open", { type: "submit" })).toEqual({ ok: true, status: "submitted" });
    expect(transition("submitted", { type: "approve" })).toEqual({ ok: true, status: "approved" });
    expect(isWeekEditable(null)).toBe(true);
    expect(isWeekEditable("open")).toBe(true);
    expect(isWeekEditable("submitted")).toBe(false);
    expect(isWeekEditable("approved")).toBe(false);
  });

  it("returned needs a comment, and is open to fix and submit again", () => {
    expect(transition("submitted", { type: "return", comment: "  " })).toEqual({ ok: false, error: "timesheet_comment_required" });
    expect(transition("submitted", { type: "return", comment: "Thiếu thứ Tư" })).toEqual({ ok: true, status: "returned" });
    expect(isWeekEditable("returned")).toBe(true);
    expect(transition("returned", { type: "submit" })).toEqual({ ok: true, status: "submitted" });
  });

  it("only an approved week reopens, and only with a reason", () => {
    expect(transition("approved", { type: "reopen", reason: null })).toEqual({ ok: false, error: "timesheet_comment_required" });
    expect(transition("approved", { type: "reopen", reason: "Sai dự án" })).toEqual({ ok: true, status: "open" });
    expect(transition("submitted", { type: "reopen", reason: "x" })).toEqual({ ok: false, error: "timesheet_not_approved" });
  });

  it("refuses everything out of order", () => {
    expect(transition("submitted", { type: "submit" })).toEqual({ ok: false, error: "timesheet_not_open" });
    expect(transition("approved", { type: "submit" })).toEqual({ ok: false, error: "timesheet_not_open" });
    expect(transition("open", { type: "approve" })).toEqual({ ok: false, error: "timesheet_not_submitted" });
    expect(transition("returned", { type: "approve" })).toEqual({ ok: false, error: "timesheet_not_submitted" });
    expect(transition("approved", { type: "return", comment: "x" })).toEqual({ ok: false, error: "timesheet_not_submitted" });
  });
});

describe("the attendance hint", () => {
  it("attended = present + work from home + business trip; untracked says so", () => {
    expect(attendanceHint({ status: "present", workedMinutes: 420, wfhMinutes: 0, tripMinutes: 0 })).toEqual({ kind: "attended", minutes: 420 });
    expect(attendanceHint({ status: "remote", workedMinutes: 0, wfhMinutes: 480, tripMinutes: 0 })).toEqual({ kind: "attended", minutes: 480 });
    expect(attendanceHint({ status: "untracked", workedMinutes: 0, wfhMinutes: 0, tripMinutes: 0 })).toEqual({ kind: "untracked" });
    expect(attendanceHint(null)).toEqual({ kind: "none" });
  });
});
