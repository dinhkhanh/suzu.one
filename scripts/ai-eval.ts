// Runs the assistant's evaluation set and prints the score (Phase 9 exit criterion).
// The set lives in the app (it needs the app's retrieval, which needs the app's services), so the
// app must be up: `pnpm dev` in another terminal, then `pnpm ai:eval`. `pnpm ai:eval --agent --yes`
// runs evaluation set v2 on the agent and the real models instead (Phase 13) — it costs money;
// `--acting` runs only R4's acting set and the red team; `--pay` only the payroll persona and the red team.
import { get } from "node:http";
import { config } from "dotenv";

config({ path: ".env.local" });

type Bucket = Record<string, { total: number; passed: number }>;
type Failure = { id: string; who: string; kind: string; question: string; problem: string | null; score: number };
type Report = {
  driver: string;
  model: string;
  embeddingModel: string;
  total: number;
  passed: number;
  percent: number;
  byKind: Bucket;
  byLocale: Bucket;
  citedAnywhere: number;
  lowestCorrect: number;
  highestWronglyAnswered: number;
  failures: Failure[];
};

const share = (bucket: Bucket) =>
  Object.entries(bucket)
    .map(([key, value]) => `${key} ${value.passed}/${value.total}`)
    .join(" · ");

type AgentReport = {
  models: { simple: string; standard: string; complex: string };
  total: number;
  passed: number;
  byKind: Record<string, { total: number; passed: number; percent: number }>;
  byFinalTier: Record<string, number>;
  cost: { turns: number; p50MicroUsd: number; p95MicroUsd: number; totalMicroUsd: number };
  latency?: { p50Ms: number; p95Ms: number; maxMs: number };
  failures: { id: string; who: string; kind: string; question: string; problem: string | null; tools: string[]; tiers: string[] }[];
};

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;

/** R1's exit (DEVELOPMENT_PLAN Phase 13): employee ≥ 85 %, out of scope ≥ 95 %, red team 100 %. */
const AGENT_EXIT: Record<string, number> = { acting: 90, employee: 85, lead: 85, ceo: 85, hr: 85, payroll: 85, finance: 85, out_of_scope: 95, red_team: 100 };

function printAgent(report: AgentReport) {
  console.log("");
  console.log(`  Agent evaluation v2 — ${report.models.simple} → ${report.models.standard} → ${report.models.complex}`);
  console.log("  " + "─".repeat(72));
  console.log(`  ${report.passed}/${report.total} correct`);
  for (const [kind, bucket] of Object.entries(report.byKind)) console.log(`  ${kind.padEnd(14)} ${String(bucket.percent).padStart(5)}%  (${bucket.passed}/${bucket.total}, exit ≥ ${AGENT_EXIT[kind] ?? "?"}%)`);
  console.log(
    `  turns ending on each tier: ${Object.entries(report.byFinalTier)
      .map(([tier, count]) => `${tier} ${count}`)
      .join(" · ")}`,
  );
  console.log(`  cost per turn: p50 ${usd(report.cost.p50MicroUsd)} · p95 ${usd(report.cost.p95MicroUsd)} · ${report.cost.turns} turns, ${usd(report.cost.totalMicroUsd)} in all`);
  // NFR-AGT-01: a full answer p50 < 8 s, p95 < 20 s — measured on this machine, without the phone's network.
  if (report.latency) console.log(`  time per turn: p50 ${(report.latency.p50Ms / 1000).toFixed(1)} s · p95 ${(report.latency.p95Ms / 1000).toFixed(1)} s · max ${(report.latency.maxMs / 1000).toFixed(1)} s`);
  if (report.failures.length > 0) {
    console.log("");
    console.log(`  ${report.failures.length} failing:`);
    for (const failure of report.failures) console.log(`    ${failure.id.padEnd(26)} [${failure.who}] ${failure.problem ?? ""}  (${failure.tiers.join("→") || "no model"})\n      ${failure.question}`);
  }
  console.log("");
  if (Object.entries(report.byKind).some(([kind, bucket]) => bucket.percent < (AGENT_EXIT[kind] ?? 100))) process.exitCode = 1;
}

async function main() {
  const agent = process.argv.includes("--agent");
  // The agent's set runs on the owner's key and costs real money: about 80 turns at a few cents
  // each. It runs only when asked for twice — the flag and the confirmation.
  if (agent && !process.argv.includes("--yes")) {
    console.log("The agent evaluation sends about 80 questions to the real models and costs roughly $1–5 on the owner's key.");
    console.log("Run it with: pnpm ai:eval --agent --yes");
    return;
  }
  const base = process.env.AI_EVAL_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("ai-eval.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");

  // `node:http`, not `fetch`: the agent's set takes longer than fetch waits for response headers
  // (five minutes), and a client that gives up does not stop the run — it only loses the report.
  let response: { status: number; text: string };
  try {
    response = await new Promise((resolve, reject) => {
      const job = agent ? (process.argv.includes("--acting") ? "ai-eval-agent-acting" : process.argv.includes("--pay") ? "ai-eval-agent-pay" : "ai-eval-agent") : "ai-eval";
      const request = get(`${base}/api/cron/${job}`, { headers: { authorization: `Bearer ${secret}` } }, (reply) => {
        let text = "";
        reply.setEncoding("utf8");
        reply.on("data", (chunk: string) => (text += chunk));
        reply.on("end", () => resolve({ status: reply.statusCode ?? 0, text }));
      });
      request.on("error", reject);
    });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm ai:eval`.");
    return;
  }
  const body = JSON.parse(response.text) as { outcomes: { status: string; result: Report | AgentReport | null; error: string | null }[] };
  const outcome = body.outcomes?.[0];
  if (!outcome || outcome.status !== "succeeded" || !outcome.result) {
    console.error(`ai-eval ${outcome?.status ?? response.status}: ${outcome?.error ?? "no result"}`);
    process.exitCode = 1;
    return;
  }

  if (agent) return printAgent(outcome.result as AgentReport);
  const report = outcome.result as Report;
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
