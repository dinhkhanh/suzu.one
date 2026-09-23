import { describe, expect, it } from "vitest";
import { DEFAULT_TEAM_RULES, type DayFacts, isDayOff, isLate, isoWeekday, mergeRules, NO_TEAM_RULES, planRequirement, reportRequirement, type TeamRules, weekStartOf } from "./rules";

const team = (rules: Partial<TeamRules>): TeamRules => ({ ...DEFAULT_TEAM_RULES, ...rules });
// 2026-09-21 is a Monday.
const day = (date: string, facts: Partial<DayFacts> = {}): DayFacts => ({ date, kind: "working", name: null, leave: null, ...facts });

describe("merging several teams' rules", () => {
  it("no team: the company's rules all the same (Q18) — the plan and the report are asked of everyone", () => {
    expect(mergeRules([])).toEqual(NO_TEAM_RULES);
    expect(NO_TEAM_RULES).toMatchObject({ planMode: "required", reportMode: "required", reportDeadline: "23:00", timeMode: "required", timesheetApproval: true });
    expect(reportRequirement(mergeRules([]), day("2026-09-21"))).toEqual({ required: true, reason: null });
  });

  it("one team: its own rules", () => {
    expect(mergeRules([DEFAULT_TEAM_RULES])).toEqual({ planMode: "required", reportMode: "required", reportDays: [], planCutoff: "09:30", reportDeadline: "23:00", timeMode: "required", timesheetApproval: true, coverMinDays: 2 });
  });

  it("the strictest mode wins; days and deadline come from the teams that require the report", () => {
    const social = team({ reportMode: "required", reportDays: [1, 2, 3, 4, 5], reportDeadline: "18:30", planMode: "optional", timeMode: "off" });
    // Video reports only when it wants to, Saturdays included — its Saturday is not mandatory.
    const video = team({ reportMode: "optional", reportDays: [1, 2, 3, 4, 5, 6], reportDeadline: "17:00", planMode: "required", planCutoff: "10:00", timeMode: "required", timesheetApproval: true, coverMinDays: 3 });
    const design = team({ reportMode: "required", reportDays: [2, 4], reportDeadline: "18:00", planMode: "required", planCutoff: "09:00", coverMinDays: 1 });
    expect(mergeRules([social, video, design])).toEqual({ planMode: "required", reportMode: "required", reportDays: [1, 2, 3, 4, 5], planCutoff: "09:00", reportDeadline: "18:00", timeMode: "required", timesheetApproval: true, coverMinDays: 1 });
  });

  it("one team narrowing the days does not narrow another's whole calendar", () => {
    // The narrowing is an opt-out one lead may set; the team that did not set it still reports
    // every working day, and the person in both follows that.
    expect(mergeRules([team({}), team({ reportDays: [1, 2, 3] })]).reportDays).toEqual([]);
    expect(mergeRules([team({ reportDays: [1, 3] }), team({ reportDays: [2] })]).reportDays).toEqual([1, 2, 3]);
  });

  it("all optional: the optional teams' days", () => {
    const merged = mergeRules([team({ reportMode: "optional", reportDays: [1, 3] }), team({ reportMode: "off", reportDays: [5] })]);
    expect(merged.reportMode).toBe("optional");
    expect(merged.reportDays).toEqual([1, 3]);
  });
});

