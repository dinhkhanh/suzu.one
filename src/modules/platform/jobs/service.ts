import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { recordAudit } from "../audit/service";
import { notify } from "../notifications/service";
import { listOwnerPersonIds } from "../rbac/service";

export type JobDefinition = {
  /** Also the last segment of its trigger URL: /api/cron/<name>. */
  name: string;
  /** Must be safe to run again: a retry or a second trigger on the same day changes nothing more. */
  run: (context: { today: IsoDate }) => Promise<Record<string, unknown>>;
};

export type JobRunRow = typeof schema.jobRun.$inferSelect;

// A run that has not finished after this long died with its server; the next trigger takes over.
const STALE_AFTER_MINUTES = 15;

/** Runs a job once and records the outcome. Returns null when the job is already running. */
export async function runJob(definition: JobDefinition, now: Date = new Date()): Promise<JobRunRow | null> {
  await db()
    .update(schema.jobRun)
    .set({ status: "failed", finishedAt: now, error: "timed_out" })
    .where(and(eq(schema.jobRun.job, definition.name), eq(schema.jobRun.status, "running"), lt(schema.jobRun.startedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${STALE_AFTER_MINUTES})`)));

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
    const [failed] = await db().update(schema.jobRun).set({ status: "failed", finishedAt: new Date(), error: message.slice(0, 2000) }).where(eq(schema.jobRun.id, run.id)).returning();
    await recordAudit({ action: `job.${definition.name}.failed`, resource: { type: "job_run", id: run.id }, summary: message.slice(0, 300) });
    console.error(JSON.stringify({ level: "error", event: "job.failed", job: definition.name, runId: run.id, message }));
    // NFR-OPS-03: a failed job must reach a human, not just a log.
    await notify({ recipients: await listOwnerPersonIds(), kind: "system.job_failed", params: { job: definition.name, error: message.slice(0, 300) }, link: "/admin/jobs" }).catch(() => undefined);
    return failed;
  }
}

export async function listRecentJobRuns(limit = 50): Promise<JobRunRow[]> {
  return db().select().from(schema.jobRun).orderBy(desc(schema.jobRun.startedAt)).limit(limit);
}
