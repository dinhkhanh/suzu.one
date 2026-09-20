// Stage 4 — compulsory insurance (FR-PAY-11) and trade union (FR-PAY-12). Pure.
//
// Two things about this are easy to get wrong in a spreadsheet, so they are spelled out here:
//
// 1. **The contribution is never pro-rated.** A month is either contributed for on the declared
//    insurance salary, or not at all. What decides it is the number of working days the person
//    was neither paid by the company nor covered: 14 or more (the statutory threshold) and the
//    month carries nothing — that is the same rule for unpaid leave, a mid-month joiner, a leaver
//    and a month on maternity leave.
// 2. **Two different caps.** Social and health insurance are capped at a multiple of the
//    reference level; unemployment insurance at a multiple of the *regional* minimum wage, which
//    depends on which region the entity sits in.
//
// Every rate, cap and threshold comes from the statutory snapshot. Nothing legal is written here.
import { ENGINE_CODES, findComponent } from "./components";
import { regionalMinimum } from "./earnings";
import { percentBp } from "./rounding";
import type { InsuranceResult, PayLine, PersonPayInput, TraceStep } from "./types";

/** Which funds a person takes part in at all. A foreigner pays no unemployment insurance. */
function fundsFor(input: PersonPayInput): { funds: InsuranceResult["funds"]; reason: InsuranceResult["reason"] } {
  if (input.profile.profile === "simple") return { funds: { bhxh: false, bhyt: false, bhtn: false }, reason: "simple_profile" };
  switch (input.profile.insuranceExemption) {
    case "probation":
      return { funds: { bhxh: false, bhyt: false, bhtn: false }, reason: "probation" };
    case "retiree":
      return { funds: { bhxh: false, bhyt: false, bhtn: false }, reason: "retiree" };
    case "insured_elsewhere":
      return { funds: { bhxh: false, bhyt: false, bhtn: false }, reason: "insured_elsewhere" };
    case "other":
      return { funds: { bhxh: false, bhyt: false, bhtn: false }, reason: "other_exemption" };
    // A foreign employee contributes to social and health insurance but not to unemployment insurance.
    case "foreigner":
      return { funds: { bhxh: true, bhyt: true, bhtn: false }, reason: null };
    default:
      return { funds: { bhxh: true, bhyt: true, bhtn: true }, reason: null };
  }
}

