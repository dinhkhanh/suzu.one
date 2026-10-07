// The attendance module's entry point for other modules (lint allows only this file).
// Kept to re-exports so that the leave ↔ attendance import cycle never runs anything at load time.
export type { CalendarDay, DayExpectation, DayPlan, DayPlanKind, PlannedSegment } from "./engine/calendar";
export { type DayOff, getDayPlans, getDaysOff, type PersonDayPlans } from "./schedules";
export { requestTimesheetRecompute } from "./recompute";
export { listPunches, type PunchFact } from "./punches";
/** Who is in, out, away or not here yet (FR-ATT-15) — the dashboard's attendance tile. Viewer-scoped inside. */
export { getWhoIsIn, type Presence, type PresenceRow, type PresenceStatus } from "./punches";
export { getAttendancePolicy, type ResolvedPolicy } from "./attendance-policies";
export type { MonthSummary } from "./engine/timesheet";
export { getMonthSummaryFor, getTimesheetDays, recomputeDays, summariseMonth, summarisePersonYear, type TimesheetDayRow } from "./timesheets";
/** The assistant's approver lookup (FR-AI-02); `ATTENDANCE_REQUEST_TYPES` names the four flows. */
export { type AttendanceRequestType, ATTENDANCE_REQUEST_TYPES, whoApprovesAttendance } from "./requests";
/** A business trip approved in the requests module becomes the attendance record of those days (REQ-02). */
export { recordApprovedTrip } from "./requests";
// Payroll's input (Phase 5): the locked month per entity, retro adjustments, and the receipt payroll leaves on them.
export { getLockedTimesheets, isPeriodLocked, listAdjustmentsForPayroll, listVoidedAdjustmentIds, type LockedPeriod, type LockedTimesheet, markAdjustmentsTaken, releaseAdjustments, type TimesheetAdjustmentRow } from "./months";
export type { AdjustmentDeltas } from "./schema";

// ── For the assistant's proposals (Phase 13 R4) ───────────────────────────────────────────
// A proposed request is checked against the very schema the action parses it with, and — once the
// person confirms — filed through the action itself, loaded on first use.
export { submitAttendanceRequestInput } from "./inputs";
export { type OvertimeCapWarning, windowOf } from "./engine/requests";
export { overtimeWarningsFor } from "./requests";

export async function submitAttendanceRequestAction(input: unknown) {
  const actions = await import("./request-actions");
  return actions.submitAttendanceRequestAction(input);
}
