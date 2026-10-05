// Unused leave paid out on leaving (FR-LVE-03, FR-PAY-18). Pure.
//
// The leave module decides how many days are owed — its policy carries, lapses or pays them —
// and posts what is paid to the ledger, dated the last day of employment. The run of that month
// pays them here, priced the way the law prices them (Labour Code 2019 art. 113.3; Decree
// 145/2020 art. 67.3):
//
//   day rate  = the salary under the labour contract of the month before the month of leaving
//               ÷ the normal working days of that month
//   payout    = days owed × day rate, in one division so nothing is rounded twice
//
// Which parts of the salary structure make up "the salary under the labour contract" is the
// statutory parameter `leave.payout_basis`. The payout is income of the month it is paid, taxed
// as the component says, and never part of the insurance base.
import type { SalaryTerms } from "../enums";
import { findComponent, taxablePart, type ComponentDefinition } from "./components";
import { ratio } from "./rounding";
import type { LeavePayout, PayLine, PayWarning, PersonPayInput, StatutoryParams, TraceStep } from "./types";

export const LEAVE_PAYOUT_CODE = "LEAVE_PAYOUT";

/** The monthly salary a day of unused leave is priced on, under `leave.payout_basis`. */
export function payoutMonthlySalary(terms: SalaryTerms, basis: StatutoryParams["leavePayoutBasis"], components: readonly ComponentDefinition[]): number {
  const counts = (code: string) => basis.salary === "base_plus_allowances" || (basis.salary === "base_plus_insurable_allowances" && !!findComponent(components, code)?.subjectToInsurance);
  return terms.baseSalary + (basis.salary === "base" ? 0 : terms.allowances.reduce((sum, allowance) => sum + (counts(allowance.code) ? allowance.amount : 0), 0));
}

/**
 * One `LEAVE_PAYOUT` line for the days the ledger says are owed. Days that cannot be paid — no
 * payout component in the catalogue, or no salary or working days to price them on — are a
 * warning on the result that stops the run being proposed, never a silent nothing.
 */
export function calculateLeavePayout(input: PersonPayInput): { lines: PayLine[]; trace: TraceStep[]; warnings: PayWarning[] } {
  const payout: LeavePayout | null | undefined = input.leavePayout;
  // Whichever run of the month is handed the days pays them: the regular run as a rule, an
  // off-cycle run when the days were posted after the regular run was signed. The calculation hands
  // each only what the month's other runs have not already paid (`PriorInMonth`).
  if (!payout || payout.daysCenti <= 0) return { lines: [], trace: [], warnings: [] };
  const component = findComponent(input.components, LEAVE_PAYOUT_CODE);
  if (!component) return { lines: [], trace: [{ stage: "leave_payout", rule: "leave_payout_component_missing", detail: { code: LEAVE_PAYOUT_CODE, daysCenti: payout.daysCenti } }], warnings: ["leave_payout_component_missing"] };

  const monthlySalary = payoutMonthlySalary(payout.terms, input.statutory.leavePayoutBasis, input.components);
  const detail = { daysCenti: payout.daysCenti, basisMonth: payout.basisMonth, salaryBasis: input.statutory.leavePayoutBasis.salary, monthlySalary, workingDays: payout.workingDays };
  if (monthlySalary <= 0 || payout.workingDays <= 0) return { lines: [], trace: [{ stage: "leave_payout", rule: "leave_payout_unpriced", detail }], warnings: ["leave_payout_unpriced"] };

  const amount = ratio(monthlySalary, payout.daysCenti, payout.workingDays * 100, component.roundingRule);
  return {
    lines: [
      {
        code: component.code,
        kind: "earning",
        category: component.category,
        amount,
        taxable: taxablePart(component, amount),
        insurable: 0,
        rule: "leave_payout_day_rate",
        roundingRule: component.roundingRule,
        inputs: { daysCenti: payout.daysCenti, monthlySalary, workingDays: payout.workingDays },
      },
    ],
    trace: [{ stage: "leave_payout", rule: "leave_payout_day_rate", detail: { ...detail, amount } }],
    warnings: [],
  };
}
