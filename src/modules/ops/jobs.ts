import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { dateInMonth } from "./engine/due-rule";
import { sendOpsReminders } from "./reminders";
import { generateInstances } from "./scheduler";

/** In both cron schedules: a hire recorded in the afternoon has its insurance registration waiting the next morning at the latest. Safe to re-run. */
export const opsSchedulerJob: JobDefinition = {
  name: "ops-scheduler",
  run: async ({ today }) => generateInstances(today),
};

/**
 * Run by hand (/api/cron/ops-backfill), once, when the tracker goes live or the demo is seeded:
 * the daily scheduler never looks back, so this creates what fell due since the first day of last
 * month — the open items people are already working on. Idempotent like the scheduler.
 */
export const opsBackfillJob: JobDefinition = {
  name: "ops-backfill",
  run: async ({ today }) => generateInstances(today, { from: dateInMonth(Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 1, 1) }),
};

/** Every morning before the digest (FR-OPS-08): lead-time reminders, the first day late, then the escalation chain. Idempotent through `obligation_notice_sent`. */
export const opsRemindersJob: JobDefinition = {
  name: "ops-reminders",
  run: async ({ today }) => sendOpsReminders(today),
};
