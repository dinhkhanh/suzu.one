// Empties this database's entries in the shared Redis cache (src/lib/cache). The app clears what
// it changes itself; run this after writing behind its back — a seed, a manual fix in SQL — or the
// old values stay until their TTL runs out (at most an hour). `pnpm cache:flush`.
import { config } from "dotenv";
import { Redis } from "@upstash/redis";
import { cachePrefix } from "../src/lib/cache/prefix";

config({ path: ".env.local" });

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
  if (!url || !token) return console.log("No KV_REST_API_URL/KV_REST_API_TOKEN: there is no cache to flush.");
  const redis = new Redis({ url, token });
  // Every version of this database's entries, not just the current one.
  const pattern = cachePrefix(databaseUrl).replace(/[^:]+:$/, "*");
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { match: pattern, count: 500 });
    if (keys.length) removed += await redis.del(...keys);
    cursor = String(next);
  } while (cursor !== "0");
  console.log(`Removed ${removed} cache entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
