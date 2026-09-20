// Plain shapes shared by the payroll engine and the services that feed it. No I/O.
import type { ParameterValue } from "@/modules/platform/statutory/catalogue";

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
