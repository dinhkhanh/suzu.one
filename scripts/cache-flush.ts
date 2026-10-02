// Empties this database's entries in the shared cache (Vercel's Data Cache, src/lib/cache). The
// app clears what it changes itself; run this after writing behind its back — a seed, a manual fix
// in SQL — or the old values stay until their TTL runs out (at most an hour).
// `pnpm cache:flush [app URL]`.
//
// Only a running Vercel function can delete Data Cache entries, so this asks the deployment to do
// it: the `cache-flush` job, behind CRON_SECRET, on the given URL or else BETTER_AUTH_URL. A local
// server keeps no shared cache (src/lib/cache/vercel.ts), so there is nothing to flush there.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const base = process.argv[2] ?? process.env.BETTER_AUTH_URL;
  const secret = process.env.CRON_SECRET;
  if (!base) throw new Error("No app URL: pass one, or set BETTER_AUTH_URL (see .env.example)");
  const url = new URL("/api/cron/cache-flush", base);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return console.log("A local server keeps no shared cache: there is nothing to flush.");
  if (!secret) throw new Error("CRON_SECRET is not set (see .env.example)");

  const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${url.origin} answered ${response.status}: ${body}`);
  const flushed = (JSON.parse(body) as { outcomes?: { result?: { flushed?: boolean } | null }[] }).outcomes?.[0]?.result?.flushed;
  console.log(flushed ? `Flushed the cache of ${url.origin}.` : `${url.origin} keeps no shared cache (DATA_CACHE=off?): nothing to flush.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
