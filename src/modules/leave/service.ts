// The leave module's entry point for other modules (lint allows only this file). Re-exports only,
// so that the leave ↔ attendance import cycle never runs anything at load time.
//
// For attendance (timesheet): `getLeaveOnDays`, `postCompensatoryLeave`.
// For payroll (Phase 5): `getLeaveUsage` (days by payroll treatment), `listPayouts` (unused days
// paid on termination), `getBalances`, `getLedger`.
export type { Portion } from "./engine/request";
export { type Balance, getBalances, getLeaveBalanceFor, getLedger, type LedgerLine, listPayouts, type PayoutLine, postCompensatoryLeave } from "./ledger";
export { getLeaveOnDays, getLeaveUsage, type LeaveOnDay, type LeaveUsage, whoApprovesLeave } from "./requests";
/** Who is away on a range of days, as the viewer may see them (FR-LVE-09) — the dashboard's leave tile. */
export { type CalendarCell, type CalendarPerson, getTeamCalendar, type TeamCalendar } from "./calendar";
