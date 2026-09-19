import { describe, expect, it } from "vitest";
import { sortInbox } from "./inbox";

describe("sortInbox", () => {
  it("puts overdue first, then due date, then priority, undated last", () => {
    const items = [
      { id: "undated-urgent", dueDate: null, priority: 1 },
      { id: "next-week", dueDate: "2026-09-27", priority: null },
      { id: "today-low", dueDate: "2026-09-20", priority: 4 },
      { id: "today-urgent", dueDate: "2026-09-20", priority: 1 },
      { id: "late", dueDate: "2026-09-18", priority: null },
      { id: "very-late", dueDate: "2026-09-01", priority: 3 },
      { id: "undated", dueDate: null, priority: null },
    ];
    expect(sortInbox(items, "2026-09-20").map((item) => item.id)).toEqual(["very-late", "late", "today-urgent", "today-low", "next-week", "undated-urgent", "undated"]);
  });
  it("keeps the given order for equals", () => {
    const items = [{ id: "a", dueDate: "2026-09-21", priority: 2 }, { id: "b", dueDate: "2026-09-21", priority: 2 }];
    expect(sortInbox(items, "2026-09-20").map((item) => item.id)).toEqual(["a", "b"]);
  });
});
