// The reports module's entry point (FR-RPT-01 v2, FR-RPT-05). It owns no data of its own: the
// dashboard and the catalogue read through the other modules' `service.ts` with the reader's own
// principal, and the only tables here are the schedules and their delivery record.
import "server-only";

export { buildReportFor, findReport, isSchedulable, listReportsFor, needsStepUp, type Locale, REPORT_KEYS, type ReportDefinition, type ReportKey, type ReportTable, type ReportViewer, reportToCsv, reportToText } from "./catalogue";
export type { AttendanceTile, Dashboard, DashboardViewer, HeadcountTile, LeaveTile, OpsTile, PayrollTile, RecruitTile, WorkTile } from "./dashboard";
export { getDashboard } from "./dashboard";
export { type Cadence, isoDayOfWeek, nextRunAfter, nextRunOnOrAfter, type Period, periodFor } from "./engine/cadence";
export { reportSchedulesJob } from "./jobs";
export { canEditSchedule, canManageSchedules, canOpenReports, canViewSchedule, type ScheduleFacts, type ScheduleViewer } from "./policy";
export {
  createSchedule,
  deleteSchedule,
  findSchedule,
  getScheduleView,
  listSchedules,
  type RecipientOutcome,
  type RecipientView,
  runDueSchedules,
  runSchedule,
  type ScheduleInput,
  type ScheduleRow,
  type ScheduleRunRow,
  type ScheduleView,
  setScheduleActive,
  updateSchedule,
} from "./schedules";
