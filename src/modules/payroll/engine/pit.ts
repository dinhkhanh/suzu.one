// Stage 5 — personal income tax (FR-PAY-13, FR-PAY-14). Pure.
//
// Three ways to tax the same month, chosen by the person's pay profile:
//
//   progressive            a resident on a labour contract of three months or more:
//                          assessable = taxable income − exempt − employee insurance
//                                       − personal deduction − dependants − other deductions,
//                          then the effective-dated bracket table, slice by slice.
//   flat_without_contract  no contract, or under three months (CTV): a flat rate on the payment,
//                          above a per-payment threshold, unless form 08/CK-TNCN is on file.
//   flat_non_resident      a flat rate on Vietnam-sourced salary, with no deductions at all.
//
// Brackets, rates, deductions and the threshold all come from the statutory snapshot.
import { ENGINE_CODES, findComponent } from "./components";
import { percentBp } from "./rounding";
import type { PayLine, PersonPayInput, PitResult, TraceStep } from "./types";

export type PitInput = {
  /** Sum of the taxable parts of the earning lines. */
  taxableIncome: number;
  exemptIncome: number;
  employeeInsurance: number;
  /** Union dues are a deduction from pay but not from taxable income; kept out on purpose. */
  dependents: number;
  otherDeductions: number;
};

/** Tax on an assessable income, slice by slice — every bracket keeps the part that fell in it. */
export function progressiveTax(assessable: number, brackets: readonly { upTo: number | null; rate: number }[]): { tax: number; slices: PitResult["brackets"] } {
  const slices: PitResult["brackets"] = [];
  let tax = 0;
  let floor = 0;
  for (const bracket of brackets) {
    const ceiling = bracket.upTo ?? Number.MAX_SAFE_INTEGER;
    const amount = Math.max(0, Math.min(assessable, ceiling) - floor);
    const sliceTax = amount > 0 ? percentBp(amount, bracket.rate, "half_up") : 0;
    slices.push({ upTo: bracket.upTo, rateBp: bracket.rate, amount, tax: sliceTax });
    tax += sliceTax;
    floor = ceiling;
    if (assessable <= ceiling) break;
  }
  return { tax, slices };
}

