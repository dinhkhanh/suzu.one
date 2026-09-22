import { describe, expect, it } from "vitest";
import { baselineSlip, effectiveDate, slipDays, slipSummary, slipWords, takeBaseline, takeTaskBaselines, taskSlip } from "./baseline";

describe("baseline and slip (FR-PJM-12)", () => {
  const baseline = takeBaseline({ startDate: "2026-10-01", dueDate: "2026-11-30", budgetMinutes: 6000, milestones: [{ id: "m1", dueDate: "2026-10-15" }, { id: "m2", dueDate: "2026-11-20" }] }, new Date("2026-09-22T03:00:00Z"));
  it("keeps the dates and budget at kick-off", () => {
    expect(baseline).toEqual({ startDate: "2026-10-01", dueDate: "2026-11-30", budgetMinutes: 6000, milestones: [{ id: "m1", dueDate: "2026-10-15" }, { id: "m2", dueDate: "2026-11-20" }], takenAt: "2026-09-22T03:00:00.000Z" });
  });
  it("measures slip in days; an overdue open milestone keeps slipping until today", () => {
    expect(slipDays("2026-10-15", "2026-10-18")).toBe(3);
    expect(slipDays("2026-10-15", "2026-10-10")).toBe(-5);
    expect(slipDays(null, "2026-10-10")).toBeNull();
    expect(effectiveDate({ dueDate: "2026-10-15", doneOn: null }, "2026-10-20")).toBe("2026-10-20");
    expect(effectiveDate({ dueDate: "2026-10-15", doneOn: "2026-10-14" }, "2026-10-20")).toBe("2026-10-14");
    expect(effectiveDate({ dueDate: "2026-10-25", doneOn: null }, "2026-10-20")).toBe("2026-10-25");
    const slip = baselineSlip(baseline, { startDate: "2026-10-01", dueDate: "2026-12-05", budgetMinutes: 7200, milestones: [{ id: "m1", dueDate: "2026-10-15", doneOn: null }, { id: "m2", dueDate: "2026-11-22", doneOn: null }, { id: "m3", dueDate: "2026-11-25", doneOn: null }] }, "2026-10-20");
    expect(slip).toEqual({ startSlipDays: 0, dueSlipDays: 5, budgetDeltaMinutes: 1200, milestones: [{ id: "m1", slipDays: 5 }, { id: "m2", slipDays: 2 }, { id: "m3", slipDays: null }], worstMilestoneSlipDays: 5 });
    expect(baselineSlip(null, { startDate: null, dueDate: null, budgetMinutes: null, milestones: [] }, "2026-10-20")).toBeNull();
  });
  it("says a slip by its direction", () => {
    expect(slipWords(3)).toEqual({ days: 3, direction: "late" });
    expect(slipWords(-2)).toEqual({ days: 2, direction: "early" });
    expect(slipWords(0)).toEqual({ days: 0, direction: "on_time" });
  });
});

describe("task baselines and slip (FR-PJM-12)", () => {
  it("keep each task's dates as they are at the moment", () => {
    expect(takeTaskBaselines([{ taskId: "a", startDate: "2026-10-01", dueDate: "2026-10-03" }, { taskId: "b", startDate: null, dueDate: null }])).toEqual([
      { taskId: "a", baselineStart: "2026-10-01", baselineDue: "2026-10-03" },
      { taskId: "b", baselineStart: null, baselineDue: null },
    ]);
  });
  it("measure a task's slip by its due date; open overdue work keeps slipping until today", () => {
    const today = "2026-10-20";
    expect(taskSlip({ taskId: "a", dueDate: "2026-10-25", baselineDue: "2026-10-22", open: true }, today).slipDays).toBe(3);
    expect(taskSlip({ taskId: "b", dueDate: "2026-10-15", baselineDue: "2026-10-15", open: true }, today).slipDays).toBe(5);
    expect(taskSlip({ taskId: "c", dueDate: "2026-10-15", baselineDue: "2026-10-15", open: false }, today).slipDays).toBe(0);
    // Overdue against a later baseline: it stands at today, one day ahead of the baseline still.
    expect(taskSlip({ taskId: "d", dueDate: "2026-10-18", baselineDue: "2026-10-21", open: true }, today).slipDays).toBe(-1);
    expect(taskSlip({ taskId: "e", dueDate: "2026-10-28", baselineDue: "2026-10-30", open: true }, today).slipDays).toBe(-2);
    expect(taskSlip({ taskId: "f", dueDate: "2026-10-28", baselineDue: null, open: true }, today).slipDays).toBeNull();
  });
  it("sum up late, early and on time, with the worst slip", () => {
    expect(slipSummary([{ taskId: "a", slipDays: 3 }, { taskId: "b", slipDays: 5 }, { taskId: "c", slipDays: 0 }, { taskId: "e", slipDays: -2 }, { taskId: "f", slipDays: null }])).toEqual({ compared: 4, late: 2, early: 1, onTime: 1, worst: { taskId: "b", slipDays: 5 } });
    expect(slipSummary([{ taskId: "e", slipDays: -2 }])).toMatchObject({ late: 0, worst: null });
  });
});
