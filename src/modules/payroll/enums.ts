// Value lists and plain shapes shared by the server, client components and the demo seed.
// (Constants exported from a "use client" file are client references on the server.)
import { z } from "zod";
import { ROUNDING_RULES } from "./engine/rounding";

export const PAY_PROFILES = ["statutory", "simple"] as const;
export type PayProfileKind = (typeof PAY_PROFILES)[number];
export const SIMPLE_BASES = ["probation", "internship", "service_contract", "short_term", "retiree", "other"] as const;
export type SimpleBasis = (typeof SIMPLE_BASES)[number];
export const TAX_RESIDENCIES = ["resident", "non_resident"] as const;
export const PIT_METHODS = ["progressive", "flat_without_contract", "flat_non_resident"] as const;
export const INSURANCE_EXEMPTIONS = ["probation", "retiree", "insured_elsewhere", "foreigner", "other"] as const;

export const COMPONENT_KINDS = ["earning", "deduction", "employer_cost"] as const;
export const COMPONENT_CATEGORIES = ["salary", "allowance", "overtime", "bonus", "commission", "thirteenth_month", "holiday_bonus", "leave_payout", "retro", "insurance", "pit", "union", "advance", "penalty", "asset_compensation", "loan", "other"] as const;
export const COMPONENT_SOURCES = ["structure", "formula", "engine", "input"] as const;
export const TAX_TREATMENTS = ["taxable", "exempt", "exempt_up_to_cap"] as const;
export const PRORATIONS = ["fixed", "attendance"] as const;
export const ROUNDING_RULE_NAMES = Object.keys(ROUNDING_RULES) as (keyof typeof ROUNDING_RULES)[];

export const SALARY_CHANGE_REASONS = ["initial", "probation_end", "raise", "promotion", "adjustment", "contract_renewal"] as const;
export type SalaryChangeReason = (typeof SALARY_CHANGE_REASONS)[number];

/** A person's pay terms: what `salary_structure.terms_enc` holds once decrypted. Integer VND. */
const vnd = z.number().int().min(0).max(100_000_000_000);
export const salaryTermsSchema = z
  .object({
    baseSalary: vnd,
    // The contribution base for compulsory insurance; may differ from the base salary (FR-PAY-01).
    insuranceSalary: vnd,
    allowances: z.array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), amount: vnd })).max(30),
  })
  .refine((terms) => new Set(terms.allowances.map((line) => line.code)).size === terms.allowances.length, "duplicate_allowance");
export type SalaryTerms = z.output<typeof salaryTermsSchema>;

/** Company pay rules per entity — choices, not law (law is in the statutory store). */
export const payrollPolicySchema = z.object({
  // FR-PAY-16: the month's own working days, calendar days, or a fixed divisor such as 26.
  prorationBasis: z.enum(["working_days", "calendar_days", "fixed_days"]),
  fixedDays: z.number().int().min(20).max(31).nullable(),
  hoursPerDay: z.number().int().min(1).max(12),
  // The hourly rate overtime multiplies: base salary only, or base plus the allowances that count as salary.
  overtimeBase: z.enum(["base_salary", "base_plus_insurable_allowances"]),
  // FR-PAY-12: does the entity have a union (employer fund + member dues)?
  unionEnabled: z.boolean(),
  // FR-PAY-07: PIT under the Simple profile — nothing, or the flat withholding of `pit.flat_rates`.
  simplePitTreatment: z.enum(["none", "flat_withholding"]),
  // FR-PAY-31: a net change beyond this (basis points) against last month is an anomaly.
  varianceThresholdBp: z.number().int().min(0).max(100_000),
  // FR-PAY-30: the day salaries are paid, and which way it moves off a non-banking day.
  payDay: z.number().int().min(1).max(28),
  payDayShift: z.enum(["previous_working_day", "next_working_day"]),
});
export type PayrollPolicyValue = z.output<typeof payrollPolicySchema>;

export const DEFAULT_PAYROLL_POLICY: PayrollPolicyValue = {
  prorationBasis: "working_days",
  fixedDays: null,
  hoursPerDay: 8,
  overtimeBase: "base_salary",
  unionEnabled: false,
  simplePitTreatment: "none",
  varianceThresholdBp: 1000,
  payDay: 5,
  payDayShift: "previous_working_day",
};
