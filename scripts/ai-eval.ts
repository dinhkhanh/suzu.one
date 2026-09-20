// Runs the assistant's evaluation set and prints the score (Phase 9 exit criterion).
// The set lives in the app (it needs the app's retrieval, which needs the app's services), so the
// app must be up: `pnpm dev` in another terminal, then `pnpm ai:eval`.
import { config } from "dotenv";

config({ path: ".env.local" });

type Bucket = Record<string, { total: number; passed: number }>;
type Failure = { id: string; who: string; kind: string; question: string; problem: string | null; score: number };
type Report = { driver: string; model: string; embeddingModel: string; total: number; passed: number; percent: number; byKind: Bucket; byLocale: Bucket; citedAnywhere: number; lowestCorrect: number; highestWronglyAnswered: number; failures: Failure[] };

const share = (bucket: Bucket) =>
  Object.entries(bucket)
    .map(([key, value]) => `${key} ${value.passed}/${value.total}`)
    .join(" · ");

async function main() {
  const base = process.env.AI_EVAL_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("ai-eval.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");

  let response: Response;
  try {
    response = await fetch(`${base}/api/cron/ai-eval`, { headers: { authorization: `Bearer ${secret}` } });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm ai:eval`.");
    return;
  }
  const body = (await response.json()) as { outcomes: { status: string; result: Report | null; error: string | null }[] };
  const outcome = body.outcomes?.[0];
  if (!outcome || outcome.status !== "succeeded" || !outcome.result) {
    console.error(`ai-eval ${outcome?.status ?? response.status}: ${outcome?.error ?? "no result"}`);
    process.exitCode = 1;
    return;
  }

  const report = outcome.result;
  console.log("");
  console.log(`  Assistant evaluation — driver ${report.driver} (${report.model}), embeddings ${report.embeddingModel}`);
  console.log("  " + "─".repeat(72));
  console.log(`  SCORE  ${report.percent}%   (${report.passed}/${report.total} correct)`);
  console.log(`  by kind    ${share(report.byKind)}`);
  console.log(`  by language ${share(report.byLocale)}`);
  console.log(`  right page cited somewhere in the answer: ${report.citedAnywhere}% of answerable questions`);
  console.log(`  threshold window: weakest correct answer ${report.lowestCorrect} · strongest wrong answer ${report.highestWronglyAnswered}`);
  if (report.failures.length > 0) {
    console.log("");
    console.log(`  ${report.failures.length} failing:`);
    for (const failure of report.failures) console.log(`    ${failure.id.padEnd(22)} [${failure.who}] ${failure.problem ?? ""}  (score ${failure.score})\n      ${failure.question}`);
  }
  console.log("");
  if (report.percent < 85) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
