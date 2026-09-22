// The payroll module's entry point for other modules (lint allows only this file). Re-exports only.
//
// Everything here is compensation tier. Functions that take a `principal` / `viewer` authorize
// inside; the rest say "no authorization inside" and are for payroll's own use-cases and jobs.
export { BASE_SALARY_CODE, getSalaryFile, listSalaryOverview, type SalaryFile, type SalaryOverviewRow, salaryChangeRequest } from "./salaries";
/**
 * The assistant's payslip explanation (FR-AI-02, 06). Both are already viewer-scoped and stay
 * that way: `listMyPayslips` takes a person id and returns that person's own payslips and nothing
 * else — there is no "somebody else's payslips" call to make — and `getPayslipView` answers null
 * for anyone but the person, C&B over the entity, or the owner. A line manager reading a report's
 * pay is refused here, by the same rule that refuses them the payslip page.
 */
export { getPayslipView, listMyPayslips, type MyPayslipRow, type PayslipView } from "./payslips";
export { canApprovePayroll, canManageCompensation, canPayPayroll, canReadPayroll, canViewCompensationOf, hasPayrollDesk, payrollReadReach } from "./policy";
/**
 * For the ops tracker (FR-OPS-10): how far each entity's month has got, so the payroll calendar
 * closes itself. Statuses and dates only — no module outside payroll is ever handed a figure.
 */
export { getRunMilestone, hasReached, isPayrollPeriodLocked, listRunMilestones, type RunMilestone, type RunStatus } from "./lifecycle";
/** Off-cycle runs are how Phase 8's year-end bonus is paid (FR-PAY-21, FR-PAY-19). */
export { createOffCycleRun } from "./runs";
/**
 * Paying something that payroll did not work out for itself (FR-REQ-03: an approved expense
 * claim). The caller finds the entity's open run, types its figure in under a pay component, and
 * takes it out again if what it was for goes away. It never reads a figure back: `RunHandle`
 * carries ids, a month and a status and nothing else, so no amount leaves payroll this way.
 */
export { findOpenRegularRun, getRunHandle, removeRunInput, type RunHandle, setRunInput } from "./runs";
/**
 * The first salary of somebody who has just been hired (FR-REC-09). Recruitment knows what was
 * offered and accepted; it must not become a second way to set a salary, so it **proposes** the
 * figure through payroll's own use-case and the owner decides it exactly as for any other change
 * (SRS D17). The proposal is encrypted by `submitSalaryChange` like every other one, and nothing
 * is read back: the return value carries the request's id, not an amount.
 */
export { type SalaryChangeInput, submitSalaryChange } from "./salaries";
/**
 * The performance-driven year-end bonus (FR-PAY-21, Phase 8). It lives here and not in the
 * performance module because an amount is compensation: `policy.ts`'s rules already refuse a line
 * manager, a department head and an entity director every figure in this file, and the run pays
 * through payroll's own off-cycle runs. Performance publishes the multiplier (FR-PRF-09) and
 * payroll turns it into money — the dependency runs payroll → performance/service, never back.
 *
 * Nothing here is authorized inside; the pages and `bonus-actions.ts` check first.
 */
export { canAdjustBonusLine, canApproveBonusRun, canDecideBonusScheme, canManageBonusRun, canPayBonusRun, canProposeBonusRun, canProposeBonusScheme, canReadBonusRun, canViewBonusOf } from "./policy";
export { availableBonusSteps, bonusCostOf, type BonusCost, type BonusLineView, type BonusRunEventRow, type BonusRunLineRow, type BonusRunRow, type BonusStep, getBonusCost, getBonusLine, getBonusRun, isOpenForEditing as isBonusRunOpen, isSettled as isBonusRunSettled, listBonusLines, listBonusRunEvents, listBonusRuns, listMyBonusLines, openTotals as openBonusTotals } from "./bonus";
export { type BonusSchemeRow, getBonusScheme, getBonusSchemeVersion, hasBonusScheme, listBonusSchemeVersions, type ResolvedBonusScheme, schemeDateOf } from "./bonus-schemes";
export { type BonusExclusion, type BonusSchemeValue, bonusSchemeSchema, DEFAULT_BONUS_SCHEME } from "./enums";
export type { BonusTotals, BonusTrace, BonusTraceStep } from "./engine/bonus";
/**
 * Phase 9 (FR-RPT-01, 05): the cost trend, for the owner dashboard and scheduled reports. It is the
 * coarsest compensation figure in the product — entity totals per month, from stored run results —
 * and it filters **in SQL** by the reader's `payroll:read` reach before anything is decrypted. A
 * reader with no reach gets an empty list, not a refusal. Nothing here names a person.
 */
export { costTrend, type ReportFilter, reportOptions, type TrendPoint } from "./reports";
