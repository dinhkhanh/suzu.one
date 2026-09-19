import { describe, expect, it } from "vitest";
import { dateInMonth, nominalDueDate, periodOf, periodsDueBetween, ruleProblems, shiftDueDate, type DueRule } from "./due-rule";

const NO_DAYS_OFF = new Set<string>();
// The seeded (unconfirmed) days off around Tết 2027, as the scheduler gets them from the attendance service's getDaysOff.
const SEEDED = new Set(["2027-01-01", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11"]);

describe("periods", () => {
  it("names and bounds each kind of period", () => {
    expect(periodOf("monthly", "2026-02-14")).toEqual({ key: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(periodOf("monthly", "2028-02-29")).toEqual({ key: "2028-02", start: "2028-02-01", end: "2028-02-29" });
    expect(periodOf("quarterly", "2026-09-20")).toEqual({ key: "2026-Q3", start: "2026-07-01", end: "2026-09-30" });
    expect(periodOf("semi_annual", "2026-09-20")).toEqual({ key: "2026-H2", start: "2026-07-01", end: "2026-12-31" });
    expect(periodOf("annual", "2026-09-20")).toEqual({ key: "2026", start: "2026-01-01", end: "2026-12-31" });
  });

  it("clamps a day the month does not have", () => {
    expect(dateInMonth(2027 * 12 + 1, 30)).toBe("2027-02-28");
    expect(dateInMonth(2028 * 12 + 1, "last")).toBe("2028-02-29");
  });
});

describe("nominal due dates (golden)", () => {
  const cases: [string, DueRule, Parameters<typeof periodOf>, string][] = [
    ["VAT / PIT monthly: the 20th of the following month", { type: "after_period", monthsAfter: 1, day: 20 }, ["monthly", "2026-09-01"], "2026-10-20"],
    ["December's return is due in January of the next year", { type: "after_period", monthsAfter: 1, day: 20 }, ["monthly", "2026-12-01"], "2027-01-20"],
    ["quarterly return: last day of the first month of the next quarter", { type: "after_period", monthsAfter: 1, day: "last" }, ["quarterly", "2026-08-01"], "2026-10-31"],
    ["Q4 return", { type: "after_period", monthsAfter: 1, day: "last" }, ["quarterly", "2026-11-01"], "2027-01-31"],
    ["provisional CIT: the 30th of the first month of the next quarter", { type: "after_period", monthsAfter: 1, day: 30 }, ["quarterly", "2026-12-31"], "2027-01-30"],
    ["CIT finalization: last day of the third month after the year ends", { type: "after_period", monthsAfter: 3, day: "last" }, ["annual", "2026-06-01"], "2027-03-31"],
    ["business licence fee: 30 January of the year", { type: "in_period", month: 1, day: 30 }, ["annual", "2027-05-05"], "2027-01-30"],
    ["labour usage report, first half: 5 June", { type: "in_period", month: 6, day: 5 }, ["semi_annual", "2027-02-01"], "2027-06-05"],
    ["labour usage report, second half: 5 December", { type: "in_period", month: 6, day: 5 }, ["semi_annual", "2026-09-20"], "2026-12-05"],
    ["insurance payment: last day of the month itself", { type: "in_period", month: 1, day: "last" }, ["monthly", "2027-02-10"], "2027-02-28"],
  ];
  it.each(cases)("%s", (_name, rule, period, expected) => {
    expect(nominalDueDate(rule, periodOf(...period))).toBe(expected);
  });

  it("counts days from an HR event", () => {
    expect(nominalDueDate({ type: "after_event", days: 30 }, { eventDate: "2026-09-01" })).toBe("2026-10-01");
    expect(nominalDueDate({ type: "after_event", days: -3 }, { eventDate: "2026-09-01" })).toBe("2026-08-29");
    expect(() => nominalDueDate({ type: "after_event", days: 1 }, periodOf("monthly", "2026-09-01"))).toThrow();
  });
});

describe("weekend and holiday shifting", () => {
  it("leaves a working day alone", () => {
    expect(shiftDueDate("2026-10-20", "next_working_day", NO_DAYS_OFF)).toBe("2026-10-20");
  });

  it("moves a weekend deadline to Monday, or to Friday for a pay day", () => {
    // 20 September 2026 is a Sunday; 5 September 2026 a Saturday.
    expect(shiftDueDate("2026-09-20", "next_working_day", NO_DAYS_OFF)).toBe("2026-09-21");
    expect(shiftDueDate("2026-09-05", "previous_working_day", NO_DAYS_OFF)).toBe("2026-09-04");
    expect(shiftDueDate("2026-09-05", "none", NO_DAYS_OFF)).toBe("2026-09-05");
  });

  it("carries a deadline across Tết 2027 (seeded holidays 5–11 February)", () => {
    // Friday 5 Feb … Thursday 11 Feb are off; Friday 12 Feb is the first working day.
    expect(shiftDueDate("2027-02-06", "next_working_day", SEEDED)).toBe("2027-02-12");
    expect(shiftDueDate("2027-02-10", "next_working_day", SEEDED)).toBe("2027-02-12");
    // A pay day inside Tết goes back to Thursday 4 February.
    expect(shiftDueDate("2027-02-05", "previous_working_day", SEEDED)).toBe("2027-02-04");
  });

  it("the payroll calendar of January 2027's pay: lock 2nd → propose 3rd → sign 4th → pay 5th, around Tết", () => {
    const january = periodOf("monthly", "2027-01-15");
    const due = (day: number, shift: "next_working_day" | "previous_working_day") => shiftDueDate(nominalDueDate({ type: "after_period", monthsAfter: 1, day }, january), shift, SEEDED);
    expect([due(2, "next_working_day"), due(3, "next_working_day"), due(4, "next_working_day")]).toEqual(["2027-02-02", "2027-02-03", "2027-02-04"]);
    // The 5th is the first day of the Tết break: salaries go out the working day before.
    expect(due(5, "previous_working_day")).toBe("2027-02-04");
  });

  it("the payroll calendar in an ordinary month with a weekend in it (pay for September 2026)", () => {
    const september = periodOf("monthly", "2026-09-10");
    const due = (day: number, shift: "next_working_day" | "previous_working_day") => shiftDueDate(nominalDueDate({ type: "after_period", monthsAfter: 1, day }, september), shift, SEEDED);
    // 3 and 4 October 2026 are Saturday and Sunday.
    expect([due(2, "next_working_day"), due(3, "next_working_day"), due(4, "next_working_day"), due(5, "previous_working_day")]).toEqual(["2026-10-02", "2026-10-05", "2026-10-05", "2026-10-05"]);
  });

  it("CIT finalization 2026 lands on a working day", () => {
    expect(shiftDueDate("2027-03-31", "next_working_day", SEEDED)).toBe("2027-03-31");
  });
});

describe("periodsDueBetween", () => {
  it("lists the monthly periods that fall due in a window", () => {
    const due = periodsDueBetween("monthly", { type: "after_period", monthsAfter: 1, day: 20 }, "2026-09-01", "2026-12-31");
    expect(due.map((row) => [row.period.key, row.nominalDueDate])).toEqual([["2026-08", "2026-09-20"], ["2026-09", "2026-10-20"], ["2026-10", "2026-11-20"], ["2026-11", "2026-12-20"]]);
  });

  it("finds an annual period that ended long before its due date", () => {
    expect(periodsDueBetween("annual", { type: "after_period", monthsAfter: 3, day: "last" }, "2027-01-01", "2027-12-31").map((row) => row.period.key)).toEqual(["2026"]);
  });

  it("finds rules due inside their own period", () => {
    expect(periodsDueBetween("annual", { type: "in_period", month: 1, day: 30 }, "2026-09-20", "2027-02-28").map((row) => [row.period.key, row.nominalDueDate])).toEqual([["2027", "2027-01-30"]]);
    expect(periodsDueBetween("semi_annual", { type: "in_period", month: 6, day: 5 }, "2026-09-20", "2027-06-30").map((row) => row.period.key)).toEqual(["2026-H2", "2027-H1"]);
  });

  it("has nothing for an event rule or an empty window", () => {
    expect(periodsDueBetween("monthly", { type: "after_event", days: 3 }, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(periodsDueBetween("monthly", { type: "after_period", monthsAfter: 1, day: 20 }, "2026-12-31", "2026-01-01")).toEqual([]);
  });
});

describe("ruleProblems", () => {
  it("accepts the rules the library uses", () => {
    expect(ruleProblems({ type: "after_period", monthsAfter: 1, day: 20 }, "monthly")).toEqual([]);
    expect(ruleProblems({ type: "in_period", month: 6, day: 5 }, "semi_annual")).toEqual([]);
    expect(ruleProblems({ type: "after_event", days: 30 }, "event")).toEqual([]);
  });

  it("names what is wrong", () => {
    expect(ruleProblems({ type: "after_period", monthsAfter: 13, day: 0 }, "monthly")).toEqual(["rule_day", "rule_months_after"]);
    expect(ruleProblems({ type: "in_period", month: 4, day: 5 }, "quarterly")).toEqual(["rule_month"]);
    expect(ruleProblems({ type: "after_event", days: 3 }, "monthly")).toEqual(["rule_recurrence"]);
    expect(ruleProblems({ type: "after_period", monthsAfter: 1, day: 20 }, "event")).toEqual(["rule_recurrence"]);
    expect(ruleProblems({ type: "someday" }, "monthly")).toEqual(["rule_type"]);
    expect(ruleProblems(null, "monthly")).toEqual(["rule_type"]);
  });
});
