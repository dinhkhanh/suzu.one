import { describe, expect, it } from "vitest";
import { periodOn, planAssignmentChange } from "./assignment-plan";

const employment = { startDate: "2025-01-01", endDate: null };
const history = [
  { id: "a", validFrom: "2025-01-01", validTo: "2025-06-30" },
  { id: "b", validFrom: "2025-07-01", validTo: null },
];

describe("planAssignmentChange", () => {
  it("inserts the first assignment", () => {
    expect(planAssignmentChange(employment, [], "2025-01-01")).toEqual({ kind: "insert" });
  });

  it("closes the open assignment the day before the new one starts", () => {
    expect(planAssignmentChange(employment, history, "2025-10-01")).toEqual({ kind: "succeed", closeId: "b", closeOn: "2025-09-30" });
  });

  it("accepts a future-dated change", () => {
    expect(planAssignmentChange(employment, history, "2030-01-01")).toEqual({ kind: "succeed", closeId: "b", closeOn: "2029-12-31" });
  });

  it("treats the same start date as a correction of the open assignment", () => {
    expect(planAssignmentChange(employment, history, "2025-07-01")).toEqual({ kind: "replace", id: "b" });
  });

  it("refuses to rewrite the middle of the history", () => {
    expect(planAssignmentChange(employment, history, "2025-03-01")).toEqual({ kind: "rejected", reason: "before_current_assignment" });
  });

  it("shortens a closed tip that would overlap, and inserts after one that would not", () => {
    const closed = [{ id: "a", validFrom: "2025-01-01", validTo: "2025-06-30" }];
    expect(planAssignmentChange(employment, closed, "2025-08-01")).toEqual({ kind: "insert" });
    expect(planAssignmentChange(employment, closed, "2025-06-01")).toEqual({ kind: "succeed", closeId: "a", closeOn: "2025-05-31" });
  });

  it("stays inside the employment period", () => {
    expect(planAssignmentChange(employment, [], "2024-12-31")).toEqual({ kind: "rejected", reason: "before_employment_start" });
    expect(planAssignmentChange({ startDate: "2025-01-01", endDate: "2025-12-31" }, history, "2026-01-01")).toEqual({
      kind: "rejected",
      reason: "after_employment_end",
    });
  });
});

describe("periodOn", () => {
  it("finds the period in force, with inclusive ends", () => {
    expect(periodOn(history, "2025-06-30")?.id).toBe("a");
    expect(periodOn(history, "2025-07-01")?.id).toBe("b");
    expect(periodOn(history, "2024-12-31")).toBeUndefined();
  });
});
