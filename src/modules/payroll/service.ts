// The payroll module's entry point for other modules (lint allows only this file). Re-exports only.
//
// Everything here is compensation tier. Functions that take a `principal` / `viewer` authorize
// inside; the rest say "no authorization inside" and are for payroll's own use-cases and jobs.
export { BASE_SALARY_CODE, getSalaryFile, listSalaryOverview, type SalaryFile, type SalaryOverviewRow, salaryChangeRequest } from "./salaries";
export { canManageCompensation, canReadPayroll, canViewCompensationOf, hasPayrollDesk } from "./policy";
