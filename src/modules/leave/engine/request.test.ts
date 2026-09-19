// Golden tests for counting and checking leave requests (FR-LVE-04, 05).
import { describe, expect, it } from "vitest";
import { type CheckInput, checkLeaveRequest, countLeaveDays, type PlannedDay, portionsClash, staffingShortfalls, type TypeRules } from "./request";

// Thu 27 Aug … Thu 3 Sep 2026: a weekend, an untracked Saturday and the 2 September holiday.
const WEEK: PlannedDay[] = [
  { date: "2026-08-27", kind: "working", requiredMinutes: 480 },
  { date: "2026-08-28", kind: "working", requiredMinutes: 480 },
  { date: "2026-08-29", kind: "untracked", requiredMinutes: 480 },
  { date: "2026-08-30", kind: "rest", requiredMinutes: 0 },
  { date: "2026-08-31", kind: "working", requiredMinutes: 480 },
  { date: "2026-09-01", kind: "holiday", requiredMinutes: 0 },
  { date: "2026-09-02", kind: "holiday", requiredMinutes: 0 },
  { date: "2026-09-03", kind: "working", requiredMinutes: 480 },
];
const count = (days: PlannedDay[], overrides: Partial<Parameters<typeof countLeaveDays>[0]> = {}) => countLeaveDays({ days, startPortion: "full", endPortion: "full", minutes: null, countsUntracked: false, ...overrides });

describe("counting leave days", () => {
  it("costs working days only: weekends, holidays and the untracked Saturday are free", () => {
    const result = count(WEEK);
    expect(result.totalCenti).toBe(400);
    expect(result.days.map((day) => day.date)).toEqual(["2026-08-27", "2026-08-28", "2026-08-31", "2026-09-03"]);
  });

  it("counts the untracked Saturday for types that say so (unpaid, long absences)", () => {
    expect(count(WEEK, { countsUntracked: true }).totalCenti).toBe(500);
  });

  it("takes half days at either end", () => {
    const result = count(WEEK.slice(0, 2), { startPortion: "pm", endPortion: "am" });
    expect(result.days).toEqual([
      { date: "2026-08-27", portion: "pm", amountCenti: 50, minutes: null },
      { date: "2026-08-28", portion: "am", amountCenti: 50, minutes: null },
    ]);
    expect(result.totalCenti).toBe(100);
  });

  it("takes a morning, an afternoon or hours of one day", () => {
    expect(count(WEEK.slice(0, 1), { startPortion: "am" }).totalCenti).toBe(50);
    expect(count(WEEK.slice(0, 1), { startPortion: "pm" }).days[0].portion).toBe("pm");
    expect(count(WEEK.slice(0, 1), { startPortion: "hours", minutes: 120 }).days[0]).toEqual({ date: "2026-08-27", portion: "hours", amountCenti: 25, minutes: 120 });
  });

  it("measures hours against the day's own required time (a part-time morning)", () => {
    expect(count([{ date: "2026-08-31", kind: "working", requiredMinutes: 210 }], { startPortion: "hours", minutes: 105 }).totalCenti).toBe(50);
  });

  it("refuses hours that make a whole day, portions that make no sense, and a request without working days", () => {
    expect(count(WEEK.slice(0, 1), { startPortion: "hours", minutes: 480 }).problems).toEqual(["leave_minutes_invalid"]);
    expect(count(WEEK.slice(0, 1), { startPortion: "hours" }).problems).toContain("leave_minutes_invalid");
    expect(count(WEEK.slice(0, 2), { startPortion: "am" }).problems).toEqual(["leave_portion_invalid"]);
    expect(count(WEEK.slice(0, 2), { endPortion: "pm" }).problems).toEqual(["leave_portion_invalid"]);
    expect(count(WEEK.slice(2, 4)).problems).toEqual(["leave_no_working_days"]);
    expect(count([]).problems).toEqual(["leave_dates_invalid"]);
  });
});

describe("portions", () => {
  it("lets the two halves of a day coexist and nothing else", () => {
    expect(portionsClash("am", "pm")).toBe(false);
    expect(portionsClash("pm", "am")).toBe(false);
    expect(portionsClash("am", "am")).toBe(true);
    expect(portionsClash("full", "pm")).toBe(true);
    expect(portionsClash("hours", "am")).toBe(true);
  });
});

const ANNUAL: TypeRules = { isActive: true, tracksBalance: true, allowHalfDay: true, allowHourly: false, requiresAttachment: false, noticeDays: 3, allowBackdated: false, maxDaysPerRequestCenti: null, eligibleWorkforceTypes: ["employee", "probation", "part_time"], gender: null, minSeniorityMonths: null };
const PERSON = { workforceType: "employee", gender: "female", seniorityDate: "2023-07-17", employmentStart: "2023-07-17", employmentEnd: null, onProbationAtStart: false };

function check(overrides: Partial<CheckInput> = {}, days: PlannedDay[] = WEEK.slice(0, 2)) {
  const counted = overrides.counted ?? count(days);
  return checkLeaveRequest({
    type: ANNUAL,
    policy: { probationRule: "accrue_no_use", allowNegativeCenti: 0 },
    person: PERSON,
    filedOn: "2026-08-20",
    filedByHr: false,
    startDate: days[0].date,
    endDate: days.at(-1)!.date,
    counted,
    hasAttachment: false,
    availableByYear: { 2026: 600 },
    existingDays: [],
    ...overrides,
  });
}

