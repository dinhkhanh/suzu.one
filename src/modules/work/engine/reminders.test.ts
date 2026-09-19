import { describe, expect, it } from "vitest";
import { reminderFor } from "./reminders";

describe("task reminders", () => {
  it("reminds the day before, never on the day itself", () => {
    expect(reminderFor("2026-09-21", "2026-09-20")).toBe("due_soon");
    expect(reminderFor("2026-09-20", "2026-09-20")).toBeNull();
    expect(reminderFor("2026-09-22", "2026-09-20")).toBeNull();
  });

  it("reminds of overdue work on days 1, 3, 7 and then weekly", () => {
    const due = "2026-09-01";
    const reminded = Array.from({ length: 30 }, (_, index) => index + 1).filter((late) => reminderFor(due, `2026-09-${String(1 + late).padStart(2, "0")}`) === "overdue");
    expect(reminded).toEqual([1, 3, 7, 14, 21, 28]);
  });

  it("counts across month ends", () => {
    expect(reminderFor("2026-09-30", "2026-10-01")).toBe("overdue");
    expect(reminderFor("2026-10-01", "2026-09-30")).toBe("due_soon");
  });
});
