import { describe, expect, it } from "vitest";
import { isCompletedLate, missingEvidence, statusColour } from "./status";

const today = "2026-09-20";

describe("statusColour", () => {
  it.each([
    [{ status: "todo", dueDate: "2026-10-20" }, "upcoming"],
    [{ status: "todo", dueDate: "2026-09-27" }, "due_soon"],
    [{ status: "in_progress", dueDate: "2026-09-20" }, "due_soon"],
    [{ status: "todo", dueDate: "2026-09-19" }, "overdue"],
    [{ status: "todo", dueDate: null }, "upcoming"],
    [{ status: "done", dueDate: "2026-09-01", completedLate: false }, "done"],
    [{ status: "done", dueDate: "2026-09-01", completedLate: true }, "done_late"],
    [{ status: "cancelled", dueDate: "2026-09-01" }, "cancelled"],
  ] as const)("%j → %s", (facts, colour) => {
    expect(statusColour(facts, today)).toBe(colour);
  });
});

describe("isCompletedLate", () => {
  it("compares the day it was closed with the due date", () => {
    expect(isCompletedLate("2026-09-20", "2026-09-20", null)).toBe(false);
    expect(isCompletedLate("2026-09-20", "2026-09-21", null)).toBe(true);
    expect(isCompletedLate(null, "2026-09-21", null)).toBe(false);
  });
  it("trusts the submitted date on the receipt", () => {
    expect(isCompletedLate("2026-09-20", "2026-09-23", "2026-09-18")).toBe(false);
    expect(isCompletedLate("2026-09-20", "2026-09-20", "2026-09-22")).toBe(true);
  });
});

describe("missingEvidence", () => {
  const all = { file: true, reference: true, submittedDate: true, amount: true };
  it("lists everything that is asked for and absent", () => {
    expect(missingEvidence(all, { files: 0, referenceNumber: " ", submittedDate: null, amountPaid: null })).toEqual(["file", "reference", "submittedDate", "amount"]);
  });
  it("is satisfied by what was given — a zero amount is an amount", () => {
    expect(missingEvidence(all, { files: 1, referenceNumber: "TK-01", submittedDate: "2026-09-18", amountPaid: 0 })).toEqual([]);
    expect(missingEvidence({ file: false, reference: false, submittedDate: false, amount: false }, { files: 0, referenceNumber: null, submittedDate: null, amountPaid: null })).toEqual([]);
  });
});
