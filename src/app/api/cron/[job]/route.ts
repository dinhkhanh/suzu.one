import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { timesheetMonthReadyJob, timesheetRecomputeJob } from "@/modules/attendance/recompute";
import { fieldKeysRewrapJob, hrAlertsJob, peopleRollOverJob } from "@/modules/core-hr/jobs";
import { kbAckRemindersJob, kbEmbeddingsJob } from "@/modules/kb/jobs";
import { filesCleanupJob } from "@/modules/platform/files/jobs";
import { leaveAccrualJob } from "@/modules/leave/jobs";
import { opsBackfillJob, opsRemindersJob, opsSchedulerJob } from "@/modules/ops/jobs";
import { type JobDefinition, runJob } from "@/modules/platform/jobs/service";
import { notificationsDailyJob } from "@/modules/platform/notifications/jobs";
import { workRecurringJob, workRemindersJob } from "@/modules/work/jobs";

// What each cron URL runs. Schedules live in vercel.json and stay daily, which every Vercel plan
// allows; jobs that share a time of day share a URL but are still recorded (and fail) one by one.
const SCHEDULES: Record<string, JobDefinition[]> = {
  // Leave after the roll-over: a new starter accrues from the day they become active. The timesheet
  // last: it closes yesterday with the leave and the employment facts of today.
  midnight: [peopleRollOverJob, leaveAccrualJob, timesheetRecomputeJob, workRecurringJob, opsSchedulerJob, kbEmbeddingsJob],
  // Alerts (and, on the 1st, "your month is ready to confirm") first, so the digest that follows carries them.
  morning: [hrAlertsJob, timesheetMonthReadyJob, opsSchedulerJob, opsRemindersJob, workRemindersJob, kbAckRemindersJob, kbEmbeddingsJob, notificationsDailyJob, filesCleanupJob],
};

// Run by hand only: /api/cron/<job name>.
const ON_DEMAND: JobDefinition[] = [fieldKeysRewrapJob, opsBackfillJob];

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. Nothing else may.
// `/api/cron/<schedule>` runs a whole schedule; `/api/cron/<job name>` runs one job by hand.
export async function GET(request: Request, context: RouteContext<"/api/cron/[job]">) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const { job } = await context.params;
  // A job may sit in two schedules (the ops scheduler): by name it still runs once.
  const definitions = SCHEDULES[job] ?? [...new Set([...Object.values(SCHEDULES).flat(), ...ON_DEMAND])].filter((candidate) => candidate.name === job);
  if (definitions.length === 0) return new Response("Unknown job", { status: 404 });

  const outcomes = [];
  for (const definition of definitions) {
    const run = await runJob(definition);
    outcomes.push({ job: definition.name, status: run?.status ?? "already_running", result: run?.result ?? null, error: run?.error ?? null });
  }
  return Response.json({ outcomes }, { status: outcomes.some((outcome) => outcome.status === "failed") ? 500 : 200 });
}
