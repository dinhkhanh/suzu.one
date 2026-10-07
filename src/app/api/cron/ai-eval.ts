// The assistant's evaluation set, **development only** (Phase 9 exit criterion). Run by hand:
//   pnpm dev            # in another terminal
//   pnpm ai:eval
// It reads the seeded demo knowledge base and writes nothing: no conversation, no unanswered
// question, no audit trail of a hundred fake askers. The report goes into `job_run.result`, and
// `scripts/ai-eval.ts` prints it.
import "server-only";
import { isDevelopmentEnvironment } from "@/lib/env";
import { runEval } from "@/modules/ai/eval/run";
import { runAgentEval } from "@/modules/ai/eval/run-agent";
import type { JobDefinition } from "@/modules/platform/jobs/service";

export const aiEvalJob: JobDefinition = {
  name: "ai-eval",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("ai-eval runs on a development server only");
    const report = await runEval();
    return { ...report } as unknown as Record<string, unknown>;
  },
};

/**
 * Evaluation set v2 (Phase 13): the agent, on the real model. **Spends money** on the owner's key —
 * run only with the owner's approval of the cost (`pnpm ai:eval --agent`).
 */
export const aiAgentEvalJob: JobDefinition = {
  name: "ai-eval-agent",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("ai-eval-agent runs on a development server only");
    const report = await runAgentEval();
    return { ...report } as unknown as Record<string, unknown>;
  },
};

/** R4 alone: the acting set and the red team (`pnpm ai:eval --agent --acting --yes`) — about a third of the cost. */
export const aiActingEvalJob: JobDefinition = {
  name: "ai-eval-agent-acting",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("ai-eval-agent-acting runs on a development server only");
    const report = await runAgentEval({ kinds: ["acting", "red_team"] });
    return { ...report } as unknown as Record<string, unknown>;
  },
};