describe("is a report required today", () => {
  const rules = mergeRules([DEFAULT_TEAM_RULES]);
  it("on a scheduled working day: yes", () => {
    expect(reportRequirement(rules, day("2026-09-21"))).toEqual({ required: true, reason: null });
    expect(reportRequirement(rules, day("2026-09-25"))).toEqual({ required: true, reason: null });
  });
  it("on a public holiday or company day off: no", () => {
    expect(reportRequirement(rules, day("2026-09-02", { kind: "holiday", name: "Quốc khánh" }))).toEqual({ required: false, reason: "holiday" });
    expect(reportRequirement(rules, day("2026-09-22", { kind: "company_off" }))).toEqual({ required: false, reason: "holiday" });
    expect(reportRequirement(rules, day("2026-09-23", { kind: "compensatory_off" }))).toEqual({ required: false, reason: "holiday" });
  });
  it("on approved full-day leave: no; half a day still reports", () => {
    expect(reportRequirement(rules, day("2026-09-21", { leave: "full" }))).toEqual({ required: false, reason: "leave" });
    expect(reportRequirement(rules, day("2026-09-21", { leave: "part" }))).toEqual({ required: true, reason: null });
  });
  it("on an untracked Saturday (D15): yes — it is a working day from home", () => {
    expect(reportRequirement(rules, day("2026-09-26", { kind: "untracked" }))).toEqual({ required: true, reason: null });
    // Unless the team narrowed the days to the office week.
    const weekdaysOnly = mergeRules([team({ reportDays: [1, 2, 3, 4, 5] })]);
    expect(reportRequirement(weekdaysOnly, day("2026-09-26", { kind: "untracked" }))).toEqual({ required: false, reason: "untracked" });
  });
  it("on a rest day, or a day the team narrowed away: no", () => {
    expect(reportRequirement(rules, day("2026-09-27", { kind: "rest" }))).toEqual({ required: false, reason: "rest" });
    expect(reportRequirement(mergeRules([team({ reportDays: [1, 3, 5] })]), day("2026-09-22"))).toEqual({ required: false, reason: "not_a_report_day" });
    // Nobody scheduled the person: the weekday decides, as a five-day week.
    expect(reportRequirement(rules, day("2026-09-22", { kind: "unscheduled" }))).toEqual({ required: true, reason: null });
    expect(reportRequirement(rules, day("2026-09-26", { kind: "unscheduled" }))).toEqual({ required: false, reason: "not_a_report_day" });
  });
  it("when the team turned it off: no", () => {
    expect(reportRequirement(mergeRules([team({ reportMode: "off" })]), day("2026-09-21"))).toEqual({ required: false, reason: "off" });
  });
  it("the plan follows the working calendar too", () => {
    expect(planRequirement(rules, day("2026-09-21"))).toEqual({ required: true, reason: null });
    expect(planRequirement(rules, day("2026-09-26", { kind: "untracked" }))).toEqual({ required: true, reason: null });
    expect(planRequirement(rules, day("2026-09-21", { leave: "full" }))).toEqual({ required: false, reason: "leave" });
    expect(planRequirement(mergeRules([team({ planMode: "optional" })]), day("2026-09-21"))).toEqual({ required: false, reason: "optional" });
  });
  it("Today says 'day off' on holidays, leave, rest days and days nobody works", () => {
    expect(isDayOff(rules, day("2026-09-26", { kind: "untracked" }))).toBe(false);
    expect(isDayOff(rules, day("2026-09-21", { leave: "full" }))).toBe(true);
    expect(isDayOff(rules, day("2026-09-27", { kind: "rest" }))).toBe(true);
    expect(isDayOff(rules, day("2026-09-21"))).toBe(false);
    expect(isDayOff(mergeRules([team({ reportDays: [1, 2, 3, 4, 5] })]), day("2026-09-26", { kind: "untracked" }))).toBe(true);
  });
});

describe("lateness", () => {
  it("counts from the deadline of the report's own day, Vietnam time", () => {
    // 23:00 in Hanoi is 16:00 UTC.
    expect(isLate(new Date("2026-09-21T15:59:59Z"), "2026-09-21", "23:00")).toBe(false);
    expect(isLate(new Date("2026-09-21T16:00:00Z"), "2026-09-21", "23:00")).toBe(false);
    expect(isLate(new Date("2026-09-21T16:00:01Z"), "2026-09-21", "23:00")).toBe(true);
    // 23:30 is late on the day's own report, not early on the next day's.
    expect(isLate(new Date("2026-09-21T16:30:00Z"), "2026-09-21", "23:00")).toBe(true);
    expect(isLate(new Date("2026-09-21T11:30:01Z"), "2026-09-21", "18:30")).toBe(true);
    // Written the next morning.
    expect(isLate(new Date("2026-09-22T01:00:00Z"), "2026-09-21", "23:59")).toBe(true);
  });
});

describe("dates", () => {
  it("weekdays and Mondays", () => {
    expect(isoWeekday("2026-09-21")).toBe(1);
    expect(isoWeekday("2026-09-27")).toBe(7);
    expect(weekStartOf("2026-09-27")).toBe("2026-09-21");
    expect(weekStartOf("2026-09-21")).toBe("2026-09-21");
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28");
  });
});
