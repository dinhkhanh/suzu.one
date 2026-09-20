// The demo year-end bonus run, local only. Like the payroll demo, the run comes from the REAL
// use-cases: this script asks the running dev server to run the development-only `bonus-demo-run`
// job, which builds the 2026 run over every entity with settled results, simulates the group's
// cost, lets the owner adjust one amount with a reason, has HR propose and the CEO sign it (which
// freezes the KPI months behind it), then pays it through one off-cycle payroll run per entity.
//
// Order: `pnpm db:seed && pnpm db:seed:demo`, `pnpm dev` in another terminal, then
// `pnpm db:seed:demo:bonus`. To start over: delete from bonus_run (cascades to its lines and
// events) and from kpi_score_use.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const base = process.env.RECOMPUTE_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("seed-demo-bonus-run.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");

  let response: Response;
  try {
    response = await fetch(`${base}/api/cron/bonus-demo-run`, { headers: { authorization: `Bearer ${secret}` } });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm db:seed:demo:bonus`.");
    return;
  }

  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body}`);
  console.log(body);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