describe("checking a request", () => {
  it("passes a plain request inside the balance", () => {
    expect(check()).toEqual([]);
  });

  it("refuses more than the balance, counting what pending requests already hold", () => {
    expect(check({ availableByYear: { 2026: 150 } })).toEqual(["leave_balance_insufficient"]);
    expect(check({ availableByYear: { 2026: 200 } })).toEqual([]);
  });

  it("lets the policy allow leave in advance", () => {
    expect(check({ availableByYear: { 2026: 0 }, policy: { probationRule: "accrue_and_use", allowNegativeCenti: 200 } })).toEqual([]);
  });

  it("checks each leave year on its own", () => {
    const newYear: PlannedDay[] = [
      { date: "2026-12-31", kind: "working", requiredMinutes: 480 },
      { date: "2027-01-04", kind: "working", requiredMinutes: 480 },
    ];
    expect(check({ availableByYear: { 2026: 500 }, filedOn: "2026-12-01" }, newYear)).toEqual(["leave_balance_insufficient"]);
    expect(check({ availableByYear: { 2026: 500, 2027: 100 }, filedOn: "2026-12-01" }, newYear)).toEqual([]);
  });

  it("does not look at a balance for types that keep none", () => {
    expect(check({ type: { ...ANNUAL, tracksBalance: false }, availableByYear: {} })).toEqual([]);
  });

  it("wants notice, refuses back-dating — unless the type allows it or HR files it", () => {
    expect(check({ filedOn: "2026-08-25" })).toEqual(["leave_notice_too_short"]);
    expect(check({ filedOn: "2026-08-28" })).toEqual(["leave_backdated"]);
    expect(check({ filedOn: "2026-08-28", type: { ...ANNUAL, allowBackdated: true, noticeDays: 0 } })).toEqual([]);
    expect(check({ filedOn: "2026-08-28", filedByHr: true })).toEqual([]);
  });

  it("applies the type's limits: length, half days, hours, attachment", () => {
    expect(check({ type: { ...ANNUAL, maxDaysPerRequestCenti: 100 } })).toEqual(["leave_too_long"]);
    expect(check({ type: { ...ANNUAL, allowHalfDay: false }, counted: count(WEEK.slice(0, 1), { startPortion: "am" }) }, WEEK.slice(0, 1))).toEqual(["leave_half_day_not_allowed"]);
    expect(check({ counted: count(WEEK.slice(0, 1), { startPortion: "hours", minutes: 60 }) }, WEEK.slice(0, 1))).toEqual(["leave_hourly_not_allowed"]);
    expect(check({ type: { ...ANNUAL, requiresAttachment: true } })).toEqual(["leave_attachment_required"]);
    expect(check({ type: { ...ANNUAL, requiresAttachment: true }, hasAttachment: true })).toEqual([]);
  });

  it("applies eligibility: workforce type, gender, seniority, employment dates", () => {
    expect(check({ person: { ...PERSON, workforceType: "collaborator" } })).toEqual(["leave_not_eligible_workforce"]);
    expect(check({ type: { ...ANNUAL, gender: "male" } })).toEqual(["leave_not_eligible_gender"]);
    expect(check({ type: { ...ANNUAL, minSeniorityMonths: 48 } })).toEqual(["leave_not_eligible_seniority"]);
    expect(check({ type: { ...ANNUAL, minSeniorityMonths: 36 } })).toEqual([]);
    expect(check({ person: { ...PERSON, employmentEnd: "2026-08-27" } })).toEqual(["leave_outside_employment"]);
  });

  it("keeps balance leave from people on probation unless the policy lets them use it", () => {
    expect(check({ person: { ...PERSON, onProbationAtStart: true } })).toEqual(["leave_on_probation"]);
    expect(check({ person: { ...PERSON, onProbationAtStart: true }, policy: { probationRule: "accrue_and_use", allowNegativeCenti: 0 } })).toEqual([]);
    expect(check({ person: { ...PERSON, onProbationAtStart: true }, type: { ...ANNUAL, tracksBalance: false } })).toEqual([]);
  });

  it("refuses days already taken, except the other half of a day", () => {
    expect(check({ existingDays: [{ date: "2026-08-28", portion: "full" }] })).toEqual(["leave_overlaps"]);
    expect(check({ existingDays: [{ date: "2026-08-27", portion: "am" }], counted: count(WEEK.slice(0, 1), { startPortion: "pm" }) }, WEEK.slice(0, 1))).toEqual([]);
  });

  it("reports everything at once", () => {
    expect(check({ filedOn: "2026-08-26", availableByYear: { 2026: 0 }, type: { ...ANNUAL, requiresAttachment: true } }).sort()).toEqual(["leave_attachment_required", "leave_balance_insufficient", "leave_notice_too_short"]);
  });
});

describe("minimum staffing", () => {
  it("names the dates on which too few people would be at work, the requester included among the absent", () => {
    const result = staffingShortfalls({ dates: ["2026-08-27", "2026-08-28"], headcount: 5, minPresent: 3, awayByDate: { "2026-08-27": 2 } });
    expect(result).toEqual([{ date: "2026-08-27", present: 2 }]);
  });
});
