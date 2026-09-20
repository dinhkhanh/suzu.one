// Stage 1 — pro-rating (FR-PAY-16). Pure.
//
// A month's salary is only whole when the person was there for all of it and was paid for every
// working day. A joiner, a leaver, unpaid leave and a mid-month salary change each cut it down,
// and the entity's policy says by which yardstick:
//
//   working_days   the month's own working days from the locked timesheet (the common choice)
//   calendar_days  the days on the calendar — 28 in February, 31 in August
//   fixed_days     a fixed divisor, usually 26, so every month pays the same for a full month
//
// Nothing here knows a legal figure: the divisor is a company choice, and the days come from the
// locked timesheet. Attendance-prorated components are cut; fixed ones only follow the segment.
import type { PayrollPolicyValue } from "../enums";
import { daysBetween, type PaySegment, type PayPeriod } from "./period";
import { ratio, type RoundingRule } from "./rounding";

export type ProrationBasis = PayrollPolicyValue["prorationBasis"];

/**
 * How many days a full month's pay is divided by — a property of the **month**, never of the
 * person: a joiner's own working days would otherwise divide their part-month salary back up to a
 * whole one. `working_days` falls back to the calendar if the month has none at all, so the
 * divisor is never zero.
 */
export function divisorDays(basis: ProrationBasis, policy: PayrollPolicyValue, period: PayPeriod): number {
  switch (basis) {
    case "calendar_days":
      return period.calendarDays;
    case "fixed_days":
      return policy.fixedDays ?? period.calendarDays;
    case "working_days":
      return period.standardDays > 0 ? period.standardDays : period.calendarDays;
  }
}

/**
 * The share of a full month a segment pays for.
 *
 * - `attendance`: paid days in the segment ÷ the month's divisor. Absence, unpaid leave and a
 *   part-month employment are all already in `paidDaysCenti` (the locked timesheet counted them),
 *   so one rule covers joiner, leaver and unpaid leave alike.
 * - `fixed`: the segment's share of the days the person was employed in the month — a phone
 *   allowance is not cut for a day off, but a raise on the 16th still splits the month.
 */
export function segmentShare(segment: PaySegment, proration: "fixed" | "attendance", divisor: number, employedDays: number): { numerator: number; denominator: number; rule: string } {
  if (proration === "attendance") return { numerator: segment.paidDaysCenti, denominator: divisor * 100, rule: "attendance_prorated" };
  const days = daysBetween(segment.from, segment.to);
  return employedDays > 0 && days < employedDays ? { numerator: days, denominator: employedDays, rule: "fixed_segment_share" } : { numerator: 1, denominator: 1, rule: "fixed_full" };
}

/** amount × share, under the component's own named rounding rule. */
export const applyShare = (amount: number, share: { numerator: number; denominator: number }, rule: RoundingRule): number => (share.numerator === share.denominator ? amount : ratio(amount, share.numerator, share.denominator, rule));

/** Days the person was actually employed inside the period — a mid-month joiner's or leaver's month. */
export function employedDaysIn(period: PayPeriod, startDate: string | null, endDate: string | null): number {
  const from = startDate && startDate > period.start ? startDate : period.start;
  const to = endDate && endDate < period.end ? endDate : period.end;
  return to < from ? 0 : daysBetween(from, to);
}

/**
 * Working days of the **month** the person was neither paid by the company nor covered: days
 * before they joined or after they left, days of unpaid leave, days of absence, and days the
 * insurance fund paid instead of the company (maternity, long sick leave). The insurance stage
 * tests this against `insurance.unpaid_leave_threshold` — 14 or more and the month carries no
 * compulsory insurance at all (FR-PAY-11). One rule covers joiner, leaver and unpaid leave alike.
 */
export function uncoveredWorkingDays(monthStandardDays: number, paidDaysCenti: number, insuranceLeaveDays: number): number {
  const paidDays = paidDaysCenti / 100;
  return Math.max(0, monthStandardDays - paidDays - insuranceLeaveDays) + insuranceLeaveDays;
}
