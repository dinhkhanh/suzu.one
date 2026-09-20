// Demo payroll runs, local only. The runs come from the REAL use-cases: this script asks the
// running dev server to run the development-only `payroll-demo-runs` job, which locks each
// entity's August 2026 timesheet if HR has not, calculates the month, walks it through the whole
// D17 lifecycle — proposed, signed, payment prepared, paid, locked — publishes the payslips, and
// leaves September as a draft because its timesheet is still open.
//
// Order: `pnpm db:seed && pnpm db:seed:demo`, `pnpm dev` in another terminal, then
// `pnpm db:seed:demo:payroll`. (The ops demo seed works the same way and can be run either side.)
// To start over: delete from payroll_run cascades through its people, payslips and payment rows.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const base = process.env.RECOMPUTE_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("seed-demo-payroll-runs.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");

  let response: Response;
  try {
    response = await fetch(`${base}/api/cron/payroll-demo-runs`, { headers: { authorization: `Bearer ${secret}` } });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm db:seed:demo:payroll`.");
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
