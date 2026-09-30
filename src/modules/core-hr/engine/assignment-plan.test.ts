import { describe, expect, it } from "vitest";
import { periodOn, planAssignmentChange, planPastPeriod } from "./assignment-plan";

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

describe("planPastPeriod", () => {
  const today = "2026-09-30";
  // What the roll-out import leaves: one row from the first day, holding today's placement.
  const imported = [{ id: "now", validFrom: "2019-03-01", validTo: null }];
  const since2019 = { startDate: "2019-03-01", endDate: null };
  const none = { shortenId: null, shortenTo: null, delayId: null, delayFrom: null };

  it("carves the earliest years off the imported row, oldest period first", () => {
    expect(planPastPeriod(since2019, imported, { validFrom: "2019-03-01", validTo: "2020-12-31" }, today)).toEqual({ kind: "insert", ...none, delayId: "now", delayFrom: "2021-01-01" });
    const after = [
      { id: "first", validFrom: "2019-03-01", validTo: "2020-12-31" },
      { id: "now", validFrom: "2021-01-01", validTo: null },
    ];
    expect(planPastPeriod(since2019, after, { validFrom: "2021-01-01", validTo: "2022-05-31" }, today)).toEqual({ kind: "insert", ...none, delayId: "now", delayFrom: "2022-06-01" });
  });

  it("gives way at both edges when it straddles two rows", () => {
    const rows = [
      { id: "a", validFrom: "2019-03-01", validTo: "2020-12-31" },
      { id: "b", validFrom: "2021-01-01", validTo: null },
    ];
    expect(planPastPeriod(since2019, rows, { validFrom: "2020-07-01", validTo: "2021-03-31" }, today)).toEqual({ kind: "insert", shortenId: "a", shortenTo: "2020-06-30", delayId: "b", delayFrom: "2021-04-01" });
  });

  it("fills a gap without touching anything", () => {
    const rows = [{ id: "b", validFrom: "2021-01-01", validTo: null }];
    expect(planPastPeriod(since2019, rows, { validFrom: "2019-03-01", validTo: "2020-12-31" }, today)).toEqual({ kind: "insert", ...none });
  });

  it("corrects a closed row given its exact dates", () => {
    const rows = [
      { id: "a", validFrom: "2019-03-01", validTo: "2020-12-31" },
      { id: "b", validFrom: "2021-01-01", validTo: null },
    ];
    expect(planPastPeriod(since2019, rows, { validFrom: "2019-03-01", validTo: "2020-12-31" }, today)).toEqual({ kind: "replace", id: "a" });
  });

  it("never splits or swallows a row", () => {
    expect(planPastPeriod(since2019, imported, { validFrom: "2020-01-01", validTo: "2020-12-31" }, today)).toEqual({ kind: "rejected", reason: "inside_recorded_period" });
    const rows = [
      { id: "a", validFrom: "2019-03-01", validTo: "2019-12-31" },
      { id: "b", validFrom: "2020-01-01", validTo: "2020-06-30" },
      { id: "c", validFrom: "2020-07-01", validTo: null },
    ];
    expect(planPastPeriod(since2019, rows, { validFrom: "2019-06-01", validTo: "2020-09-30" }, today)).toEqual({ kind: "rejected", reason: "covers_recorded_period" });
  });

  it("keeps a transfer or promotion on its date", () => {
    const rows = [
      { id: "a", validFrom: "2019-03-01", validTo: "2022-05-31" },
      { id: "promoted", validFrom: "2022-06-01", validTo: null },
    ];
    expect(planPastPeriod(since2019, rows, { validFrom: "2022-01-01", validTo: "2022-07-31" }, today, new Set(["promoted"]))).toEqual({ kind: "rejected", reason: "moves_recorded_event" });
  });

  it("only takes periods that are over, inside the employment", () => {
    expect(planPastPeriod(since2019, imported, { validFrom: "2019-03-01", validTo: today }, today)).toEqual({ kind: "rejected", reason: "not_ended" });
    expect(planPastPeriod(since2019, imported, { validFrom: "2019-02-28", validTo: "2019-12-31" }, today)).toEqual({ kind: "rejected", reason: "before_employment_start" });
    expect(planPastPeriod({ startDate: "2019-03-01", endDate: "2020-12-31" }, [], { validFrom: "2020-01-01", validTo: "2021-01-31" }, today)).toEqual({ kind: "rejected", reason: "after_employment_end" });
  });
});
