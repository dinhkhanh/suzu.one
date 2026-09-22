import { describe, expect, it } from "vitest";
import { isStale, linkedProgress, milestoneReminder, nextMilestone, statusFacts, updateDueOn } from "./status";

describe("status updates (FR-PJM-27)", () => {
  it("prefills the facts from what was recorded", () => {
    const facts = statusFacts({
      today: "2026-10-20",
      tasks: [
        { status: "done", dueDate: "2026-10-01" },
        { status: "in_progress", dueDate: "2026-10-19" },
        { status: "todo", dueDate: "2026-10-25" },
        { status: "todo", dueDate: null },
        { status: "cancelled", dueDate: "2026-10-01" },
      ],
      blocked: 1,
      milestones: [
        { id: "m1", name: "Kịch bản duyệt", dueDate: "2026-10-15", doneOn: "2026-10-17", baselineDue: "2026-10-15" },
        { id: "m2", name: "Quay", dueDate: "2026-10-28", doneOn: null, baselineDue: "2026-10-25" },
        { id: "m3", name: "Bàn giao", dueDate: null, doneOn: null, baselineDue: null },
      ],
      minutesLogged: 1200,
      budgetMinutes: 6000,
      register: { accepted: 3, promised: 12 },
      raid: [
        { kind: "risk", severity: "high", status: "open" },
        { kind: "risk", severity: "high", status: "closed" },
        { kind: "risk", severity: "medium", status: "open" },
        { kind: "issue", severity: "low", status: "open" },
        { kind: "issue", severity: "high", status: "open" },
        { kind: "issue", severity: "high", status: "closed" },
        { kind: "decision", severity: null, status: "open" },
        { kind: "assumption", severity: null, status: "open" },
      ],
    });
    expect(facts).toEqual({ tasksDone: 1, tasksOpen: 3, overdue: 1, blocked: 1, milestoneSlipDays: 3, nextMilestone: { name: "Quay", dueDate: "2026-10-28" }, minutesLogged: 1200, budgetMinutes: 6000, deliverablesAccepted: 3, deliverablesPromised: 12, highRisks: 1, openIssues: 2 });
  });
  it("counts no risks and issues when the log is empty or all closed", () => {
    const base = { today: "2026-10-20", tasks: [], blocked: 0, milestones: [], minutesLogged: 0, budgetMinutes: null, register: { accepted: 0, promised: 0 } };
    expect(statusFacts({ ...base, raid: [] })).toMatchObject({ highRisks: 0, openIssues: 0 });
    expect(statusFacts({ ...base, raid: [{ kind: "issue", severity: "high", status: "closed" }, { kind: "risk", severity: "high", status: "closed" }] })).toMatchObject({ highRisks: 0, openIssues: 0 });
  });
  it("picks the next open milestone, undated ones last", () => {
    expect(nextMilestone([{ id: "a", name: "A", dueDate: null, doneOn: null, baselineDue: null }, { id: "b", name: "B", dueDate: "2026-11-01", doneOn: null, baselineDue: null }])?.id).toBe("b");
    expect(nextMilestone([{ id: "a", name: "A", dueDate: "2026-11-01", doneOn: "2026-10-30", baselineDue: null }])).toBeNull();
  });
  it("is due a cadence after the last update, only while the project runs; stale once overdue", () => {
    const running = { projectStatus: "active", lastUpdateOn: "2026-10-01", since: "2026-09-01", cadenceDays: 7 };
    expect(updateDueOn(running)).toBe("2026-10-08");
    expect(updateDueOn({ ...running, lastUpdateOn: null })).toBe("2026-09-08");
    expect(updateDueOn({ ...running, projectStatus: "planned" })).toBeNull();
    expect(isStale(running, "2026-10-08")).toBe(false);
    expect(isStale(running, "2026-10-09")).toBe(true);
    expect(isStale({ ...running, projectStatus: "paused" }, "2026-12-01")).toBe(false);
  });
  it("reminds of a milestone once before it and once when missed", () => {
    const milestone = { dueDate: "2026-10-15", done: false, notified: [] as string[] };
    expect(milestoneReminder(milestone, "2026-10-12")).toBeNull();
    expect(milestoneReminder(milestone, "2026-10-13")).toBe("due_soon");
    expect(milestoneReminder(milestone, "2026-10-15")).toBe("due_soon");
    expect(milestoneReminder({ ...milestone, notified: ["due_soon"] }, "2026-10-14")).toBeNull();
    expect(milestoneReminder({ ...milestone, notified: ["due_soon"] }, "2026-10-16")).toBe("missed");
    expect(milestoneReminder({ ...milestone, notified: ["due_soon", "missed"] }, "2026-10-20")).toBeNull();
    expect(milestoneReminder({ ...milestone, done: true }, "2026-10-16")).toBeNull();
    expect(milestoneReminder({ ...milestone, dueDate: null }, "2026-10-16")).toBeNull();
  });
  it("rolls milestone progress up from linked tasks", () => {
    expect(linkedProgress(["done", "done", "in_progress", "cancelled"])).toEqual({ done: 2, total: 3, percent: 66 });
    expect(linkedProgress([])).toEqual({ done: 0, total: 0, percent: null });
  });
});
