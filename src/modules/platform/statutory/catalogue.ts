// Every statutory parameter the system knows, and the shape of its value. Plain module.
// Conventions: money is integer VND; rates are basis points (8% = 800) so nothing is a float;
// multipliers are whole percents (150 = 150%).
import { z } from "zod";

const vnd = z.number().int().nonnegative();
const basisPoints = z.number().int().min(0).max(10_000);
const percent = z.number().int().min(0).max(1_000);
const count = z.number().int().nonnegative();

export const PARAMETERS = {
  "insurance.employee_rates": z.object({ bhxh: basisPoints, bhyt: basisPoints, bhtn: basisPoints }),
  "insurance.employer_rates": z.object({ bhxh: basisPoints, bhyt: basisPoints, bhtn: basisPoints }),
  // BHXH/BHYT are capped at a multiple of the reference level; BHTN at a multiple of the regional minimum wage.
  "insurance.reference_level": z.object({ amount: vnd }),
  "insurance.cap_multipliers": z.object({ bhxhBhyt: count, bhtn: count }),
  "union.rates": z.object({ employerFund: basisPoints, memberDues: basisPoints }),
  // Member dues stop at a share of the reference level (payroll, Phase 5).
  "union.dues_cap": z.object({ referenceLevelShare: basisPoints }),
  // A month with this many unpaid working days (or more) carries no compulsory insurance at all.
  "insurance.unpaid_leave_threshold": z.object({ workingDays: count }),
  // What part of overtime and night pay is exempt from PIT: only what exceeds ordinary-hours pay, or all of it.
  "pit.overtime_exemption": z.object({ mode: z.enum(["premium_only", "full"]) }),
  "wage.regional_minimum": z.object({ region1: vnd, region2: vnd, region3: vnd, region4: vnd }),
  "pit.deductions": z.object({ personal: vnd, dependent: vnd }),
  // Monthly assessable income. Ascending; the last bracket has no upper bound.
  "pit.brackets": z
    .array(z.object({ upTo: vnd.nullable(), rate: basisPoints }))
    .min(1)
    .refine((brackets) => brackets.at(-1)?.upTo === null && brackets.slice(0, -1).every((bracket, index) => bracket.upTo !== null && (index === 0 || bracket.upTo > (brackets[index - 1].upTo ?? 0))), "brackets must ascend and end with an open bracket"),
  "pit.flat_rates": z.object({ nonResident: basisPoints, withoutContract: basisPoints, withoutContractThreshold: vnd }),
  "overtime.multipliers": z.object({ weekday: percent, restDay: percent, holiday: percent, nightPremium: percent, nightOvertimeExtra: percent }),
  // Night work (night premium, night overtime): local clock times, the window runs past midnight.
  "work.night_window": z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  "overtime.caps": z.object({ monthlyHours: count, yearlyHours: count, yearlyHoursExtended: count }),
  "leave.annual": z.object({ baseDays: count, yearsOfServicePerExtraDay: count }),
  "probation.limits": z.object({ managerDays: count, professionalDays: count, intermediateDays: count, otherDays: count, minimumPayPercent: percent }),
  "contract.fixed_term": z.object({ maxMonths: count, maxFixedTermRenewals: count }),
  // Not law but company practice, kept here so it is effective-dated and owner-approved like the rest:
  // how many days ahead HR and managers are warned. Each list is a countdown, e.g. [45, 30, 15].
  "hr.alert_thresholds": z.object({ contractExpiryDays: z.array(count).min(1), probationEndDays: z.array(count).min(1), documentExpiryDays: z.array(count).min(1) }),
} as const;

export type ParameterKey = keyof typeof PARAMETERS;
export type ParameterValue<Key extends ParameterKey> = z.output<(typeof PARAMETERS)[Key]>;

export const PARAMETER_KEYS = Object.keys(PARAMETERS) as ParameterKey[];

export const isParameterKey = (key: string): key is ParameterKey => key in PARAMETERS;
