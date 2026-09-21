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

export const SALARY_CHANGE_REASONS = ["initial", "probation_end", "raise", "promotion", "adjustment", "contract_renewal", "decrease"] as const;
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

// ── The performance-driven year-end bonus (FR-PAY-21, SRS D13, Q14 — Phase 8 week 3) ────────
// The whole formula is **configuration the owner approves**, effective-dated like a pay policy:
// which pay component it is paid under, what the base month is, the service-time factor, the
// individual performance multiplier, the unit OKR multiplier, the cap and the rounding. Nothing
// below is a constant the code decides — this file only says what shape a scheme has.

export const BONUS_MULTIPLIER_SOURCES = ["result_band", "scheme_bands"] as const;
export type BonusMultiplierSource = (typeof BONUS_MULTIPLIER_SOURCES)[number];

/** Which OKR figure the collective half of the formula reads. "none" = no collective multiplier. */
export const BONUS_OKR_LEVELS = ["none", "team", "department", "entity", "group"] as const;
export type BonusOkrLevel = (typeof BONUS_OKR_LEVELS)[number];

/** Why somebody is in the run with nothing. Recorded on the line, shown on the simulation. */
export const BONUS_EXCLUSIONS = ["not_active", "workforce_type", "service_too_short", "no_result", "no_band", "no_salary"] as const;
export type BonusExclusion = (typeof BONUS_EXCLUSIONS)[number];

const bonusBp = (max: number) => z.number().int().min(0).max(max);
const bandLabel = z.string().trim().min(1).max(120);

/** Service time → a factor: somebody who joined in November does not get a full year's bonus. */
export const serviceBandSchema = z.object({ minMonths: z.number().int().min(0).max(600), label: bandLabel, factorBp: bonusBp(20_000) });
export type ServiceBand = z.output<typeof serviceBandSchema>;

/** A score → a multiplier. The scheme's own table, used when `source` is `scheme_bands`. */
export const bonusScoreBandSchema = z.object({ key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), label: bandLabel, minScoreBp: bonusBp(1_000_000), multiplierBp: bonusBp(1_000_000) });
export type BonusScoreBand = z.output<typeof bonusScoreBandSchema>;

/** Unit OKR attainment → a multiplier: everyone's bonus moves with the unit's year. */
export const bonusOkrBandSchema = z.object({ label: bandLabel, minProgressBp: bonusBp(1_000_000), multiplierBp: bonusBp(1_000_000) });
export type BonusOkrBand = z.output<typeof bonusOkrBandSchema>;

export const bonusSchemeSchema = z
  .object({
    /** The pay component the amount is paid under — it decides tax and insurance treatment. */
    payComponentCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    /** Which salary figure "one month's salary" means. */
    baseComponentCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    /** MM-DD: the day of the bonus year service time and employment are measured on. */
    referenceDay: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    /** Amounts are rounded to this many đồng (nearest, halves up). 1 = no rounding. */
    roundingVnd: z.number().int().min(1).max(1_000_000),
    /** Nothing may come out above this multiple of a month's salary, whatever the bands say. */
    capMultiplierBp: bonusBp(1_000_000),
    serviceBands: z.array(serviceBandSchema).min(1).max(12),
    performanceMultiplier: z.object({
      // `result_band` takes the multiplier FR-PRF-09 already published with the result; the
      // scheme's own table is what a "what if we paid this table instead" simulation uses.
      source: z.enum(BONUS_MULTIPLIER_SOURCES),
      bands: z.array(bonusScoreBandSchema).min(1).max(12),
    }),
    unitOkr: z.object({ level: z.enum(BONUS_OKR_LEVELS), bands: z.array(bonusOkrBandSchema).min(1).max(12) }),
    eligibility: z.object({
      minServiceMonths: z.number().int().min(0).max(600),
      excludeWorkforceTypes: z.array(z.string().trim().max(40)).max(10),
      /** Must the person still be employed on the reference day? */
      requireActive: z.boolean(),
      /** Must there be a locked or published performance result? */
      requireResult: z.boolean(),
    }),
  })
  .refine((value) => value.serviceBands.some((band) => band.minMonths === 0), "no_bottom_service_band")
  .refine((value) => new Set(value.serviceBands.map((band) => band.minMonths)).size === value.serviceBands.length, "duplicate_service_band")
  .refine((value) => value.performanceMultiplier.bands.some((band) => band.minScoreBp === 0), "no_bottom_performance_band")
  .refine((value) => new Set(value.performanceMultiplier.bands.map((band) => band.key)).size === value.performanceMultiplier.bands.length, "duplicate_performance_band")
  .refine((value) => value.unitOkr.bands.some((band) => band.minProgressBp === 0), "no_bottom_okr_band");
export type BonusSchemeValue = z.output<typeof bonusSchemeSchema>;

/**
 * The starter scheme the demo seeds — SRS Q14's first answer, for the owner to change:
 * one month's salary at "meets expectations" and a full year of service, 1.5× at "outstanding",
 * nothing below expectations, and the whole thing moved ±20 % by the entity's OKR year.
 */
export const DEFAULT_BONUS_SCHEME: BonusSchemeValue = {
  payComponentCode: "THIRTEENTH_MONTH",
  baseComponentCode: "BASE",
  referenceDay: "12-31",
  roundingVnd: 1_000,
  capMultiplierBp: 30_000,
  serviceBands: [
    { minMonths: 0, label: "Dưới 3 tháng", factorBp: 0 },
    { minMonths: 3, label: "3–5 tháng", factorBp: 2_500 },
    { minMonths: 6, label: "6–11 tháng", factorBp: 5_000 },
    { minMonths: 12, label: "Từ 12 tháng", factorBp: 10_000 },
  ],
  performanceMultiplier: {
    source: "result_band",
    bands: [
      { key: "below", label: "Chưa đạt", minScoreBp: 0, multiplierBp: 0 },
      { key: "partly", label: "Gần đạt", minScoreBp: 6_000, multiplierBp: 5_000 },
      { key: "meets", label: "Đạt", minScoreBp: 8_000, multiplierBp: 10_000 },
      { key: "exceeds", label: "Vượt", minScoreBp: 10_000, multiplierBp: 12_500 },
      { key: "outstanding", label: "Xuất sắc", minScoreBp: 11_000, multiplierBp: 15_000 },
    ],
  },
  unitOkr: {
    level: "entity",
    bands: [
      { label: "Công ty chưa đạt", minProgressBp: 0, multiplierBp: 8_000 },
      { label: "Công ty đạt", minProgressBp: 7_000, multiplierBp: 10_000 },
      { label: "Công ty vượt", minProgressBp: 10_000, multiplierBp: 12_000 },
    ],
  },
  eligibility: { minServiceMonths: 3, excludeWorkforceTypes: ["collaborator"], requireActive: true, requireResult: true },
};

/**
 * A bonus run's lifecycle (FR-PAY-21): HR builds and simulates it, the owner adjusts individual
 * amounts with a reason, the CEO approves, then it is paid through off-cycle payroll runs.
 *
 *   draft → simulated → proposed → approved → paid          (cancelled from anywhere but paid)
 *              HR         HR        the CEO    off-cycle runs created
 */
export const BONUS_RUN_STATUSES = ["draft", "simulated", "proposed", "approved", "paid", "cancelled"] as const;
export type BonusRunStatus = (typeof BONUS_RUN_STATUSES)[number];
