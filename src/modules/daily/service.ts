// The person's day (FR-PJM-20..26, 61): the only entry point for other modules and for the routes.
import "server-only";

export * from "./enums";
export { DEFAULT_TEAM_RULES, isoWeekday, type NotRequiredReason, type PersonRules, type TeamRules, weekStartOf } from "./engine/rules";
export type { ReportDraft } from "./engine/prefill";
export type { PersonWeek, TeamWeek } from "./engine/weekly";
export { canApproveTimesheet, canCommentOnReport, canOverseeReport, canViewReport, canViewTimeEntry, canViewTimesheet, canViewUtilisation, type ReportReader, type ReportSubject, type TimeReader } from "./policy";
export { loadReportReader, loadSubjects, loadTimeReader, readerMaySee } from "./people";
export { dayOf, daysOf, type PersonDay } from "./days";
export { getTeamRules, rulesOfPeople } from "./team-rules";
export { getPlanPage, type PlanPage } from "./plans";
export { type BoardGroup, type BoardRow, getReportForm, getReportView, getTeamBoard, listMyReports, REPORT_BACKFILL_DAYS, type ReportForm, type ReportView } from "./reports";
export { listWeekly, type WeeklyPersonView, type WeeklyTeamView } from "./weekly";
export { billableByDefault, getRunningTimer, listTimeOf, type RunningTimer, TIME_BACKFILL_DAYS, type TimeEntryView } from "./time";
export type { AttendanceHint, GridRow, RowKey, TimesheetStatus, WeekGrid } from "./engine/timesheet";
export type { Utilisation } from "./engine/utilisation";
export { getMyTimeWeek, getTimesheetView, listApprovals, listProjectTime, type ProjectTimeRow, type RowLabel, type TimeWeekView, type WaitingWeek, type WeekDayView } from "./timesheets";
export { getUtilisation, UTILISATION_WEEKS, type UtilisationGroup, type UtilisationPerson, type UtilisationView } from "./utilisation";
/**
 * Logged time as totals for other modules (FR-PJM-09 budget burn, FR-PJM-61, later FR-PJM-63):
 * sums in SQL, never a person's rows, and no authorization inside — the caller decides who sees them.
 */
export { type LoggedTotal, loggedMinutesByPersonWeek, sumLoggedMinutesByProject, sumLoggedMinutesByTask } from "./totals";
export { type BookingView, getToday, type TodayView } from "./today";
