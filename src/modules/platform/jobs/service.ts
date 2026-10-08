import "server-only";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { reportError } from "@/lib/observability/report";
import { recordAudit } from "../audit/service";
import { notify } from "../notifications/service";
import { listOwnerPersonIds } from "../rbac/service";

export type JobDefinition = {
  /** Also the last segment of its trigger URL: /api/cron/<name>. */
  name: string;
  /** Must be safe to run again: a retry or a second trigger on the same day changes nothing more. */
  run: (context: { today: IsoDate }) => Promise<Record<string, unknown>>;
  /**
   * For a job its cron calls every few minutes: whether there is anything to do now. When it says
   * no, the cron answers "not_due" and records no run — a quiet tick leaves nothing in Admin → Jobs.
   * "Run now" ignores it.
   */
  due?: () => Promise<boolean>;
};

export type JobRunRow = typeof schema.jobRun.$inferSelect;

// A run that has not finished after this long died with its server (a function lives five minutes
// at most); whichever trigger comes next marks it failed and says so.
export const STALE_AFTER_MINUTES = 15;

/**
 * A quarter of runs: Admin → Jobs shows the latest hundred, and the audit log keeps every run's
 * outcome on its own (`job.<name>` entries) for as long as it keeps anything.
 */
export const JOB_RUN_RETENTION_DAYS = 90;

/**
 * Marks every run that died with its server — still "running" long after any function could be —
 * as failed with `timed_out`, and tells the owners (NFR-OPS-03): a run killed by the platform has
 * no catch block of its own, so without this nobody heard of it. `job` narrows it to one job.
 * Called before every run, and at the top of every cron call for all jobs at once.
 */
