// A pay component as the engine sees it: the approved version's rules, without the database row.
// The service hands these over after `resolveCatalogue`; a stored result keeps each `versionId`
// so an old payslip can be read back with the rules that made it (FR-PAY-20).
import type { RoundingRule } from "./rounding";

export type ComponentDefinition = {
  /** The id of the `pay_component` version in force — stored with the result. */
  versionId: string;
  code: string;
  name: string;
  kind: "earning" | "deduction" | "employer_cost";
  category: string;
  source: "structure" | "formula" | "engine" | "input";
  taxTreatment: "taxable" | "exempt" | "exempt_up_to_cap";
  exemptCap: number | null;
  subjectToInsurance: boolean;
  proration: "fixed" | "attendance";
  roundingRule: RoundingRule;
  formula: string | null;
  sortOrder: number;
};

export const findComponent = (components: readonly ComponentDefinition[], code: string): ComponentDefinition | undefined => components.find((component) => component.code === code);

/**
 * How much of an earning is taxable income (FR-PAY-13). `exempt_up_to_cap` is a monthly cap: the
 * excess is taxable, the rest is not — the meal allowance is the everyday case.
 */
export function taxablePart(component: Pick<ComponentDefinition, "taxTreatment" | "exemptCap">, amount: number): number {
  if (component.taxTreatment === "exempt") return 0;
  if (component.taxTreatment === "exempt_up_to_cap") return Math.max(0, amount - (component.exemptCap ?? 0));
  return amount;
}

/** The codes the engine itself produces. They must exist in the catalogue or their line is left out. */
export const ENGINE_CODES = {
  overtimeWeekday: "OT_WEEKDAY",
  overtimeRestDay: "OT_REST_DAY",
  overtimeHoliday: "OT_HOLIDAY",
  nightPremium: "NIGHT_PREMIUM",
  insuranceEmployee: { bhxh: "INS_BHXH_EE", bhyt: "INS_BHYT_EE", bhtn: "INS_BHTN_EE" },
  insuranceEmployer: { bhxh: "INS_BHXH_ER", bhyt: "INS_BHYT_ER", bhtn: "INS_BHTN_ER" },
  unionDues: "UNION_DUES",
  unionFund: "UNION_FUND",
  pit: "PIT",
} as const;
