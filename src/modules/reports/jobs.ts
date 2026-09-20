// The reports module's scheduled job.
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { runDueSchedules } from "./schedules";

/**
 * Morning: every active schedule due on or before today, once. Safe to run again — a schedule whose
 * `last_run_on` is already today is skipped, and the next date is computed from the day it ran.
 */
export const reportSchedulesJob: JobDefinition = {
  name: "report-schedules",
  run: async ({ today }) => ({ ...(await runDueSchedules(today)) }),
};
