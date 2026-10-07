// The person's day (FR-PJM-20..26, 61): the only entry point for other modules and for the routes.
import "server-only";

export * from "./enums";
export { DEFAULT_TEAM_RULES, isoWeekday, type NotRequiredReason, type PersonRules, type TeamRules, weekStartOf } from "./engine/rules";
export type { ReportDraft } from "./engine/prefill";
export type { PersonWeek, TeamWeek } from "./engine/weekly";
/** Labels resolved for the reader (SRS §4.6b): a task or project they may not open is "private work" with its hours only. */
export type { Seen, ShownActivity, ShownHours, ShownLine, ShownPersonWeek, ShownTeamWeek } from "./engine/redact";
export { canApproveTimesheet, canCommentOnReport, canOverseeReport, canViewAttendanceHint, canViewReport, canViewTimeEntry, canViewTimesheet, canViewUtilisation, type ReportReader, type ReportSubject, type TimeReader, type TimesheetSubject } from "./policy";
export { loadReportReader, loadSubjects, loadTimeReader, loadTimesheetSubjects, readerMaySee } from "./people";
export { dayOf, daysOf, type PersonDay } from "./days";
export { getTeamRules, rulesOfPeople } from "./team-rules";
export { getPlanPage, type PlanPage } from "./plans";
export { type BoardGroup, type BoardPlan, type BoardRow, getReportForm, getReportView, getTeamBoard, listMissingReportDays, listMyReports, REPORT_BACKFILL_DAYS, type ReportForm, reportLink, type ReportView, type ShownBlocker, type ShownReport, withinReportWindow } from "./reports";
export { listWeekly, type WeeklyPersonView, type WeeklyTeamView } from "./weekly";
export { billableByDefault, getRunningTimer, listTimeOf, type RunningTimer, TIME_BACKFILL_DAYS, type TimeEntryView } from "./time";
export type { AttendanceHint, GridRow, RowKey, TimesheetStatus, WeekGrid } from "./engine/timesheet";
export type { Utilisation } from "./engine/utilisation";
export { getMyTimeWeek, getTimesheetView, listApprovals, listProjectTime, type ProjectTimeRow, type RowLabel, type TimeWeekView, type WaitingWeek, type WeekDayView } from "./timesheets";
/** Team figures that would be one person are folded together (security review, finding 22): the delivery dashboard's compliance rows use the same rule. */
export { foldSmallGroups, MIN_GROUP_PEOPLE } from "./engine/privacy";
export { getUtilisation, UTILISATION_WEEKS, type UtilisationGroup, type UtilisationPerson, type UtilisationView } from "./utilisation";
/**
 * Logged time as totals for other modules (FR-PJM-09 budget burn, FR-PJM-61, later FR-PJM-63):
 * sums in SQL, never a person's rows, and no authorization inside — the caller decides who sees them.
 */
export { type LoggedGroup, type LoggedTotal, loggedMinutesByPersonWeek, loggedMinutesOfPerson, sumLoggedMinutesByProject, sumLoggedMinutesByTask } from "./totals";
export { type BookingView, getToday, type TodayView } from "./today";
/** The reminders' bookkeeping, for a reminder another module sends about a person's day back at work (leave cover, FR-PJM-44). */
export { claimReminders } from "./reminders";
/** Time on one task, for the task's page: the totals the reader may see, their timer, the billable default. */
export { getTaskTime, type TaskTime } from "./task-time";
export { RECORD_DAYS, type WorkRecord, workRecordOf } from "./record";
/**
 * For the assistant's proposals (Phase 13 R4): the actions' own input schemas, the checks their
 * `authorize` and services make — so no card is shown that its Xác nhận would refuse — and the
 * actions themselves, loaded on first use as work's `updateTaskAction` is.
 */
export { addToPlanInput, logTimeInput, submitReportInput } from "./inputs";
export { withinTimeWindow } from "./time";
export { firstReadersOf } from "./people";

export async function logTimeAction(input: unknown) {
  const actions = await import("./time-actions");
  return actions.logTimeAction(input);
}

export async function addToPlanAction(input: unknown) {
  const actions = await import("./actions");
  return actions.addToPlanAction(input);
}

export async function submitReportAction(input: unknown) {
  const actions = await import("./actions");
  return actions.submitReportAction(input);
}
