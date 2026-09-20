// The payroll module's entry point for other modules (lint allows only this file). Re-exports only.
//
// Everything here is compensation tier. Functions that take a `principal` / `viewer` authorize
// inside; the rest say "no authorization inside" and are for payroll's own use-cases and jobs.
export { BASE_SALARY_CODE, getSalaryFile, listSalaryOverview, type SalaryFile, type SalaryOverviewRow, salaryChangeRequest } from "./salaries";
export { canApprovePayroll, canManageCompensation, canPayPayroll, canReadPayroll, canViewCompensationOf, hasPayrollDesk } from "./policy";
/**
 * For the ops tracker (FR-OPS-10): how far each entity's month has got, so the payroll calendar
 * closes itself. Statuses and dates only — no module outside payroll is ever handed a figure.
 */
export { getRunMilestone, hasReached, isPayrollPeriodLocked, listRunMilestones, type RunMilestone, type RunStatus } from "./lifecycle";
/** Off-cycle runs are how Phase 8's year-end bonus is paid (FR-PAY-21, FR-PAY-19). */
export { createOffCycleRun } from "./runs";
