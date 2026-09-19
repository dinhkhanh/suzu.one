import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { generateInstances } from "./scheduler";

/** In both cron schedules: a hire recorded in the afternoon has its insurance registration waiting the next morning at the latest. Safe to re-run. */
export const opsSchedulerJob: JobDefinition = {
  name: "ops-scheduler",
  run: async ({ today }) => generateInstances(today),
};
