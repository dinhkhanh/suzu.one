// Golden tests for the day plan: the office week with an untracked Saturday (FR-ATT-17), alternate
// Saturdays, flexible hours, overnight and split shifts, holidays and make-up days (FR-ATT-02).
import { describe, expect, it } from "vitest";
import { assignmentFor, type AssignmentFact, type CalendarDay, dayPlan, type DayRule, eachDate, isoWeekday, patternProblems, planSegments, ruleFor, type SchedulePattern } from "./calendar";

const OFFICE_DAY: DayRule = { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const OFF: DayRule = { type: "off" };
const OFFICE: SchedulePattern = { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 240 }, 7: OFF } };
const plan = (date: string, pattern: SchedulePattern | null = OFFICE, calendar: CalendarDay[] = [], entityId: string | null = "e1") => dayPlan({ date, entityId, pattern, calendar });

describe("weekly pattern", () => {
  it("knows weekdays", () => {
    expect(isoWeekday("2026-08-03")).toBe(1);
    expect(isoWeekday("2026-08-09")).toBe(7);
    expect(eachDate("2026-08-30", "2026-09-02")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("plans an office day: 08:30–17:30 with an hour's break is eight hours", () => {
    expect(plan("2026-08-03")).toMatchObject({ kind: "working", segments: [{ start: 510, end: 1050 }], breakMinutes: 60, requiredMinutes: 480, flexible: false, name: null, trace: ["pattern:working"] });
  });

  it("credits Saturday as an untracked working day and rests on Sunday", () => {
    expect(plan("2026-08-08")).toMatchObject({ kind: "untracked", segments: [], requiredMinutes: 240 });
    expect(plan("2026-08-09")).toMatchObject({ kind: "rest", requiredMinutes: 0 });
  });

  it("alternates Saturdays from an anchor week", () => {
    const pattern: SchedulePattern = { days: { ...OFFICE.days, 6: { type: "working", segments: [{ start: "08:30", end: "12:00" }], breakMinutes: 0 } }, alternate: [{ weekday: 6, anchor: "2026-08-01", rule: OFF }] };
    expect(plan("2026-08-01", pattern)).toMatchObject({ kind: "working", requiredMinutes: 210 });
    expect(plan("2026-08-08", pattern)).toMatchObject({ kind: "rest", trace: ["pattern:off:alternate_week"] });
    expect(plan("2026-08-15", pattern).kind).toBe("working");
    expect(plan("2026-07-25", pattern).kind).toBe("rest");
    // The anchor may be any day of a normal week.
    expect(ruleFor({ ...pattern, alternate: [{ weekday: 6, anchor: "2026-07-27", rule: OFF }] }, "2026-08-08").alternate).toBe(true);
  });

  it("plans flexible hours: core hours and a daily total", () => {
    const flexible: DayRule = { type: "working", segments: [{ start: "10:00", end: "16:00" }], breakMinutes: 60, flexible: true, requiredMinutes: 480 };
    expect(plan("2026-08-03", { days: { ...OFFICE.days, 1: flexible } })).toMatchObject({ kind: "working", flexible: true, requiredMinutes: 480, segments: [{ start: 600, end: 960 }] });
  });

  it("has nothing to say without a schedule", () => {
    expect(plan("2026-08-03", null)).toMatchObject({ kind: "unscheduled", requiredMinutes: 0, trace: ["no_schedule"] });
  });
});

describe("shifts", () => {
  it("runs an overnight segment into the next day and keeps a split shift in two parts", () => {
    expect(planSegments([{ start: "22:00", end: "06:00" }])).toEqual([{ start: 1320, end: 1800 }]);
    expect(planSegments([{ start: "06:00", end: "10:00" }, { start: "16:00", end: "20:00" }])).toEqual([{ start: 360, end: 600 }, { start: 960, end: 1200 }]);
  });

  it("lets the roster decide the day, over the pattern", () => {
    const night = { id: "s1", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 45 };
    const rostered = dayPlan({ date: "2026-08-09", entityId: "e1", pattern: OFFICE, calendar: [], roster: { date: "2026-08-09", shift: night } });
    expect(rostered).toMatchObject({ kind: "working", shiftId: "s1", requiredMinutes: 435, segments: [{ start: 1320, end: 1800 }], trace: ["roster:shift"] });
    expect(dayPlan({ date: "2026-08-03", entityId: "e1", pattern: OFFICE, calendar: [], roster: { date: "2026-08-03", shift: null } })).toMatchObject({ kind: "rest", trace: ["roster:off"] });
  });
});

describe("calendar rows", () => {
  const national: CalendarDay = { date: "2026-09-02", entityId: null, kind: "public_holiday", name: "Quốc khánh" };

  it("makes a working day a holiday and remembers what the day would have been", () => {
    const day = plan("2026-09-02", OFFICE, [national]);
    expect(day).toMatchObject({ kind: "holiday", name: "Quốc khánh", requiredMinutes: 0, segments: [], trace: ["pattern:working", "calendar:public_holiday"] });
    expect(day.baseline).toMatchObject({ kind: "working", requiredMinutes: 480 });
  });

  it("prefers the entity's own row and ignores another entity's", () => {
    const own: CalendarDay = { date: "2026-09-02", entityId: "e1", kind: "working_override", name: "Shooting day" };
    const other: CalendarDay = { date: "2026-08-03", entityId: "e2", kind: "company_off", name: "Team trip" };
    expect(plan("2026-09-02", OFFICE, [national, own]).kind).toBe("working");
    expect(plan("2026-08-03", OFFICE, [other]).kind).toBe("working");
    expect(plan("2026-08-03", OFFICE, [other], "e2")).toMatchObject({ kind: "company_off", name: "Team trip" });
  });

  it("turns a rest day into a make-up working day modelled on an ordinary working day", () => {
    const makeUp: CalendarDay = { date: "2026-08-09", entityId: null, kind: "working_override", name: "Làm bù" };
    expect(plan("2026-08-09", OFFICE, [makeUp])).toMatchObject({ kind: "working", requiredMinutes: 480, name: "Làm bù", baseline: { kind: "rest" } });
  });

  it("keeps the roster as the baseline of a rostered holiday", () => {
    const night = { id: "s1", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 0 };
    const day = dayPlan({ date: "2026-09-02", entityId: "e1", pattern: OFFICE, calendar: [national], roster: { date: "2026-09-02", shift: night } });
    expect(day).toMatchObject({ kind: "holiday", shiftId: "s1", baseline: { kind: "working", requiredMinutes: 480 } });
  });
});

describe("assignmentFor", () => {
  const fact = (overrides: Partial<AssignmentFact>): AssignmentFact => ({ scope: "entity", entityId: null, departmentId: null, personId: null, scheduleId: "x", validFrom: "2026-01-01", validTo: null, ...overrides });
  const person = { personId: "p1", entityId: "e1", departmentId: "d1" };
  const rows = [
    fact({ scope: "entity", entityId: "e1", scheduleId: "entity" }),
    fact({ scope: "department", departmentId: "d1", scheduleId: "department" }),
    fact({ scope: "department", departmentId: "d1", entityId: "e1", scheduleId: "department-in-entity", validFrom: "2026-06-01" }),
    fact({ scope: "department", departmentId: "d1", entityId: "e2", scheduleId: "other-entity" }),
    fact({ scope: "person", personId: "p1", scheduleId: "person", validFrom: "2026-08-10", validTo: "2026-08-14" }),
    fact({ scope: "person", personId: "p2", scheduleId: "someone-else" }),
  ];
  it("picks the most specific assignment in force on the date", () => {
    expect(assignmentFor(rows, person, "2026-08-12")?.scheduleId).toBe("person");
    expect(assignmentFor(rows, person, "2026-08-17")?.scheduleId).toBe("department-in-entity");
    expect(assignmentFor(rows, person, "2026-03-01")?.scheduleId).toBe("department");
    expect(assignmentFor(rows, { ...person, departmentId: "d9" }, "2026-08-12")?.scheduleId).toBe("person");
    expect(assignmentFor(rows, { personId: "p3", entityId: "e1", departmentId: null }, "2026-08-12")?.scheduleId).toBe("entity");
    expect(assignmentFor(rows, { personId: "p3", entityId: "e3", departmentId: null }, "2026-08-12")).toBeNull();
    expect(assignmentFor(rows, person, "2025-12-31")).toBeNull();
  });
});

describe("patternProblems", () => {
  it("accepts the office week and a rostered week that is off every day", () => {
    expect(patternProblems(OFFICE, "fixed")).toEqual([]);
    const allOff = { days: { 1: OFF, 2: OFF, 3: OFF, 4: OFF, 5: OFF, 6: OFF, 7: OFF } };
    expect(patternProblems(allOff, "shift")).toEqual([]);
    expect(patternProblems(allOff, "fixed")).toEqual(["no_working_day"]);
  });
  it("names what is wrong with a day", () => {
    const withDay = (rule: DayRule) => patternProblems({ days: { ...OFFICE.days, 1: rule } }, "fixed");
    expect(withDay({ type: "working", segments: [], breakMinutes: 0 })).toEqual(["no_segments"]);
    expect(withDay({ type: "working", segments: [{ start: "8:30", end: "17:30" }], breakMinutes: 0 })).toEqual(["bad_time"]);
    expect(withDay({ type: "working", segments: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "15:00" }], breakMinutes: 0 })).toEqual(["segments_overlap"]);
    expect(withDay({ type: "working", segments: [{ start: "08:00", end: "09:00" }], breakMinutes: 60 })).toEqual(["break_too_long"]);
    expect(withDay({ type: "working", segments: [{ start: "10:00", end: "16:00" }], breakMinutes: 0, flexible: true })).toEqual(["bad_required"]);
    expect(withDay({ type: "untracked", creditMinutes: -1 })).toEqual(["bad_credit"]);
    expect(patternProblems({ days: { 1: OFFICE_DAY } } as unknown as SchedulePattern, "fixed")).toContain("missing_weekday");
  });
});