export function calculateInsurance(input: PersonPayInput, declaredBase: number, uncoveredDays: number): { result: InsuranceResult; lines: PayLine[]; trace: TraceStep[] } {
  const { statutory, components } = input;
  const { funds, reason } = fundsFor(input);
  const threshold = statutory.unpaidLeaveThreshold.workingDays;
  const overThreshold = uncoveredDays >= threshold;
  const none: InsuranceResult = { covered: false, reason, declaredBase, bhxhBhytBase: 0, bhtnBase: 0, employee: { bhxh: 0, bhyt: 0, bhtn: 0 }, employer: { bhxh: 0, bhyt: 0, bhtn: 0 }, funds };
  const trace: TraceStep[] = [];

  if (reason) return { result: none, lines: [], trace: [{ stage: "insurance", rule: "exempt", detail: { reason, uncoveredDays } }] };
  // An off-cycle run pays something extra inside a month the regular run already contributed for
  // (FR-PAY-19). The contribution belongs to the month and was made once; a bonus run neither
  // repeats it nor counts as a month without one.
  if (input.runKind === "off_cycle") return { result: { ...none, reason: "off_cycle_run" }, lines: [], trace: [{ stage: "insurance", rule: "off_cycle_run", detail: { runKind: input.runKind } }] };
  if (overThreshold) return { result: { ...none, reason: "unpaid_leave_threshold" }, lines: [], trace: [{ stage: "insurance", rule: "unpaid_leave_threshold", detail: { uncoveredDays, thresholdDays: threshold } }] };
  if (declaredBase <= 0) return { result: { ...none, reason: "no_salary" }, lines: [], trace: [{ stage: "insurance", rule: "no_salary", detail: { declaredBase } }] };

  const caps = statutory.insuranceCapMultipliers;
  const socialCap = statutory.referenceLevel.amount * caps.bhxhBhyt;
  const unemploymentCap = regionalMinimum(input) * caps.bhtn;
  const bhxhBhytBase = Math.min(declaredBase, socialCap);
  const bhtnBase = Math.min(declaredBase, unemploymentCap);
  trace.push({ stage: "insurance", rule: "contribution_base", detail: { declaredBase, socialCap, unemploymentCap, bhxhBhytBase, bhtnBase, uncoveredDays, thresholdDays: threshold } });

  const employeeRates = statutory.insuranceEmployeeRates;
  const employerRates = statutory.insuranceEmployerRates;
  const on = (fund: keyof InsuranceResult["funds"], base: number, rateBp: number) => (funds[fund] ? percentBp(base, rateBp, "half_up") : 0);

  const employee = { bhxh: on("bhxh", bhxhBhytBase, employeeRates.bhxh), bhyt: on("bhyt", bhxhBhytBase, employeeRates.bhyt), bhtn: on("bhtn", bhtnBase, employeeRates.bhtn) };
  const employer = { bhxh: on("bhxh", bhxhBhytBase, employerRates.bhxh), bhyt: on("bhyt", bhxhBhytBase, employerRates.bhyt), bhtn: on("bhtn", bhtnBase, employerRates.bhtn) };
  const result: InsuranceResult = { covered: true, reason: null, declaredBase, bhxhBhytBase, bhtnBase, employee, employer, funds };

  const lines: PayLine[] = [];
  const push = (code: string, kind: "deduction" | "employer_cost", amount: number, base: number, rateBp: number) => {
    const component = findComponent(components, code);
    if (!component || amount === 0) return;
    lines.push({ code, kind, category: component.category, amount, taxable: 0, insurable: 0, rule: "insurance_rate", roundingRule: component.roundingRule, inputs: { base, rateBp } });
  };
  push(ENGINE_CODES.insuranceEmployee.bhxh, "deduction", employee.bhxh, bhxhBhytBase, employeeRates.bhxh);
  push(ENGINE_CODES.insuranceEmployee.bhyt, "deduction", employee.bhyt, bhxhBhytBase, employeeRates.bhyt);
  push(ENGINE_CODES.insuranceEmployee.bhtn, "deduction", employee.bhtn, bhtnBase, employeeRates.bhtn);
  push(ENGINE_CODES.insuranceEmployer.bhxh, "employer_cost", employer.bhxh, bhxhBhytBase, employerRates.bhxh);
  push(ENGINE_CODES.insuranceEmployer.bhyt, "employer_cost", employer.bhyt, bhxhBhytBase, employerRates.bhyt);
  push(ENGINE_CODES.insuranceEmployer.bhtn, "employer_cost", employer.bhtn, bhtnBase, employerRates.bhtn);
  return { result, lines, trace };
}

/**
 * Trade union (FR-PAY-12): the employer's fund is paid on the social-insurance base whether or
 * not anyone is a member; member dues are only for members, and are capped at a share of the
 * reference level. Both are switched on per entity in the pay policy.
 */
export function calculateUnion(input: PersonPayInput, insurance: InsuranceResult): { lines: PayLine[]; dues: number; fund: number; trace: TraceStep[] } {
  const { policy, statutory, components } = input;
  if (!policy.unionEnabled || !insurance.covered) return { lines: [], dues: 0, fund: 0, trace: [] };
  const base = insurance.bhxhBhytBase;
  const rates = statutory.unionRates;
  const cap = percentBp(statutory.referenceLevel.amount, statutory.unionDuesCap.referenceLevelShare, "half_up");
  const uncappedDues = input.profile.unionMember ? percentBp(base, rates.memberDues, "half_up") : 0;
  const dues = Math.min(uncappedDues, cap);
  const fund = percentBp(base, rates.employerFund, "half_up");

  const lines: PayLine[] = [];
  const add = (code: string, kind: "deduction" | "employer_cost", amount: number, inputs: Record<string, number>) => {
    const component = findComponent(components, code);
    if (component && amount > 0) lines.push({ code, kind, category: component.category, amount, taxable: 0, insurable: 0, rule: kind === "deduction" ? "union_dues_capped" : "union_fund_rate", roundingRule: component.roundingRule, inputs });
  };
  add(ENGINE_CODES.unionDues, "deduction", dues, { base, rateBp: rates.memberDues, cap, uncapped: uncappedDues });
  add(ENGINE_CODES.unionFund, "employer_cost", fund, { base, rateBp: rates.employerFund });
  return { lines, dues, fund, trace: [{ stage: "union", rule: "union", detail: { base, dues, fund, member: input.profile.unionMember, cap } }] };
}
