import { describe, expect, it } from "vitest";
import { reminderFor, reminderOnWorkingDay } from "./reminders";

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

// WRK-02 (f): reminders went out on Sundays, holidays and days of leave.
describe("task reminders for someone who is not at work every day", () => {
  // Monday to Friday, less the holiday of Thursday 17 September 2026 and a leave from Monday the 21st to Wednesday the 23rd.
  const off = new Set(["2026-09-17", "2026-09-21", "2026-09-22", "2026-09-23"]);
  const works = (date: string) => !off.has(date) && ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

  it("says nothing on a day off, whatever the cadence says", () => {
    // Sunday the 20th: something due tomorrow, something one day overdue.
    expect(reminderOnWorkingDay("2026-09-21", "2026-09-20", works)).toBeNull();
    expect(reminderOnWorkingDay("2026-09-19", "2026-09-20", works)).toBeNull();
    // The holiday, and a day of leave.
    expect(reminderOnWorkingDay("2026-09-18", "2026-09-17", works)).toBeNull();
    expect(reminderOnWorkingDay("2026-09-21", "2026-09-22", works)).toBeNull();
  });

  it("is the plain cadence on an ordinary run of working days", () => {
    expect(reminderOnWorkingDay("2026-09-16", "2026-09-15", works)).toBe("due_soon");
    expect(reminderOnWorkingDay("2026-09-16", "2026-09-14", works)).toBeNull();
    expect(reminderOnWorkingDay("2026-09-15", "2026-09-15", works)).toBeNull();
    expect(reminderOnWorkingDay("2026-09-08", "2026-09-09", works)).toBe("overdue");
    expect(reminderOnWorkingDay("2026-09-08", "2026-09-10", works)).toBeNull();
    expect(reminderOnWorkingDay("2026-09-08", "2026-09-11", works)).toBe("overdue");
  });

  it("brings 'due soon' forward to the last working day before the due date", () => {
    // Due the day after the holiday: told on Wednesday the 16th.
    expect(reminderOnWorkingDay("2026-09-18", "2026-09-16", works)).toBe("due_soon");
    // Due during the leave: told on Friday the 18th, the last day at work — not on Wednesday too.
    expect(reminderOnWorkingDay("2026-09-22", "2026-09-18", works)).toBe("due_soon");
    expect(reminderOnWorkingDay("2026-09-22", "2026-09-16", works)).toBeNull();
    // Due the morning back: told before leaving.
    expect(reminderOnWorkingDay("2026-09-24", "2026-09-18", works)).toBe("due_soon");
    // More than a week ahead is not "soon", whatever lies between.
    expect(reminderOnWorkingDay("2026-09-30", "2026-09-18", (date) => date === "2026-09-18")).toBeNull();
  });

  it("moves 'overdue' to the first working day after the day it fell on — once", () => {
    // Due Friday the 11th: the day after is a Saturday, so Monday the 14th says it; Tuesday does not repeat it.
    expect(reminderOnWorkingDay("2026-09-11", "2026-09-14", works)).toBe("overdue");
    expect(reminderOnWorkingDay("2026-09-11", "2026-09-15", works)).toBeNull();
    // Due Friday the 18th, then a weekend and three days of leave: Thursday the 24th, the morning back.
    expect(reminderOnWorkingDay("2026-09-18", "2026-09-24", works)).toBe("overdue");
    // Friday the 25th is day 7, the cadence's own day.
    expect(reminderOnWorkingDay("2026-09-18", "2026-09-25", works)).toBe("overdue");
    // Due on the last day of the leave: the morning back is day 1; the day after is not.
    expect(reminderOnWorkingDay("2026-09-23", "2026-09-24", works)).toBe("overdue");
    expect(reminderOnWorkingDay("2026-09-23", "2026-09-25", works)).toBeNull();
  });
});
