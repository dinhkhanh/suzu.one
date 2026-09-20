// Stage 2 — earnings (FR-PAY-01, FR-PAY-02). Pure.
//
// The person's salary structure gives the base salary and the allowances; the catalogue says of
// each whether attendance cuts it, whether it is taxable, and whether it counts towards the
// insurance base. Formula components are then evaluated in catalogue order, each able to read the
// ones before it (`c_<code>`), never itself — the catalogue refused that when it was proposed.
import { computeFormula } from "./formula";
import { componentVariable } from "./formula/variables";
import { findComponent, taxablePart } from "./components";
import { applyShare, divisorDays, employedDaysIn, segmentShare } from "./proration";
import type { PayLine, PersonPayInput } from "./types";

export const BASE_CODE = "BASE";

/** The engine refuses rather than guesses: a broken input is a run that must not be proposed. */
export class PayrollEngineError extends Error {}

export type EarningsResult = {
  lines: PayLine[];
  /** The declared insurance base: the structure's insurance salary, not what was actually paid. */
  declaredInsuranceSalary: number;
  /** Full-month base salary of the last segment — what overtime is worked out from. */
  baseSalaryForOvertime: number;
  insurableAllowancesForOvertime: number;
  divisor: number;
};

/**
 * Structure lines (base salary and allowances), then formula lines.
 *
 * A structure line is summed across the month's segments, so a raise on the 16th pays the old
 * terms for the first half and the new for the second. Each segment's share is rounded on its own
 * under the component's rule, which is what an accountant checking the payslip by hand would do.
 */
export function calculateEarnings(input: PersonPayInput): EarningsResult {
  const { policy, period, segments, components } = input;
  const divisor = divisorDays(policy.prorationBasis, policy, period);
  const employedDays = employedDaysIn(period, input.employment.startDate, input.employment.endDate);
  const lines: PayLine[] = [];

  // Every code the structures mention, in catalogue order so the payslip reads the same each month.
  const structureCodes = new Set<string>();
  for (const segment of segments) {
    structureCodes.add(BASE_CODE);
    for (const allowance of segment.terms.allowances) structureCodes.add(allowance.code);
  }
  const structureComponents = components.filter((component) => component.source === "structure" && structureCodes.has(component.code));

  for (const component of structureComponents) {
    let amount = 0;
    let fullAmount = 0;
    let paidDaysCenti = 0;
    for (const segment of segments) {
      const monthly = component.code === BASE_CODE ? segment.terms.baseSalary : (segment.terms.allowances.find((allowance) => allowance.code === component.code)?.amount ?? 0);
      if (monthly === 0) continue;
      const share = segmentShare(segment, component.proration, divisor, employedDays);
      amount += applyShare(monthly, share, component.roundingRule);
      fullAmount += monthly;
      paidDaysCenti += segment.paidDaysCenti;
    }
    if (amount === 0 && fullAmount === 0) continue;
    lines.push({
      code: component.code,
      kind: "earning",
      category: component.category,
      amount,
      taxable: taxablePart(component, amount),
      insurable: component.subjectToInsurance ? amount : 0,
      rule: component.proration === "attendance" ? "structure_attendance_prorated" : "structure_fixed",
      roundingRule: component.roundingRule,
      inputs: { monthlyAmount: fullAmount, paidDaysCenti, divisorDays: divisor, segments: segments.length, employedDays },
    });
  }

  // The insurance base and the overtime rate follow the terms in force at the end of the period:
  // the month's contribution is declared once, on one salary (rule `last_segment`).
  const last = segments.at(-1);
  const declaredInsuranceSalary = last?.terms.insuranceSalary ?? 0;
  const baseSalaryForOvertime = last?.terms.baseSalary ?? 0;
  const insurableAllowancesForOvertime = (last?.terms.allowances ?? []).reduce((sum, allowance) => sum + (findComponent(components, allowance.code)?.subjectToInsurance ? allowance.amount : 0), 0);

  return { lines, declaredInsuranceSalary, baseSalaryForOvertime, insurableAllowancesForOvertime, divisor };
}

