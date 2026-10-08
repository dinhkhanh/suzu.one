// The rate limiter of the way in (NFR-SEC-03): Better Auth's `/api/auth/*`, counted per address,
// and the step-up round trip, counted per session. The limits and the window arithmetic are
// `rate-limit.ts`; this is the one table and the one statement behind them.
import "server-only";
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AUTH_LIMITS, type AuthBucket, retryAfterSeconds, windowStartFor, withinLimit } from "./rate-limit";

export type AuthLimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * What a caller is counted under: a hash of its kind and value, so the table names nobody. An
 * address the platform did not give us is counted as one shared "unknown" — on Vercel it always does.
 */
export const authLimitKey = (kind: "ip" | "session", value: string | null): string =>
  createHash("sha256")
    .update(`${kind}:${value ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);

/**
 * Counts one call and says whether it is allowed: one row per (bucket, key, window), one atomic
 * upsert that cannot race, and the returned count already includes this call.
 */
export async function countAuthHit(bucket: AuthBucket, keyHash: string, at: Date = new Date()): Promise<AuthLimitOutcome> {
  const limit = AUTH_LIMITS[bucket];
  const windowStart = windowStartFor(at, limit.windowSeconds);
  const [row] = await db()
    .insert(schema.authEndpointHit)
    .values({ bucket, keyHash, windowStart, hits: 1, lastAt: at })
    .onConflictDoUpdate({
      target: [schema.authEndpointHit.bucket, schema.authEndpointHit.keyHash, schema.authEndpointHit.windowStart],
      set: { hits: sql`${schema.authEndpointHit.hits} + 1`, lastAt: at },
    })
    .returning({ hits: schema.authEndpointHit.hits });
  return withinLimit(row?.hits ?? 1, limit) ? { ok: true } : { ok: false, retryAfterSeconds: retryAfterSeconds(at, limit.windowSeconds) };
}

/** Counted windows nobody can still be inside. Swept nightly by the platform's housekeeping. */
export async function purgeAuthHits(before: Date): Promise<number> {
  // The database counts what it deleted; reading the rows back to count them would carry them here.
  const result = (await db().delete(schema.authEndpointHit).where(lt(schema.authEndpointHit.windowStart, before))) as { count?: number; rowCount?: number } | undefined;
  // postgres-js answers with `count`, the PGlite the service tests run on with `rowCount`.
  return result?.count ?? result?.rowCount ?? 0;
}