export async function sweepTimedOutRuns(now: Date = new Date(), job?: string): Promise<JobRunRow[]> {
  const timedOut = await db()
    .update(schema.jobRun)
    .set({ status: "failed", finishedAt: now, error: "timed_out" })
    .where(and(job ? eq(schema.jobRun.job, job) : undefined, eq(schema.jobRun.status, "running"), lt(schema.jobRun.startedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${STALE_AFTER_MINUTES})`)))
    .returning();
  if (timedOut.length === 0) return timedOut;
  const owners = await listOwnerPersonIds();
  for (const run of timedOut) {
    await notify({ recipients: owners, kind: "system.job_timed_out", params: { job: run.job, minutes: STALE_AFTER_MINUTES }, link: "/admin/jobs" }).catch(() => undefined);
  }
  return timedOut;
}

/** Runs a job once and records the outcome. Returns null when the job is already running. */
export async function runJob(definition: JobDefinition, now: Date = new Date()): Promise<JobRunRow | null> {
  await sweepTimedOutRuns(now, definition.name);

  const [run] = await db().insert(schema.jobRun).values({ job: definition.name, startedAt: now }).onConflictDoNothing().returning();
  if (!run) return null;

  try {
    const result = await definition.run({ today: todayInVietnam(now) });
    const [finished] = await db().update(schema.jobRun).set({ status: "succeeded", finishedAt: new Date(), result }).where(eq(schema.jobRun.id, run.id)).returning();
    // Jobs change data with no person behind them; the audit log still says what happened.
    await recordAudit({ action: `job.${definition.name}`, resource: { type: "job_run", id: run.id }, summary: JSON.stringify(result), after: result });
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [failed] = await db()
      .update(schema.jobRun)
      .set({ status: "failed", finishedAt: new Date(), error: message.slice(0, 2000) })
      .where(eq(schema.jobRun.id, run.id))
      .returning();
    await recordAudit({ action: `job.${definition.name}.failed`, resource: { type: "job_run", id: run.id }, summary: message.slice(0, 300) });
    await reportError(error, { event: "job.failed", source: "job", route: `/api/cron/${definition.name}`, tags: { job: definition.name, runId: run.id } });
    // NFR-OPS-03: a failed job must reach a human, not just a log.
    await notify({ recipients: await listOwnerPersonIds(), kind: "system.job_failed", params: { job: definition.name, error: message.slice(0, 300) }, link: "/admin/jobs" }).catch(() => undefined);
    return failed;
  }
}

export async function listRecentJobRuns(limit = 50): Promise<JobRunRow[]> {
  return db().select().from(schema.jobRun).orderBy(desc(schema.jobRun.startedAt)).limit(limit);
}

/** Each job's latest run — one per job, picked by the database (DISTINCT ON over the job/start index). */
export async function listLatestRunPerJob(): Promise<JobRunRow[]> {
  return db().selectDistinctOn([schema.jobRun.job]).from(schema.jobRun).orderBy(schema.jobRun.job, desc(schema.jobRun.startedAt));
}

/** Finished runs older than JOB_RUN_RETENTION_DAYS. A run still going is never touched. */
export async function purgeJobRuns(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = (await db()
    .delete(schema.jobRun)
    .where(and(lt(schema.jobRun.startedAt, before), ne(schema.jobRun.status, "running")))) as { count?: number; rowCount?: number } | undefined;
  // postgres-js answers with `count`, the PGlite the service tests run on with `rowCount`.
  return result?.count ?? result?.rowCount ?? 0;
}

// ── Running a schedule ────────────────────────────────────────────────────────────────────

/**
 * How long one invocation spends starting jobs (ENG-01). A cron function lives `maxDuration` (300 s)
 * at most; a job started after this point would have under a minute left. The jobs not started by
 * then are handed to a fresh invocation, in order, rather than skipped — the tail of the midnight
 * schedule is the retention work nobody would otherwise notice was not done.
 */
export const SCHEDULE_BUDGET_SECONDS = 240;

export type JobOutcome = { job: string; status: "succeeded" | "failed" | "already_running" | "not_due"; result: unknown; error: string | null };

export type ScheduleProgress = {
  outcomes: JobOutcome[];
  /** The index of the first job not started for want of time, or null when every job ran. */
  next: number | null;
};

/**
 * Runs `jobs` from `from` onwards, one by one and in order, until they are done or the time budget
 * is spent. `startedAt` is when this invocation began; `clock` is for the tests.
 */
export async function runSchedule(jobs: readonly JobDefinition[], from: number, options: { startedAt: Date; budgetSeconds?: number; clock?: () => Date }): Promise<ScheduleProgress> {
  const clock = options.clock ?? (() => new Date());
  const budgetMs = (options.budgetSeconds ?? SCHEDULE_BUDGET_SECONDS) * 1000;
  const outcomes: JobOutcome[] = [];
  for (let index = from; index < jobs.length; index++) {
    // The first job of an invocation always starts: an invocation that ran nothing would hand on for ever.
    if (index > from && clock().getTime() - options.startedAt.getTime() >= budgetMs) return { outcomes, next: index };
    const run = await runJob(jobs[index], clock());
    outcomes.push({ job: jobs[index].name, status: run?.status === "succeeded" || run?.status === "failed" ? run.status : "already_running", result: run?.result ?? null, error: run?.error ?? null });
  }
  return { outcomes, next: null };
}

/**
 * The dead-man's switch (ENG-01): tells the uptime service a schedule started, finished or failed,
 * so that a schedule that never fired — or died without a word — is noticed by something outside
 * the app. A ping that cannot be delivered is logged and forgotten: the jobs matter more than it.
 */
export async function pingSchedule(base: string | undefined, schedule: string, state: "start" | "success" | "fail"): Promise<void> {
  if (!base) return;
  const url = `${base.replace(/\/+$/, "")}/${encodeURIComponent(schedule)}${state === "success" ? "" : `/${state}`}`;
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000), cache: "no-store" });
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "cron.ping_failed", schedule, state, message: error instanceof Error ? error.message : String(error) }));
  }
}
