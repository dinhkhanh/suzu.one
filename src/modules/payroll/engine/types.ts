// Plain shapes shared by the payroll engine and the services that feed it. No I/O.
import type { IsoDate } from "@/lib/dates";
import type { ParameterValue } from "@/modules/platform/statutory/catalogue";
import type { PayrollPolicyValue } from "../enums";
import type { ComponentDefinition } from "./components";
import type { PayPeriod, PaySegment, ProfileFacts, TimesheetTotals } from "./period";
import type { RoundingRule } from "./rounding";

/**
 * Every legal figure the engine may use, as it stood on the period's last day. The engine never
 * contains a rate, a cap or a bracket of its own (FR-PLT-38): if it is not in here, it is not law.
 */
export type StatutoryParams = {
  insuranceEmployeeRates: ParameterValue<"insurance.employee_rates">;
  insuranceEmployerRates: ParameterValue<"insurance.employer_rates">;
  referenceLevel: ParameterValue<"insurance.reference_level">;
  insuranceCapMultipliers: ParameterValue<"insurance.cap_multipliers">;
  unpaidLeaveThreshold: ParameterValue<"insurance.unpaid_leave_threshold">;
  unionRates: ParameterValue<"union.rates">;
  unionDuesCap: ParameterValue<"union.dues_cap">;
  regionalMinimumWage: ParameterValue<"wage.regional_minimum">;
  pitDeductions: ParameterValue<"pit.deductions">;
  pitBrackets: ParameterValue<"pit.brackets">;
  pitFlatRates: ParameterValue<"pit.flat_rates">;
  pitOvertimeExemption: ParameterValue<"pit.overtime_exemption">;
  overtimeMultipliers: ParameterValue<"overtime.multipliers">;
  probationLimits: ParameterValue<"probation.limits">;
};

export const STATUTORY_KEYS = {
  insuranceEmployeeRates: "insurance.employee_rates",
  insuranceEmployerRates: "insurance.employer_rates",
  referenceLevel: "insurance.reference_level",
  insuranceCapMultipliers: "insurance.cap_multipliers",
  unpaidLeaveThreshold: "insurance.unpaid_leave_threshold",
  unionRates: "union.rates",
  unionDuesCap: "union.dues_cap",
  regionalMinimumWage: "wage.regional_minimum",
  pitDeductions: "pit.deductions",
  pitBrackets: "pit.brackets",
  pitFlatRates: "pit.flat_rates",
  pitOvertimeExemption: "pit.overtime_exemption",
  overtimeMultipliers: "overtime.multipliers",
  probationLimits: "probation.limits",
} as const satisfies Record<keyof StatutoryParams, string>;

// ── What one person brings to a payroll period ──────────────────────────────────────────────

/** A figure typed into the run for this person: a bonus, an advance, a penalty (source `input`). */
export type PayInput = { code: string; amount: number; note?: string | null };

/**
 * A difference from a period that is already paid, carried into this run as its own line
 * (FR-PAY-17). Signed: money owed to the person is positive, money to recover negative. The
 * amount is the **gross** difference; it is taxed in the month it is paid, not in the month it
 * belongs to, and it never re-opens the insurance contribution of a filed month (see retro.ts).
 */
export type RetroItem = {
  /** The month the difference belongs to, "2026-07". */
  sourceMonth: string;
  amount: number;
  /** Why there is a difference: a late-approved raise, a correction to a locked timesheet, HR's own entry. */
  kind: "salary_change" | "timesheet_adjustment" | "manual";
  /** Free text kept with the line so a payslip can say what it is. Never an amount. */
  reason?: string | null;
  /**
   * The month's insurance base changed as well — the contribution of a filed month cannot be
   * corrected in payroll, so the run flags it for the BHXH adjustment declaration (FR-PAY-35).
   */
  insuranceBaseChanged?: boolean;
};

/**
 * What an earlier run of the **same month** already paid this person (FR-PAY-19). An off-cycle
 * run taxes the month as a whole and withholds only the difference, so a bonus paid on the 20th
 * is taxed at the rate the month's total income deserves — not as if it were the only pay.
 */
export type PriorInMonth = {
  runId: string | null;
  taxableIncome: number;
  employeeInsurance: number;
  otherDeductions: number;
  /** Tax already withheld by the earlier run(s) of this month. */
  tax: number;
};

/**
 * Everything the engine needs about one person for one period. Assembled by the service layer
 * (`calculation.ts`) from the locked timesheet, the leave ledger, the salary structures, the pay
 * profile, the component catalogue, the entity's policy and the statutory snapshot — and by
 * nothing else. Given the same input the engine always returns the same result (FR-PAY-20).
 */
