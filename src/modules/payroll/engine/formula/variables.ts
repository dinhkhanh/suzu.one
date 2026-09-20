// The names a pay-component formula may read. Anything else is refused when the formula is
// proposed. The payroll engine fills every one of them for each person and month; amounts are
// integer VND, days are hundredths of a day, time is minutes.
export const FORMULA_VARIABLES = [
  "base_salary",
  "insurance_salary",
  // Pro-rating inputs from the locked timesheet.
  "standard_days",
  "paid_days_centi",
  "unpaid_days_centi",
  "worked_minutes",
  "late_minutes",
  "early_minutes",
  "night_minutes",
  "ot_weekday_minutes",
  "ot_rest_day_minutes",
  "ot_holiday_minutes",
  // The person: whole months of service on the period's last day, dependents registered for the month.
  "service_months",
  "dependents",
  // Performance (Phase 3.5): the month's KPI score in basis points, 0 when there is none.
  "kpi_score_bp",
  // Statutory values of the period, so a formula never carries a legal figure itself.
  "reference_level",
  "regional_minimum_wage",
  // The earnings computed so far for this person (structure lines and earlier formulas).
  "gross_so_far",
] as const;

export type FormulaVariable = (typeof FORMULA_VARIABLES)[number];

/** A component's computed amount is readable by later formulas as `c_<code in lowercase>`. */
export const componentVariable = (code: string) => `c_${code.toLowerCase()}`;

export const allowedFormulaVariables = (componentCodes: Iterable<string>): string[] => [...FORMULA_VARIABLES, ...[...componentCodes].map(componentVariable)];
