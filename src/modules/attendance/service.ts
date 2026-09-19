// The attendance module's entry point for other modules (lint allows only this file).
// Kept to re-exports so that the leave ↔ attendance import cycle never runs anything at load time.
export type { CalendarDay, DayExpectation, DayPlan, DayPlanKind, PlannedSegment } from "./engine/calendar";
export { getDayPlans, type PersonDayPlans } from "./schedules";
export { requestTimesheetRecompute } from "./recompute";
