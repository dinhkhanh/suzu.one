import { describe, expect, it } from "vitest";
import { dashboardMatrix, worstColour } from "./dashboard";

describe("dashboardMatrix (golden)", () => {
  const entities = [{ id: "szg" }, { id: "szm" }];
  const months = ["2026-08", "2026-09", "2026-10"];
  const rows = dashboardMatrix(entities, months, [
    { entityId: "szm", dueDate: "2026-09-21", colour: "due_soon", escalationLevel: 0 },
    { entityId: "szm", dueDate: "2026-09-10", colour: "overdue", escalationLevel: 2 },
    { entityId: "szm", dueDate: "2026-09-05", colour: "done", escalationLevel: 0 },
    { entityId: "szm", dueDate: "2026-08-20", colour: "done_late", escalationLevel: 0 },
    { entityId: "szm", dueDate: "2026-09-30", colour: "cancelled", escalationLevel: 0 },
    { entityId: "szg", dueDate: "2026-10-20", colour: "upcoming", escalationLevel: 0 },
    { entityId: "szg", dueDate: "2026-11-20", colour: "upcoming", escalationLevel: 0 },
    { entityId: "other", dueDate: "2026-09-20", colour: "overdue", escalationLevel: 0 },
    { entityId: "szg", dueDate: null, colour: "upcoming", escalationLevel: 0 },
  ]);

  it("counts by entity, month and colour; leaves out cancelled, undated and out-of-range items", () => {
    expect(rows.map((row) => row.cells.map((cell) => cell.total))).toEqual([[0, 0, 1], [1, 3, 0]]);
    expect(rows[1].cells[1]).toEqual({ month: "2026-09", total: 3, counts: { due_soon: 1, overdue: 1, done: 1 }, escalated: 1 });
  });

  it("a cell reads as its worst item", () => {
    expect(rows[1].cells.map(worstColour)).toEqual(["done_late", "overdue", null]);
    expect(worstColour(rows[0].cells[2])).toBe("upcoming");
  });
});
