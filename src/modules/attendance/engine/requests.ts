// Rules around attendance requests and the monthly lock (FR-ATT-10, 12, 14, 18). Pure: no I/O.
// Legal numbers (overtime caps) and company numbers (the correction cap) arrive as arguments —
// from the statutory store and the entity's attendance policy.

/** "HH:mm" → minutes of the day; null when it is not a clock time. */
export function clockMinutes(value: string | null | undefined): number | null {
  const match = typeof value === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** A window on one day's clock; an end at or before the start runs past midnight (22:00 → 02:00). */
export function windowOf(from: string, to: string): { from: number; to: number; minutes: number } | null {
  const start = clockMinutes(from);
  const end = clockMinutes(to);
  if (start === null || end === null || start === end) return null;
  const until = end > start ? end : end + 1440;
  return { from: start, to: until, minutes: until - start };
}

// ── Correction cap (FR-ATT-10) ──────────────────────────────────────────────────────────────

export type CorrectionCapInput = { /** Pending and approved corrections for days of the same month, this one not included. */ usedThisMonth: number; /** null or 0 = no cap. */ cap: number | null; /** HR filing on someone's behalf is not held to the cap. */ filedByHr: boolean };

export function correctionAllowed(input: CorrectionCapInput): { allowed: boolean; remaining: number | null } {
  if (!input.cap || input.cap <= 0) return { allowed: true, remaining: null };
  const remaining = Math.max(0, input.cap - input.usedThisMonth);
  return { allowed: input.filedByHr || remaining > 0, remaining };
}

// ── Overtime caps (FR-ATT-12; Điều 107) ─────────────────────────────────────────────────────

export type OvertimeCaps = { monthlyHours: number; yearlyHours: number; yearlyHoursExtended: number };
export type OvertimeCapWarning = { code: "ot_month_cap" | "ot_year_cap" | "ot_year_cap_extended" | "ot_month_near" | "ot_year_near"; limitMinutes: number; totalMinutes: number };

/**
 * Warnings, never refusals: the law binds the employer, and the approver decides with the numbers
 * in front of them. `monthMinutes` / `yearMinutes` = overtime already worked or approved ahead,
 * without this request; "near" = at or above 80% of a cap.
 */
export function overtimeCapWarnings(input: { monthMinutes: number; yearMinutes: number; addMinutes: number; caps: OvertimeCaps | null }): OvertimeCapWarning[] {
  if (!input.caps) return [];
  const warnings: OvertimeCapWarning[] = [];
  const month = input.monthMinutes + input.addMinutes;
  const year = input.yearMinutes + input.addMinutes;
  const monthCap = input.caps.monthlyHours * 60;
  const yearCap = input.caps.yearlyHours * 60;
  const yearExtended = input.caps.yearlyHoursExtended * 60;
  if (month > monthCap) warnings.push({ code: "ot_month_cap", limitMinutes: monthCap, totalMinutes: month });
  else if (month * 5 >= monthCap * 4) warnings.push({ code: "ot_month_near", limitMinutes: monthCap, totalMinutes: month });
  if (year > yearExtended) warnings.push({ code: "ot_year_cap_extended", limitMinutes: yearExtended, totalMinutes: year });
  else if (year > yearCap) warnings.push({ code: "ot_year_cap", limitMinutes: yearCap, totalMinutes: year });
  else if (year * 5 >= yearCap * 4) warnings.push({ code: "ot_year_near", limitMinutes: yearCap, totalMinutes: year });
  return warnings;
}

/** Time off in lieu for overtime minutes, in hundredths of a day of `dayMinutes` (one for one; multipliers are payroll's when paid). Rounded down to a quarter day's hundredth. */
export function timeOffCenti(minutes: number, dayMinutes: number): number {
  if (minutes <= 0 || dayMinutes <= 0) return 0;
  return Math.floor((minutes * 100) / dayMinutes);
}

// ── Lock pre-check (FR-ATT-14) ──────────────────────────────────────────────────────────────

export type MonthStatus = "open" | "confirmed" | "approved" | "locked";
export type LockPersonInput = {
  personId: string;
  monthStatus: MonthStatus;
  /** Days whose worked time is unknown (a missing check-in or check-out). */
  missingPunchDays: number;
  /** Flagged check-ins nobody has accepted or rejected yet. */
  punchesToReview: number;
  /** Attendance requests for days of the month still waiting for an answer. */
  pendingRequests: number;
  /** Approved holiday / rest-day work whose hours nobody confirmed and punches do not show. */
  unconfirmedHolidayWork: number;
  /** Days with no work, no leave and no request: allowed (unpaid), but HR should have looked. */
  absentDays: number;
  unapprovedOvertimeDays: number;
};

export type LockIssueCode = "not_approved" | "missing_punch" | "punch_to_review" | "request_pending" | "holiday_work_unconfirmed" | "absent" | "ot_unapproved";
export type LockIssue = { personId: string; code: LockIssueCode; count: number; blocking: boolean };

/**
 * What stands between a month and its lock. Blocking: someone's month is not approved, a day's
 * hours are unknown, a flagged punch or a request still waits, holiday work has no hours.
 * Absences and unapproved overtime are warnings: they are a fact of the month (unpaid day, unpaid
 * extra time), not something missing.
 */
export function lockIssues(people: readonly LockPersonInput[]): LockIssue[] {
  const issues: LockIssue[] = [];
  for (const person of people) {
    const add = (code: LockIssueCode, count: number, blocking: boolean) => {
      if (count > 0) issues.push({ personId: person.personId, code, count, blocking });
    };
    add("not_approved", person.monthStatus === "approved" || person.monthStatus === "locked" ? 0 : 1, true);
    add("missing_punch", person.missingPunchDays, true);
    add("punch_to_review", person.punchesToReview, true);
    add("request_pending", person.pendingRequests, true);
    add("holiday_work_unconfirmed", person.unconfirmedHolidayWork, true);
    add("absent", person.absentDays, false);
    add("ot_unapproved", person.unapprovedOvertimeDays, false);
  }
  return issues;
}

export const canLock = (issues: readonly LockIssue[], override: boolean): boolean => override || !issues.some((issue) => issue.blocking);
