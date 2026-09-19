import { describe, expect, it } from "vitest";
import { riskOf } from "./risk";

const today = "2026-09-20";

describe("riskOf", () => {
  it("overdue: open and past the date, started or not", () => {
    expect(riskOf({ category: "in_progress", dueDate: "2026-09-19", blockedBy: 0 }, today)).toBe("overdue");
    expect(riskOf({ category: "in_review", dueDate: "2026-09-01", blockedBy: 2 }, today)).toBe("overdue");
  });
  it("at risk: due within two days and not started", () => {
    expect(riskOf({ category: "todo", dueDate: "2026-09-20", blockedBy: 0 }, today)).toBe("at_risk");
    expect(riskOf({ category: "backlog", dueDate: "2026-09-22", blockedBy: 0 }, today)).toBe("at_risk");
    expect(riskOf({ category: "todo", dueDate: "2026-09-23", blockedBy: 0 }, today)).toBeNull();
    expect(riskOf({ category: "in_progress", dueDate: "2026-09-21", blockedBy: 0 }, today)).toBeNull();
  });
  it("at risk: blocked by an open task, whatever the date", () => {
    expect(riskOf({ category: "in_progress", dueDate: null, blockedBy: 1 }, today)).toBe("at_risk");
    expect(riskOf({ category: "todo", dueDate: "2026-10-30", blockedBy: 1 }, today)).toBe("at_risk");
  });
  it("closed tasks are never flagged", () => {
    expect(riskOf({ category: "done", dueDate: "2026-09-01", blockedBy: 1 }, today)).toBeNull();
    expect(riskOf({ category: "cancelled", dueDate: "2026-09-01", blockedBy: 0 }, today)).toBeNull();
  });
});
