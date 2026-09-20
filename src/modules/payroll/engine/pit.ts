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
  const base: Omit<PitResult, "method" | "tax" | "brackets"> = {
    taxableIncome: figures.taxableIncome,
    exemptIncome: figures.exemptIncome,
    personalDeduction: 0,
    dependentDeduction: 0,
    dependents: figures.dependents,
    insuranceDeduction: 0,
    otherDeductions: 0,
    assessableIncome: 0,
  };

  if (method === "none") {
    return { result: { ...base, method, brackets: [], tax: 0 }, lines: [], trace: [{ stage: "pit", rule: "no_withholding", detail: { profile: profile.profile, simpleTreatment: policy.simplePitTreatment } }] };
  }

  let tax = 0;
  let brackets: PitResult["brackets"] = [];
  let result: PitResult;
  const trace: TraceStep[] = [];

  if (method === "flat_non_resident") {
    const rate = statutory.pitFlatRates.nonResident;
    tax = percentBp(figures.taxableIncome, rate, "half_up");
    result = { ...base, method, assessableIncome: figures.taxableIncome, brackets, tax };
    trace.push({ stage: "pit", rule: "flat_non_resident", detail: { taxableIncome: figures.taxableIncome, rateBp: rate, tax } });
  } else if (method === "flat_without_contract") {
    const { withoutContract: rate, withoutContractThreshold: threshold } = statutory.pitFlatRates;
    // Form 08/CK-TNCN: the person commits that their yearly income stays under the taxable level,
    // so nothing is withheld. Below the per-payment threshold there is no withholding either.
    const withhold = !profile.pitCommitment && figures.taxableIncome >= threshold;
    tax = withhold ? percentBp(figures.taxableIncome, rate, "half_up") : 0;
    result = { ...base, method, assessableIncome: withhold ? figures.taxableIncome : 0, brackets, tax };
    trace.push({ stage: "pit", rule: "flat_without_contract", detail: { taxableIncome: figures.taxableIncome, rateBp: rate, threshold, commitment: profile.pitCommitment, withheld: withhold, tax } });
  } else {
    const deductions = statutory.pitDeductions;
    const dependentDeduction = deductions.dependent * figures.dependents;
    const assessable = Math.max(0, figures.taxableIncome - figures.employeeInsurance - deductions.personal - dependentDeduction - figures.otherDeductions);
    const progressive = progressiveTax(assessable, statutory.pitBrackets);
    tax = progressive.tax;
    brackets = progressive.slices;
    result = {
      ...base,
      method,
      personalDeduction: deductions.personal,
      dependentDeduction,
      insuranceDeduction: figures.employeeInsurance,
      otherDeductions: figures.otherDeductions,
      assessableIncome: assessable,
      brackets,
      tax,
    };
    trace.push({ stage: "pit", rule: "progressive", detail: { taxableIncome: figures.taxableIncome, insurance: figures.employeeInsurance, personalDeduction: deductions.personal, dependentDeduction, dependents: figures.dependents, otherDeductions: figures.otherDeductions, assessableIncome: assessable, tax } });
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
