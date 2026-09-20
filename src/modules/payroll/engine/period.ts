// The shape of a payroll period and the inputs one person brings to it. Pure; no I/O.
//
// Everything the engine is given is already integer: money in VND, time in minutes, days in
// hundredths of a day (the convention of the leave ledger and the locked timesheet).
import type { IsoDate } from "@/lib/dates";
import type { SalaryTerms } from "../enums";

export type PayPeriod = {
  /** "2026-08". */
  month: string;
  start: IsoDate;
  end: IsoDate;
  /** Days on the calendar, 28–31. */
  calendarDays: number;
  /**
   * Working days the **month** asks of a full-time person in this entity — the divisor a full
   * month's salary is divided by. Deliberately not the person's own `timesheet.standardDays`:
   * someone who joined on the 17th has 11 of those, and dividing their salary by 11 would pay
   * them the whole month.
   */
  standardDays: number;
};

/** The period's calendar shape. `standardDays` comes from the working calendar and must be supplied. */
export function payPeriodOf(month: string, standardDays: number): PayPeriod {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) throw new RangeError(`not a payroll month: ${month}`);
  const calendarDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { month, start: `${month}-01`, end: `${month}-${String(calendarDays).padStart(2, "0")}`, calendarDays, standardDays };
}

/** Whole days from `from` to `to`, both inclusive. */
export const daysBetween = (from: IsoDate, to: IsoDate): number => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const laterOf = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
export const earlierOf = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

/**
 * A stretch of the month over which the person's pay terms and pay profile do not change
 * (FR-PAY-16: a mid-month salary change, or a move between pay profiles, starts a new segment).
 * The caller cuts the month at every change and says how much of the month's attendance falls in
 * each piece.
 */
export type PaySegment = {
  from: IsoDate;
  to: IsoDate;
  terms: SalaryTerms;
  /** Which working days of the month fall inside the segment, and how many of them were paid. */
  standardDays: number;
  paidDaysCenti: number;
  unpaidDaysCenti: number;
};

/** The pay profile facts the engine needs. A person's profile may not change inside a period. */
export type ProfileFacts = {
  profile: "statutory" | "simple";
  taxResidency: "resident" | "non_resident";
  pitMethod: "progressive" | "flat_without_contract" | "flat_non_resident";
  /** Form 08/CK-TNCN on file: no 10% withholding although there is no long contract (FR-PAY-14). */
  pitCommitment: boolean;
  insuranceExemption: "probation" | "retiree" | "insured_elsewhere" | "foreigner" | "other" | null;
  unionMember: boolean;
};

/** The month's attendance, as the locked timesheet froze it (`getLockedTimesheets`). */
export type TimesheetTotals = {
  standardDays: number;
  standardMinutes: number;
  paidDaysCenti: number;
  unpaidDaysCenti: number;
  workedMinutes: number;
  nightMinutes: number;
  /** Payable overtime minutes per category, day and night apart. Time off in lieu is already out. */
  overtime: { weekday: { day: number; night: number }; restDay: { day: number; night: number }; holiday: { day: number; night: number } };
};

export const EMPTY_TIMESHEET: TimesheetTotals = { standardDays: 0, standardMinutes: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, workedMinutes: 0, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } };

/**
 * Overtime the company pays for. The locked timesheet counts the minutes taken as time off in
 * lieu in one figure without saying which category they came from, so they are taken off the
 * categories in proportion — rule `time_off_proportional`, largest remainder so the total is
 * exact. (If attendance ever splits them per category, pass the split straight through.)
 */
export function payableOvertime(overtime: TimesheetTotals["overtime"], timeOffMinutes: number): TimesheetTotals["overtime"] {
  const slots = [
    ["weekday", "day"],
    ["weekday", "night"],
    ["restDay", "day"],
    ["restDay", "night"],
    ["holiday", "day"],
    ["holiday", "night"],
  ] as const;
  const minutes = slots.map(([category, part]) => overtime[category][part]);
  const total = minutes.reduce((sum, value) => sum + value, 0);
  const taken = Math.max(0, Math.min(timeOffMinutes, total));
  if (taken === 0 || total === 0) return { weekday: { ...overtime.weekday }, restDay: { ...overtime.restDay }, holiday: { ...overtime.holiday } };

  const exact = minutes.map((value) => (value * taken) / total);
  const shares = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - shares[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let left = taken - shares.reduce((sum, value) => sum + value, 0);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  const result = { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } };
  slots.forEach(([category, part], index) => {
    result[category][part] = minutes[index] - shares[index];
  });
  return result;
}