export type PersonPayInput = {
  personId: string;
  entityId: string;
  period: PayPeriod;
  /** Statutory wage region I–IV of the entity: decides the unemployment-insurance cap. */
  wageRegion: 1 | 2 | 3 | 4;
  employment: {
    /** First and last day the person was employed inside the period (null = the whole period). */
    startDate: IsoDate | null;
    endDate: IsoDate | null;
    /** Dependents whose deduction months include this month (FR-PAY-13). */
    dependents: number;
    /** Whole months of service on the period's last day — readable by formulas. */
    serviceMonths: number;
    /** The month's KPI score in basis points, 0 when there is none (Phase 3.5). */
    kpiScoreBp: number;
  };
  profile: ProfileFacts;
  /** One per stretch of the month with unchanging pay terms; at least one. */
  segments: PaySegment[];
  timesheet: TimesheetTotals;
  /** Days of leave the insurance fund pays (maternity, long sick): not company pay, and they count as uncovered. */
  insuranceLeaveDays: number;
  /** Days of unpaid leave in working days — the test against `insurance.unpaid_leave_threshold`. */
  unpaidWorkingDays: number;
  components: ComponentDefinition[];
  inputs: PayInput[];
  /** Differences from months already paid, carried into this run (FR-PAY-17). */
  retro: RetroItem[];
  /** Charity, voluntary pension and the like, deducted before the brackets (FR-PAY-13). */
  otherPitDeductions: number;
  /** Set on an off-cycle run: what the month's earlier run already taxed (FR-PAY-19). */
  priorInMonth: PriorInMonth | null;
  /**
   * `regular` pays the month; `off_cycle` pays something extra inside a month already run. The
   * engine reads it only to explain itself — what changes the arithmetic is `priorInMonth`.
   */
  runKind: "regular" | "off_cycle";
  policy: PayrollPolicyValue;
  statutory: StatutoryParams;
};

// ── What comes out ──────────────────────────────────────────────────────────────────────────

/**
 * One line of a payslip with everything needed to explain it (FR-PAY-20): what went in, which
 * named rule turned it into money, and how it was rounded.
 */
export type PayLine = {
  code: string;
  kind: "earning" | "deduction" | "employer_cost";
  category: string;
  /** Always non-negative; `kind` says which way it moves. Integer VND. */
  amount: number;
  /** The part of an earning that counts as taxable income (FR-PAY-13). */
  taxable: number;
  /** The part that counts towards the compulsory-insurance base. */
  insurable: number;
  /** The named rule that produced the amount, e.g. "structure_attendance_prorated". */
  rule: string;
  roundingRule: RoundingRule;
  /** The figures the rule worked from. Integers only, so a line reads the same in any language. */
  inputs: Record<string, number>;
  /** Set when the line's amount came from a formula: the expression as it was approved. */
  formula?: string;
};

export type TraceStep = { stage: string; rule: string; detail: Record<string, number | string | boolean | null> };

export type PayTotals = {
  grossEarnings: number;
  taxableIncome: number;
  exemptIncome: number;
  employeeInsurance: number;
  employerInsurance: number;
  unionDues: number;
  unionFund: number;
  pit: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  /** What the person costs the company: gross + employer insurance + union fund. */
  employerCost: number;
};

export type InsuranceResult = {
  covered: boolean;
  /** Why nobody contributes this month, when `covered` is false. */
  reason: "simple_profile" | "probation" | "retiree" | "insured_elsewhere" | "other_exemption" | "unpaid_leave_threshold" | "no_salary" | "off_cycle_run" | null;
  /** The declared contribution base before the caps. */
  declaredBase: number;
  bhxhBhytBase: number;
  bhtnBase: number;
  employee: { bhxh: number; bhyt: number; bhtn: number };
  employer: { bhxh: number; bhyt: number; bhtn: number };
  /** Which funds this person takes part in at all — a foreigner pays no unemployment insurance. */
  funds: { bhxh: boolean; bhyt: boolean; bhtn: boolean };
};

export type PitResult = {
  method: "progressive" | "flat_without_contract" | "flat_non_resident" | "none";
  /** This run's own taxable income. On an off-cycle run the month's total is in the trace. */
  taxableIncome: number;
  exemptIncome: number;
  personalDeduction: number;
  dependentDeduction: number;
  dependents: number;
  insuranceDeduction: number;
  otherDeductions: number;
  assessableIncome: number;
  /** Per bracket: the slice of income in it and the tax on that slice. */
  brackets: { upTo: number | null; rateBp: number; amount: number; tax: number }[];
  /**
   * An off-cycle run taxes the whole month and withholds the difference (FR-PAY-19): `tax` is
   * what this run withholds, `monthTax` the month's tax altogether and `priorTax` what an earlier
   * run already took. On a regular run with nothing before it the three agree.
   */
  monthTax: number;
  priorTax: number;
  tax: number;
};

export type PersonPayResult = {
  personId: string;
  entityId: string;
  month: string;
  profile: "statutory" | "simple";
  lines: PayLine[];
  totals: PayTotals;
  proration: { basis: PayrollPolicyValue["prorationBasis"]; divisorDays: number; paidDaysCenti: number; standardDays: number };
  insurance: InsuranceResult;
  pit: PitResult;
  /** Anything a human should look at before the run is proposed (FR-PAY-31 adds more). */
  warnings: ("negative_net" | "no_salary_structure" | "zero_paid_days" | "insurance_base_below_minimum" | "insurance_base_above_declared")[];
  trace: TraceStep[];
};