export function calculatePit(input: PersonPayInput, figures: PitInput): { result: PitResult; lines: PayLine[]; trace: TraceStep[] } {
  const { statutory, profile, policy, components } = input;
  const method = pitMethodFor(input);
  const base: Omit<PitResult, "method" | "tax" | "monthTax" | "priorTax" | "brackets"> = {
    taxableIncome: figures.taxableIncome,
    exemptIncome: figures.exemptIncome,
    personalDeduction: 0,
    dependentDeduction: 0,
    dependents: figures.dependents,
    insuranceDeduction: 0,
    otherDeductions: 0,
    assessableIncome: 0,
  };

  // What an earlier run of the same month already taxed and withheld (FR-PAY-19).
  const prior = input.priorInMonth;
  const priorTax = prior?.tax ?? 0;

  if (method === "none") {
    return { result: { ...base, method, brackets: [], monthTax: priorTax, priorTax, tax: 0 }, lines: [], trace: [{ stage: "pit", rule: "no_withholding", detail: { profile: profile.profile, simpleTreatment: policy.simplePitTreatment } }] };
  }

  let tax = 0;
  let monthTax = 0;
  let brackets: PitResult["brackets"] = [];
  let result: PitResult;
  const trace: TraceStep[] = [];

  if (method === "flat_non_resident") {
    // A flat rate is the same whatever else the month held, so an off-cycle payment is simply
    // taxed on its own; there is nothing to aggregate and nothing to credit.
    const rate = statutory.pitFlatRates.nonResident;
    tax = percentBp(figures.taxableIncome, rate, "half_up");
    monthTax = priorTax + tax;
    result = { ...base, method, assessableIncome: figures.taxableIncome, brackets, monthTax, priorTax, tax };
    trace.push({ stage: "pit", rule: "flat_non_resident", detail: { taxableIncome: figures.taxableIncome, rateBp: rate, tax } });
  } else if (method === "flat_without_contract") {
    const { withoutContract: rate, withoutContractThreshold: threshold } = statutory.pitFlatRates;
    // Form 08/CK-TNCN: the person commits that their yearly income stays under the taxable level,
    // so nothing is withheld. Below the per-payment threshold there is no withholding either —
    // and the threshold is **per payment**, so an off-cycle payment is tested on its own.
    const withhold = !profile.pitCommitment && figures.taxableIncome >= threshold;
    tax = withhold ? percentBp(figures.taxableIncome, rate, "half_up") : 0;
    monthTax = priorTax + tax;
    result = { ...base, method, assessableIncome: withhold ? figures.taxableIncome : 0, brackets, monthTax, priorTax, tax };
    trace.push({ stage: "pit", rule: "flat_without_contract", detail: { taxableIncome: figures.taxableIncome, rateBp: rate, threshold, commitment: profile.pitCommitment, withheld: withhold, perPayment: true, tax } });
  } else {
    // Progressive tax is worked out on the **month**, not on the payment: an off-cycle bonus is
    // added to what the regular run already taxed, the deductions are given once, and this run
    // withholds the difference. A regular run has nothing before it, so the two agree.
    const deductions = statutory.pitDeductions;
    const dependentDeduction = deductions.dependent * figures.dependents;
    const taxableIncome = figures.taxableIncome + (prior?.taxableIncome ?? 0);
    const insurance = figures.employeeInsurance + (prior?.employeeInsurance ?? 0);
    const otherDeductions = figures.otherDeductions + (prior?.otherDeductions ?? 0);
    const assessable = Math.max(0, taxableIncome - insurance - deductions.personal - dependentDeduction - otherDeductions);
    const progressive = progressiveTax(assessable, statutory.pitBrackets);
    monthTax = progressive.tax;
    // Never negative: a month that has already withheld more than it owes is put right in the
    // annual finalisation, not by paying tax back through payroll.
    tax = Math.max(0, monthTax - priorTax);
    brackets = progressive.slices;
    result = {
      ...base,
      method,
      personalDeduction: deductions.personal,
      dependentDeduction,
      insuranceDeduction: insurance,
      otherDeductions,
      assessableIncome: assessable,
      brackets,
      monthTax,
      priorTax,
      tax,
    };
    trace.push({ stage: "pit", rule: prior ? "progressive_month_aggregated" : "progressive", detail: { taxableIncome, thisRunTaxableIncome: figures.taxableIncome, priorTaxableIncome: prior?.taxableIncome ?? 0, insurance, personalDeduction: deductions.personal, dependentDeduction, dependents: figures.dependents, otherDeductions, assessableIncome: assessable, monthTax, priorTax, tax } });
  }

  const component = findComponent(components, ENGINE_CODES.pit);
  const lines: PayLine[] = component && tax > 0 ? [{ code: component.code, kind: "deduction", category: component.category, amount: tax, taxable: 0, insurable: 0, rule: `pit_${method}`, roundingRule: component.roundingRule, inputs: { taxableIncome: figures.taxableIncome, assessableIncome: result.assessableIncome, dependents: figures.dependents } }] : [];
  return { result, lines, trace };
}

/**
 * Which way this person is taxed this month. The Simple profile has no method of its own: how the
 * company taxes it is the entity's policy (D18 — "a parameter, not hard-coded"), and a person's
 * own method is used when the policy says there is withholding.
 */
export function pitMethodFor(input: PersonPayInput): PitResult["method"] {
  const { profile, policy } = input;
  if (profile.profile === "simple") {
    if (policy.simplePitTreatment === "none") return "none";
    return profile.taxResidency === "non_resident" ? "flat_non_resident" : "flat_without_contract";
  }
  return profile.pitMethod;
}

/**
 * The part of overtime and night pay that escapes tax (`pit.overtime_exemption`):
 * `premium_only` — what exceeds ordinary-hours pay for the same hours;
 * `full`         — all of it, if the amended law's guidance turns out that way.
 */
export function overtimeExemption(mode: "premium_only" | "full", overtimePay: number, ordinaryEquivalent: number): number {
  return mode === "full" ? overtimePay : Math.max(0, overtimePay - ordinaryEquivalent);
}
