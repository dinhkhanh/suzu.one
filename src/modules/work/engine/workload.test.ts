import { describe, expect, it } from "vitest";
import { weeksFrom, workload, type WorkloadTask } from "./workload";

const TODAY = "2026-09-20"; // a Sunday: the current week is 14–20 September.
const weeks = weeksFrom(TODAY, 3);
const person = { id: "p1" };
const task = (over: Partial<WorkloadTask>): WorkloadTask => ({ assigneePersonId: "p1", startDate: null, dueDate: null, estimateMinutes: null, ...over });
const run = (tasks: WorkloadTask[], away: { date: string; days: number }[] = [], off: string[] = []) => workload({ people: [person], tasks, away: away.map((day) => ({ personId: "p1", ...day })), daysOff: () => new Set(off), weeks, today: TODAY })[0];

describe("weeksFrom", () => {
  it("starts on the Monday of today's week", () => {
    expect(weeks).toEqual([{ start: "2026-09-14", end: "2026-09-20" }, { start: "2026-09-21", end: "2026-09-27" }, { start: "2026-09-28", end: "2026-10-04" }]);
    expect(weeksFrom("2026-09-23", 1)).toEqual([{ start: "2026-09-21", end: "2026-09-27" }]);
  });
});

describe("workload (golden)", () => {
  it("puts a task without a start date in the week of its due date", () => {
    const row = run([task({ dueDate: "2026-09-23", estimateMinutes: 480 })]);
    expect(row.cells.map((cell) => [cell.tasks, cell.minutes])).toEqual([[0, 0], [1, 480], [0, 0]]);
  });

  it("spreads a task evenly over the working days between start and due", () => {
    // Thu 24 Sep → Wed 30 Sep: 5 working days, 2 in the first week and 3 in the next; 10 hours.
    const row = run([task({ startDate: "2026-09-24", dueDate: "2026-09-30", estimateMinutes: 600 })]);
    expect(row.cells.map((cell) => [cell.tasks, cell.minutes])).toEqual([[0, 0], [1, 240], [1, 360]]);
  });

  it("late work counts from today; undated work is apart; work beyond the last week is 'later'", () => {
    const row = run([task({ dueDate: "2026-09-01", estimateMinutes: 120 }), task({ estimateMinutes: 60 }), task({ dueDate: "2026-11-02", estimateMinutes: 300 }), task({ startDate: "2026-10-01", dueDate: "2026-10-06", estimateMinutes: 480 })]);
    // Today is a Sunday with no weekday left in the span: the clamped due date carries the late task.
    expect(row.cells.map((cell) => [cell.tasks, cell.minutes])).toEqual([[1, 120], [0, 0], [1, 240]]);
    expect(row.unscheduled).toEqual({ tasks: 1, minutes: 60 });
    expect(row.later).toEqual({ tasks: 1, minutes: 540 });
  });

  it("counts tasks without an estimate and flags them", () => {
    const row = run([task({ dueDate: "2026-09-22" }), task({ dueDate: "2026-09-22", estimateMinutes: 30 })]);
    expect(row.cells[1]).toMatchObject({ tasks: 2, minutes: 30, unestimated: 1 });
  });

  it("capacity is 40 hours less leave and holidays; more than that is over capacity", () => {
    const tasks = [task({ startDate: "2026-09-21", dueDate: "2026-09-25", estimateMinutes: 30 * 60 })];
    expect(run(tasks).cells[1]).toMatchObject({ capacityMinutes: 2400, over: false });
    // Two and a half days of leave and a holiday: 1.5 days = 12 hours left.
    const busy = run(tasks, [{ date: "2026-09-21", days: 1 }, { date: "2026-09-22", days: 1 }, { date: "2026-09-23", days: 0.5 }], ["2026-09-25"]).cells[1];
    expect(busy).toMatchObject({ awayDays: 2.5, holidayDays: 1, capacityMinutes: 720, over: true });
  });

  it("leave on a weekend or on a holiday takes nothing more away", () => {
    const cell = run([], [{ date: "2026-09-26", days: 1 }, { date: "2026-09-25", days: 1 }], ["2026-09-25"]).cells[1];
    expect(cell).toMatchObject({ awayDays: 0, holidayDays: 1, capacityMinutes: 1920 });
  });

  it("keeps people apart", () => {
    const rows = workload({ people: [{ id: "p1" }, { id: "p2" }], tasks: [task({ dueDate: "2026-09-22", estimateMinutes: 60 })], away: [{ personId: "p2", date: "2026-09-22", days: 1 }], daysOff: () => new Set(), weeks, today: TODAY });
    expect(rows.map((row) => [row.cells[1].tasks, row.cells[1].awayDays])).toEqual([[1, 0], [0, 1]]);
  });
});
