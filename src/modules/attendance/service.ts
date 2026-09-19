// The attendance module's entry point for other modules (lint allows only this file).
// Kept to re-exports so that the leave ↔ attendance import cycle never runs anything at load time.
export type { CalendarDay, DayExpectation, DayPlan, DayPlanKind, PlannedSegment } from "./engine/calendar";
export { getDayPlans, type PersonDayPlans } from "./schedules";
export { requestTimesheetRecompute } from "./recompute";
export { listPunches, type PunchFact } from "./punches";
export { getAttendancePolicy, type ResolvedPolicy } from "./attendance-policies";
export type { MonthSummary } from "./engine/timesheet";
export { getTimesheetDays, recomputeDays, summariseMonth, type TimesheetDayRow } from "./timesheets";
