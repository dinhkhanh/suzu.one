// The assistant's evaluation set, **development only** (Phase 9 exit criterion). Run by hand:
//   pnpm dev            # in another terminal
//   pnpm ai:eval
// It reads the seeded demo knowledge base and writes nothing: no conversation, no unanswered
// question, no audit trail of a hundred fake askers. The report goes into `job_run.result`, and
// `scripts/ai-eval.ts` prints it.
import "server-only";
import { isDevelopmentEnvironment } from "@/lib/env";
import { runEval } from "@/modules/ai/eval/run";
import type { JobDefinition } from "@/modules/platform/jobs/service";

export const aiEvalJob: JobDefinition = {
  name: "ai-eval",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("ai-eval runs on a development server only");
    const report = await runEval();
    return { ...report } as unknown as Record<string, unknown>;
  },
};
