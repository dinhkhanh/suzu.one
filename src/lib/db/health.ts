// Is the database there? For `/api/health` (NFR-OPS-03): one `select 1` through the same pool —
// the pooler — every page uses, given a few seconds. An uptime check that asks every minute must
// learn "down" from a slow answer as well as from a refused one, and must never hold a function
// for the five minutes a hung pooler would.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

/** Long enough for a cold connect through the pooler (one round trip from Singapore), short enough to answer an uptime check before it gives up. */
export const HEALTH_TIMEOUT_MS = 3000;

type Probe = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export async function databaseReachable(timeoutMs: number = HEALTH_TIMEOUT_MS, executor: Probe = db()): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([executor.execute(sql`select 1`).then(() => true), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
