// Golden tests for the rules around attendance requests and the monthly lock.
import { describe, expect, it } from "vitest";
import { canLock, clockMinutes, correctionAllowed, lockIssues, overtimeCapWarnings, timeOffCenti, windowOf } from "./requests";

const CAPS = { monthlyHours: 40, yearlyHours: 200, yearlyHoursExtended: 300 };

describe("clock windows", () => {
  it("reads clock times and lets a window run past midnight", () => {
    expect(clockMinutes("08:30")).toBe(510);
    expect(clockMinutes("24:00")).toBeNull();
    expect(clockMinutes(null)).toBeNull();
    expect(windowOf("17:30", "20:00")).toEqual({ from: 1050, to: 1200, minutes: 150 });
    expect(windowOf("22:00", "02:00")).toEqual({ from: 1320, to: 1560, minutes: 240 });
    expect(windowOf("09:00", "09:00")).toBeNull();
  });
});

describe("correction cap (FR-ATT-10)", () => {
  it("counts down, stops the person at the cap, lets HR file beyond it, and means nothing when unset", () => {
    expect(correctionAllowed({ usedThisMonth: 0, cap: 3, filedByHr: false })).toEqual({ allowed: true, remaining: 3 });
    expect(correctionAllowed({ usedThisMonth: 2, cap: 3, filedByHr: false })).toEqual({ allowed: true, remaining: 1 });
    expect(correctionAllowed({ usedThisMonth: 3, cap: 3, filedByHr: false })).toEqual({ allowed: false, remaining: 0 });
    expect(correctionAllowed({ usedThisMonth: 5, cap: 3, filedByHr: true })).toEqual({ allowed: true, remaining: 0 });
    expect(correctionAllowed({ usedThisMonth: 9, cap: null, filedByHr: false })).toEqual({ allowed: true, remaining: null });
    expect(correctionAllowed({ usedThisMonth: 9, cap: 0, filedByHr: false })).toEqual({ allowed: true, remaining: null });
  });
});

describe("overtime caps (FR-ATT-12)", () => {
  it("says nothing well below the caps or when the caps are not configured", () => {
    expect(overtimeCapWarnings({ monthMinutes: 600, yearMinutes: 3000, addMinutes: 120, caps: CAPS })).toEqual([]);
    expect(overtimeCapWarnings({ monthMinutes: 99_999, yearMinutes: 99_999, addMinutes: 120, caps: null })).toEqual([]);
  });

  it("warns from 80% of the month and says so when the request crosses it", () => {
    expect(overtimeCapWarnings({ monthMinutes: 1800, yearMinutes: 1800, addMinutes: 120, caps: CAPS })).toEqual([{ code: "ot_month_near", limitMinutes: 2400, totalMinutes: 1920 }]);
    expect(overtimeCapWarnings({ monthMinutes: 2340, yearMinutes: 2340, addMinutes: 120, caps: CAPS })).toEqual([{ code: "ot_month_cap", limitMinutes: 2400, totalMinutes: 2460 }]);
    // Exactly at the cap is still inside it.
    expect(overtimeCapWarnings({ monthMinutes: 2280, yearMinutes: 2280, addMinutes: 120, caps: CAPS })).toEqual([{ code: "ot_month_near", limitMinutes: 2400, totalMinutes: 2400 }]);
  });

  it("knows the two yearly ceilings", () => {
    expect(overtimeCapWarnings({ monthMinutes: 0, yearMinutes: 9600, addMinutes: 60, caps: CAPS })).toEqual([{ code: "ot_year_near", limitMinutes: 12_000, totalMinutes: 9660 }]);
    expect(overtimeCapWarnings({ monthMinutes: 0, yearMinutes: 12_000, addMinutes: 60, caps: CAPS })).toEqual([{ code: "ot_year_cap", limitMinutes: 12_000, totalMinutes: 12_060 }]);
    expect(overtimeCapWarnings({ monthMinutes: 0, yearMinutes: 18_000, addMinutes: 60, caps: CAPS })).toEqual([{ code: "ot_year_cap_extended", limitMinutes: 18_000, totalMinutes: 18_060 }]);
  });
});

describe("time off in lieu", () => {
  it("is one for one in days of the person's standard day, rounded down", () => {
    expect(timeOffCenti(480, 480)).toBe(100);
    expect(timeOffCenti(135, 480)).toBe(28);
    expect(timeOffCenti(240, 240)).toBe(100);
    expect(timeOffCenti(0, 480)).toBe(0);
    expect(timeOffCenti(60, 0)).toBe(0);
  });
});

describe("lock pre-check (FR-ATT-14)", () => {
  const clean = { monthStatus: "approved" as const, missingPunchDays: 0, punchesToReview: 0, pendingRequests: 0, unconfirmedHolidayWork: 0, absentDays: 0, unapprovedOvertimeDays: 0 };

  it("lets a month of approved people with nothing open through", () => {
    const issues = lockIssues([{ personId: "a", ...clean }, { personId: "b", ...clean, monthStatus: "locked" }]);
    expect(issues).toEqual([]);
    expect(canLock(issues, false)).toBe(true);
  });

  it("blocks on unapproved months, unknown hours, open reviews and requests, holiday work without hours", () => {
    const issues = lockIssues([
      { personId: "a", ...clean, monthStatus: "confirmed" },
      { personId: "b", ...clean, missingPunchDays: 2, punchesToReview: 1 },
      { personId: "c", ...clean, monthStatus: "open", pendingRequests: 1, unconfirmedHolidayWork: 1 },
    ]);
    expect(issues).toEqual([
      { personId: "a", code: "not_approved", count: 1, blocking: true },
      { personId: "b", code: "missing_punch", count: 2, blocking: true },
      { personId: "b", code: "punch_to_review", count: 1, blocking: true },
      { personId: "c", code: "not_approved", count: 1, blocking: true },
      { personId: "c", code: "request_pending", count: 1, blocking: true },
      { personId: "c", code: "holiday_work_unconfirmed", count: 1, blocking: true },
    ]);
    expect(canLock(issues, false)).toBe(false);
    expect(canLock(issues, true)).toBe(true);
  });

  it("only warns about absences and unapproved overtime: they are facts of the month, not gaps", () => {
    const issues = lockIssues([{ personId: "a", ...clean, absentDays: 1, unapprovedOvertimeDays: 3 }]);
    expect(issues).toEqual([{ personId: "a", code: "absent", count: 1, blocking: false }, { personId: "a", code: "ot_unapproved", count: 3, blocking: false }]);
    expect(canLock(issues, false)).toBe(true);
  });
});
