// Fills `timesheet_day` on a local machine (after the demo seed, or after a bulk fix): asks the
// running dev server to run the nightly job — last month and this month for everyone, locked
// months left alone. The job lives in the app (it needs the app's services), so the app must be
// up: `pnpm dev` in another terminal, then `pnpm db:recompute`. HR's "Recompute" button on
// Attendance → Team timesheet does the same per entity.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const base = process.env.RECOMPUTE_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("recompute-timesheets.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");
  let response: Response;
  try {
    response = await fetch(`${base}/api/cron/timesheet-recompute`, { headers: { authorization: `Bearer ${secret}` } });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm db:recompute` — or use Attendance → Team timesheet → Recompute.");
    return;
  }
  console.log(`${response.status} ${await response.text()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
