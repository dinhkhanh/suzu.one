"use server";
// "Run now" on Admin → Jobs (ENG-05). Lives at the composition root because it reaches every
// module's jobs through the cron registry. The run is the scheduled one — the same `runJob`, the
// same job_run row, the same notice to the owners if it fails — started by a person, whose name
// the audit log keeps beside the job's own entry.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { isDevelopmentEnvironment } from "@/lib/env";
import { canRunJobs } from "@/modules/platform/jobs/policy";
import { runJob } from "@/modules/platform/jobs/service";
import { DEVELOPMENT_ONLY, jobNamed } from "../../../api/cron/registry";

const runNowPipeline = createAction({
  name: "job.run_now",
  input: z.object({ job: z.string().min(1).max(80) }),
  authorize: (user) => canRunJobs(user.principal),
  run: async ({ input }) => {
    const definition = jobNamed(input.job);
    if (!definition || (DEVELOPMENT_ONLY.has(definition.name) && !isDevelopmentEnvironment())) throw new ActionError("job_unknown");
    const run = await runJob(definition);
    if (!run) throw new ActionError("job_already_running");
    revalidatePath("/admin/jobs");
    return {
      data: { status: run.status, error: run.error },
      audit: { resource: { type: "job_run", id: run.id }, summary: `${definition.name}: ${run.status}` },
    };
  },
});

export async function runJobNowAction(input: unknown) {
  return runNowPipeline(input);
}
