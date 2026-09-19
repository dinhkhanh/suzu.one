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
  "wage.regional_minimum": z.object({ region1: vnd, region2: vnd, region3: vnd, region4: vnd }),
  "pit.deductions": z.object({ personal: vnd, dependent: vnd }),
  // Monthly assessable income. Ascending; the last bracket has no upper bound.
  "pit.brackets": z
    .array(z.object({ upTo: vnd.nullable(), rate: basisPoints }))
    .min(1)
    .refine((brackets) => brackets.at(-1)?.upTo === null && brackets.slice(0, -1).every((bracket, index) => bracket.upTo !== null && (index === 0 || bracket.upTo > (brackets[index - 1].upTo ?? 0))), "brackets must ascend and end with an open bracket"),
  "pit.flat_rates": z.object({ nonResident: basisPoints, withoutContract: basisPoints, withoutContractThreshold: vnd }),
  "overtime.multipliers": z.object({ weekday: percent, restDay: percent, holiday: percent, nightPremium: percent, nightOvertimeExtra: percent }),
  "overtime.caps": z.object({ monthlyHours: count, yearlyHours: count, yearlyHoursExtended: count }),
  "leave.annual": z.object({ baseDays: count, yearsOfServicePerExtraDay: count }),
  "probation.limits": z.object({ managerDays: count, professionalDays: count, intermediateDays: count, otherDays: count, minimumPayPercent: percent }),
  "contract.fixed_term": z.object({ maxMonths: count, maxFixedTermRenewals: count }),
} as const;

export type ParameterKey = keyof typeof PARAMETERS;
export type ParameterValue<Key extends ParameterKey> = z.output<(typeof PARAMETERS)[Key]>;

export const PARAMETER_KEYS = Object.keys(PARAMETERS) as ParameterKey[];

export const isParameterKey = (key: string): key is ParameterKey => key in PARAMETERS;
