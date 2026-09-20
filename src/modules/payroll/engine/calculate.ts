// The payroll engine's one entry point (FR-PAY-10..16, 20). Pure: no I/O, no clock, no randomness.
//
//   timesheet → pro-rating → earnings → overtime → insurance → union → PIT → net
//
// Given the same input it always returns the same result, and every line says what it was made
// from, so a payslip from two years ago can be explained and reproduced exactly. The caller
// (`calculation.ts`) is the only place that reads the database; nothing in this folder does.
import { calculateEarnings, calculateFormulaLines, calculateInputLines } from "./earnings";
import { calculateInsurance, calculateUnion } from "./insurance";
import { calculateOvertime } from "./overtime";
import { calculatePit, overtimeExemption, pitMethodFor } from "./pit";
import { uncoveredWorkingDays } from "./proration";
import type { PayLine, PersonPayInput, PersonPayResult, TraceStep } from "./types";

/**
 * The engine's version. It changes whenever a rule in this folder changes shape, and is stored
 * with every result: a run calculated under an older engine is never silently compared with a new one.
 */
export const PAYROLL_ENGINE_VERSION = "1.0.0";

export function calculatePerson(input: PersonPayInput): PersonPayResult {
  const trace: TraceStep[] = [];
  const warnings: PersonPayResult["warnings"] = [];
  const hasStructure = input.segments.some((segment) => segment.terms.baseSalary > 0 || segment.terms.allowances.length > 0);
  if (!hasStructure) warnings.push("no_salary_structure");
  if (input.timesheet.paidDaysCenti === 0) warnings.push("zero_paid_days");

  // 1–2. Pro-rating and the structure's own lines.
  const earnings = calculateEarnings(input);
  trace.push({
    stage: "proration",
    rule: input.policy.prorationBasis,
    detail: { divisorDays: earnings.divisor, monthStandardDays: input.period.standardDays, personStandardDays: input.timesheet.standardDays, paidDaysCenti: input.timesheet.paidDaysCenti, unpaidDaysCenti: input.timesheet.unpaidDaysCenti, segments: input.segments.length },
  });
  for (const line of earnings.lines) trace.push({ stage: "earnings", rule: line.rule, detail: { code: line.code, amount: line.amount, taxable: line.taxable } });

  // 3. Overtime and night work, on the rate the policy names.
  const overtimeRate = input.policy.overtimeBase === "base_plus_insurable_allowances" ? earnings.baseSalaryForOvertime + earnings.insurableAllowancesForOvertime : earnings.baseSalaryForOvertime;
  const overtime = calculateOvertime(input, overtimeRate);
  trace.push(...overtime.trace);

  // Formula and typed-in lines see the structure and overtime lines before them.
  const beforeFormulas = [...earnings.lines, ...overtime.lines];
  const formulaLines = calculateFormulaLines(input, beforeFormulas);
  const inputLines = calculateInputLines(input);
  const earningLines = [...beforeFormulas, ...formulaLines, ...inputLines].filter((line) => line.kind === "earning");
  const inputDeductions = [...formulaLines, ...inputLines].filter((line) => line.kind === "deduction");
  const inputEmployerCosts = [...formulaLines, ...inputLines].filter((line) => line.kind === "employer_cost");

  // 4. Insurance: on the declared insurance salary, never pro-rated, all or nothing for the month.
  const uncoveredDays = uncoveredWorkingDays(input.period.standardDays, input.timesheet.paidDaysCenti, input.insuranceLeaveDays);
  const insurance = calculateInsurance(input, earnings.declaredInsuranceSalary, uncoveredDays);
  trace.push(...insurance.trace);
  if (insurance.result.covered) {
    const insurableEarnings = earningLines.reduce((sum, line) => sum + line.insurable, 0);
    if (earnings.declaredInsuranceSalary > insurableEarnings && insurableEarnings > 0) warnings.push("insurance_base_above_declared");
    if (earnings.declaredInsuranceSalary < input.statutory.regionalMinimumWage[`region${input.wageRegion}` as const]) warnings.push("insurance_base_below_minimum");
  }

  // 5. Union.
  const union = calculateUnion(input, insurance.result);
  trace.push(...union.trace);

  // 6. PIT. Overtime and night pay are exempt to the extent the law says (`pit.overtime_exemption`).
  const employeeInsurance = insurance.result.employee.bhxh + insurance.result.employee.bhyt + insurance.result.employee.bhtn;
  const overtimePay = overtime.lines.reduce((sum, line) => sum + line.amount, 0);
  const overtimeExempt = overtimeExemption(input.statutory.pitOvertimeExemption.mode, overtimePay, overtime.ordinaryEquivalent);
  const grossEarnings = earningLines.reduce((sum, line) => sum + line.amount, 0);
  const componentTaxable = earningLines.reduce((sum, line) => sum + line.taxable, 0);
  const taxableIncome = Math.max(0, componentTaxable - overtimeExempt);
  trace.push({ stage: "pit", rule: `overtime_exemption_${input.statutory.pitOvertimeExemption.mode}`, detail: { overtimePay, ordinaryEquivalent: overtime.ordinaryEquivalent, exempt: overtimeExempt } });

  const pit = calculatePit(input, {
    taxableIncome,
    exemptIncome: grossEarnings - taxableIncome,
    employeeInsurance,
    dependents: input.employment.dependents,
    otherDeductions: input.otherPitDeductions,
  });
  trace.push(...pit.trace);

  // 7. Net and the payslip's order.
  const deductionLines = [...insurance.lines.filter((line) => line.kind === "deduction"), ...union.lines.filter((line) => line.kind === "deduction"), ...pit.lines, ...inputDeductions];
  const employerLines = [...insurance.lines.filter((line) => line.kind === "employer_cost"), ...union.lines.filter((line) => line.kind === "employer_cost"), ...inputEmployerCosts];
  const otherDeductions = inputDeductions.reduce((sum, line) => sum + line.amount, 0);
  const totalDeductions = deductionLines.reduce((sum, line) => sum + line.amount, 0);
  const employerInsurance = insurance.result.employer.bhxh + insurance.result.employer.bhyt + insurance.result.employer.bhtn;
  const net = grossEarnings - totalDeductions;
  if (net < 0) warnings.push("negative_net");

  const order = new Map(input.components.map((component, index) => [component.code, index]));
  const bySortOrder = (a: PayLine, b: PayLine) => (order.get(a.code) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.code) ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code);
  const lines = [...earningLines.sort(bySortOrder), ...deductionLines.sort(bySortOrder), ...employerLines.sort(bySortOrder)];

  return {
    personId: input.personId,
    entityId: input.entityId,
    month: input.period.month,
    profile: input.profile.profile,
    lines,
    totals: {
      grossEarnings,
      taxableIncome,
      exemptIncome: grossEarnings - taxableIncome,
      employeeInsurance,
      employerInsurance,
      unionDues: union.dues,
      unionFund: union.fund,
      pit: pit.result.tax,
      otherDeductions,
      totalDeductions,
      net,
      employerCost: grossEarnings + employerInsurance + union.fund,
    },
    proration: { basis: input.policy.prorationBasis, divisorDays: earnings.divisor, paidDaysCenti: input.timesheet.paidDaysCenti, standardDays: input.period.standardDays },
    insurance: insurance.result,
    pit: pit.result,
    warnings,
    trace,
  };
}

export { pitMethodFor };
