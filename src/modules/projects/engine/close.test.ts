import { describe, expect, it } from "vitest";
import { closeChecklist, closeRefusal, closeReport, unmetChecks } from "./close";

const clean = { openTasks: 0, openLines: 0, unapprovedWeeks: 0, openBillingItems: 0, driveUrl: "https://drive.google.com/x", retroHeld: true };

describe("close checklist (FR-PJM-59)", () => {
  it("is met when everything is finished, filed and talked through", () => {
    expect(unmetChecks(closeChecklist(clean))).toEqual([]);
    expect(closeRefusal(closeChecklist(clean), null)).toBeNull();
  });

  it("names what is unmet, with counts", () => {
    const checklist = closeChecklist({ openTasks: 2, openLines: 1, unapprovedWeeks: 3, openBillingItems: 1, driveUrl: " ", retroHeld: false });
    expect(unmetChecks(checklist)).toEqual(["tasks", "register", "timesheets", "billing", "drive", "retro"]);
    expect(checklist.find((item) => item.key === "timesheets")).toEqual({ key: "timesheets", met: false, count: 3 });
  });

  it("refuses a close with unmet items unless a reason is given", () => {
    const checklist = closeChecklist({ ...clean, openBillingItems: 1 });
    expect(closeRefusal(checklist, null)).toBe("close_unmet");
    expect(closeRefusal(checklist, "  ")).toBe("close_unmet");
    expect(closeRefusal(checklist, "Khách hàng không ký, đã báo C-level")).toBeNull();
  });
});

describe("close report", () => {
  it("compares the baseline with what happened", () => {
    const report = closeReport({
      closedOn: "2026-12-05",
      baseline: { startDate: "2026-10-01", dueDate: "2026-11-30", budgetMinutes: 6000, milestones: [{ id: "m1", dueDate: "2026-10-31" }], takenAt: "2026-10-01T00:00:00Z" },
      startDate: "2026-10-01",
      dueDate: "2026-12-05",
      budgetMinutes: 7200,
      loggedMinutes: 7560,
      revisionRounds: { internal: 5, client: 2 },
      returnedHandoffs: 1,
      tasks: [
        { status: "done", dueDate: "2026-10-10", completedOn: "2026-10-09" },
        { status: "done", dueDate: "2026-10-20", completedOn: "2026-10-22" },
        { status: "done", dueDate: null, completedOn: "2026-10-22" },
        { status: "cancelled", dueDate: "2026-10-20", completedOn: null },
        { status: "done", dueDate: "2026-11-01", completedOn: "2026-11-01" },
      ],
      milestones: [
        { id: "m1", dueDate: "2026-11-05", doneOn: "2026-11-03" },
        { id: "m2", dueDate: "2026-11-30", doneOn: "2026-11-29" },
        { id: "m3", dueDate: "2026-12-01", doneOn: null },
      ],
    });
    expect(report).toEqual({
      closedOn: "2026-12-05",
      dates: { baselineStart: "2026-10-01", baselineDue: "2026-11-30", plannedDue: "2026-12-05", actualStart: "2026-10-01", actualEnd: "2026-12-05", slipDays: 5 },
      hours: { budgetMinutes: 7200, loggedMinutes: 7560, percent: 105 },
      revisionRounds: { internal: 5, client: 2 },
      returnedHandoffs: 1,
      onTime: { due: 3, onTime: 2, rate: 67 },
      // m1 was moved to 5 Nov but the baseline said 31 Oct: done on 3 Nov is late.
      milestones: { total: 3, done: 2, onTime: 1 },
    });
  });

  it("says nothing it cannot know", () => {
    const report = closeReport({ closedOn: "2026-12-05", baseline: null, startDate: null, dueDate: null, budgetMinutes: null, loggedMinutes: 0, revisionRounds: null, returnedHandoffs: null, tasks: [], milestones: [] });
    expect(report.dates.slipDays).toBeNull();
    expect(report.hours.percent).toBeNull();
    expect(report.onTime.rate).toBeNull();
  });
});