/** The values a formula may read, built from what is known so far. */
export function formulaScope(input: PersonPayInput, lines: readonly PayLine[], grossSoFar: number): Record<string, number> {
  const { timesheet, employment, segments, statutory } = input;
  const last = segments.at(-1);
  const overtime = timesheet.overtime;
  const scope: Record<string, number> = {
    base_salary: last?.terms.baseSalary ?? 0,
    insurance_salary: last?.terms.insuranceSalary ?? 0,
    standard_days: timesheet.standardDays,
    paid_days_centi: timesheet.paidDaysCenti,
    unpaid_days_centi: timesheet.unpaidDaysCenti,
    worked_minutes: timesheet.workedMinutes,
    late_minutes: 0,
    early_minutes: 0,
    night_minutes: timesheet.nightMinutes,
    ot_weekday_minutes: overtime.weekday.day + overtime.weekday.night,
    ot_rest_day_minutes: overtime.restDay.day + overtime.restDay.night,
    ot_holiday_minutes: overtime.holiday.day + overtime.holiday.night,
    service_months: employment.serviceMonths,
    dependents: employment.dependents,
    kpi_score_bp: employment.kpiScoreBp,
    reference_level: statutory.referenceLevel.amount,
    regional_minimum_wage: regionalMinimum(input),
    gross_so_far: grossSoFar,
  };
  for (const line of lines) if (line.kind === "earning") scope[componentVariable(line.code)] = line.amount;
  return scope;
}

export const regionalMinimum = (input: Pick<PersonPayInput, "wageRegion" | "statutory">): number => input.statutory.regionalMinimumWage[`region${input.wageRegion}` as const];

/** Formula components, in catalogue order; each may read the earnings computed before it. */
export function calculateFormulaLines(input: PersonPayInput, existing: readonly PayLine[]): PayLine[] {
  const lines: PayLine[] = [];
  let gross = existing.reduce((sum, line) => (line.kind === "earning" ? sum + line.amount : sum), 0);
  for (const component of input.components.filter((candidate) => candidate.source === "formula" && candidate.formula)) {
    const scope = formulaScope(input, [...existing, ...lines], gross);
    // The formula rounds itself (the language has no bare division), so the component's rounding
    // rule is only recorded. A formula that fails here was approved against a different catalogue.
    let amount: number;
    try {
      amount = computeFormula(component.formula!, scope);
    } catch (error) {
      throw new PayrollEngineError(`formula_failed:${component.code}`, { cause: error });
    }
    if (amount === 0) continue;
    const line: PayLine = {
      code: component.code,
      kind: component.kind,
      category: component.category,
      amount: Math.abs(amount),
      taxable: component.kind === "earning" ? taxablePart(component, Math.abs(amount)) : 0,
      insurable: component.kind === "earning" && component.subjectToInsurance ? Math.abs(amount) : 0,
      rule: "formula",
      roundingRule: component.roundingRule,
      inputs: { result: amount },
      formula: component.formula!,
    };
    lines.push(line);
    if (line.kind === "earning") gross += line.amount;
  }
  return lines;
}

/** Figures typed into the run (bonus, commission, advance, penalty): taken as given, never pro-rated. */
export function calculateInputLines(input: PersonPayInput): PayLine[] {
  const lines: PayLine[] = [];
  for (const entry of input.inputs) {
    const component = findComponent(input.components, entry.code);
    if (!component || component.source !== "input" || entry.amount === 0) continue;
    const amount = Math.abs(entry.amount);
    lines.push({
      code: component.code,
      kind: component.kind,
      category: component.category,
      amount,
      taxable: component.kind === "earning" ? taxablePart(component, amount) : 0,
      insurable: component.kind === "earning" && component.subjectToInsurance ? amount : 0,
      rule: "run_input",
      roundingRule: component.roundingRule,
      inputs: { entered: amount },
    });
  }
  return lines;
}
