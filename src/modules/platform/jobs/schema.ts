import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const jobStatus = pgEnum("job_status", ["running", "succeeded", "failed"]);

// One row per run of a scheduled job: what ran, when, and what it did or why it failed.
export const jobRun = pgTable(
  "job_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    status: jobStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Counts and other facts the job reports about its own work.
    result: jsonb("result"),
    error: text("error"),
  },
  (t) => [
    index("job_run_job_started_at_idx").on(t.job, t.startedAt),
    // A job never runs twice at once; a second trigger finds this row and backs off.
    uniqueIndex("job_run_one_running_key").on(t.job).where(sql`${t.status} = 'running'`),
  ],
).enableRLS();
