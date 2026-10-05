// Every scheduled and on-demand job, and which cron URL runs it. A composition root, so it lives
// with the routes: it reaches into every module's jobs, which no module may do. Read by the cron
// route (`[job]/route.ts`) and by Admin → Jobs ("run now", and which schedule a job belongs to).
import "server-only";
import { faceLeaversJob } from "@/modules/attendance/faces";
import { punchReviewRemindersJob } from "@/modules/attendance/punches";
import { timesheetMonthReadyJob, timesheetRecomputeJob } from "@/modules/attendance/recompute";
import { fieldKeysRewrapJob, hrAlertsJob, peopleRollOverJob } from "@/modules/core-hr/jobs";
import { commsAnnouncementsJob } from "@/modules/comms/jobs";
import { kbAckRemindersJob, kbEmbeddingsJob } from "@/modules/kb/jobs";
import { filesCleanupJob } from "@/modules/platform/files/jobs";
import { leaveAccrualJob } from "@/modules/leave/jobs";
import { opsBackfillJob, opsRemindersJob, opsSchedulerJob } from "@/modules/ops/jobs";
import { payrollCalculateJob } from "@/modules/payroll/run-calculation";
import { performanceProbationJob, performanceRemindersJob } from "@/modules/performance/jobs";
import { housekeepingJob } from "@/modules/platform/jobs/housekeeping";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { approvalsOversightDigestJob } from "@/modules/platform/approvals/jobs";
import { notificationsDailyJob } from "@/modules/platform/notifications/jobs";
import { candidateRetentionJob } from "@/modules/recruit/jobs";
import { kpiFromWorkJob, reportSchedulesJob } from "@/modules/reports/service";
import { expenseClaimSweepJob, requestSlaJob } from "@/modules/requests/jobs";
import { workCoverJob, workCyclesJob, workExitHandoverJob, workPreviewSweepJob, workRecurringJob, workRemindersJob, workTriageWakeJob } from "@/modules/work/jobs";
import { dailyMissedReportsJob, dailyPlanRemindersJob, dailyReportRemindersJob, dailyTimesheetRemindersJob, dailyWeeklyReportsJob } from "@/modules/daily/jobs";
import { projectPlansJob, projectRemindersJob, projectRetainersJob } from "@/modules/projects/jobs";
import { crmMorningJob, crmNightlyJob } from "@/modules/crm/service";
import { aiEvalJob } from "./ai-eval";
import { bonusDemoRunJob } from "./[job]/bonus-demo";
import { cacheFlushJob } from "./[job]/cache-flush";
import { payrollDemoRunsJob } from "./[job]/payroll-demo";

// What each cron URL runs. Schedules live in vercel.json and stay daily, which every Vercel plan
// allows; jobs that share a time of day share a URL but are still recorded (and fail) one by one,
// and a schedule that runs out of time hands the rest to a fresh invocation (`runSchedule`).
export const SCHEDULES: Record<string, JobDefinition[]> = {
  // Leave after the roll-over: a new starter accrues from the day they become active. The timesheet
  // last: it closes yesterday with the leave and the employment facts of today.
  // Candidate retention runs with the other nightly housekeeping (FR-REC-13): it empties out the
  // records of people whose window has passed, and it must run whether or not anybody logs in. So
  // does the face kiosk's: the faces of people who have left. The platform's own housekeeping
  // (expired sessions and approval links, staged import batches, old notifications and delivery
  // logs, old job runs) closes the night. Approved expense claims are offered to the open payroll
  // run just before it is calculated.
  midnight: [peopleRollOverJob, leaveAccrualJob, timesheetRecomputeJob, workRecurringJob, workTriageWakeJob, workCyclesJob, workCoverJob, workExitHandoverJob, workPreviewSweepJob, projectPlansJob, projectRetainersJob, crmNightlyJob, opsSchedulerJob, kbEmbeddingsJob, commsAnnouncementsJob, expenseClaimSweepJob, payrollCalculateJob, candidateRetentionJob, faceLeaversJob, housekeepingJob],
  // Alerts (and, on the 1st, "your month is ready to confirm"; flagged check-ins waiting for their
  // reviewers) first, so the digest that follows carries them.
  morning: [hrAlertsJob, timesheetMonthReadyJob, punchReviewRemindersJob, payrollCalculateJob, opsSchedulerJob, opsRemindersJob, requestSlaJob, approvalsOversightDigestJob, workRemindersJob, projectRemindersJob, crmMorningJob, dailyPlanRemindersJob, dailyMissedReportsJob, dailyWeeklyReportsJob, dailyTimesheetRemindersJob, kbAckRemindersJob, performanceProbationJob, performanceRemindersJob, kbEmbeddingsJob, commsAnnouncementsJob, kpiFromWorkJob, reportSchedulesJob, notificationsDailyJob, filesCleanupJob],
  // 18:00 in Vietnam: the end-of-day report reminder (FR-PJM-22), before most people leave.
  evening: [dailyReportRemindersJob],
};

// Run by hand only: /api/cron/<job name>.
// `payroll-demo-runs`, `bonus-demo-run` and `ai-eval` refuse to run outside a development server.
// `cache-flush` is what `pnpm cache:flush` calls.
export const ON_DEMAND: JobDefinition[] = [fieldKeysRewrapJob, opsBackfillJob, payrollDemoRunsJob, bonusDemoRunJob, aiEvalJob, cacheFlushJob];

/** Jobs that only a development server runs: Admin → Jobs offers no "run now" for them. */
export const DEVELOPMENT_ONLY = new Set([payrollDemoRunsJob.name, bonusDemoRunJob.name, aiEvalJob.name]);

/** Every job once — a job may sit in two schedules (the ops scheduler) and still run once by name. */
export const ALL_JOBS: JobDefinition[] = [...new Map([...Object.values(SCHEDULES).flat(), ...ON_DEMAND].map((job) => [job.name, job])).values()];

/** The job of this name, or null. */
export const jobNamed = (name: string): JobDefinition | null => ALL_JOBS.find((job) => job.name === name) ?? null;

/** Which schedules a job runs in, by name — for Admin → Jobs. */
export function schedulesOf(name: string): string[] {
  return Object.entries(SCHEDULES).flatMap(([schedule, jobs]) => (jobs.some((job) => job.name === name) ? [schedule] : []));
}
