// The rate limiter of the endpoints nobody signs in to (NFR-SEC-03): a kiosk tablet's
// `/api/kiosk/*`, counted per kiosk session, and a clock's `/api/attendance/device/*`, counted per
// clock. The limits and the window arithmetic are `engine/rate-limit.ts`; this is the one table
// and the one statement behind them.
//
// A call is counted **after** it has shown its credential, under the session or the clock that
// credential belongs to: a request with no kiosk or clock behind it is refused before it gets
// here, so a stranger cannot fill the table with keys of their own invention.
import "server-only";
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ENDPOINT_LIMITS, type EndpointBucket, retryAfterSeconds, windowStartFor, withinLimit } from "./engine/rate-limit";

export type EndpointLimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/** What a caller is counted under: a hash of its kind and id, so the table names nothing. */
export const endpointKey = (kind: "kiosk" | "device", id: string): string => createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0, 32);

/**
 * Counts one call and says whether it is allowed: one row per (bucket, key, window), one atomic
 * upsert that cannot race, and the returned count already includes this call.
 */
export async function countEndpointHit(bucket: EndpointBucket, keyHash: string, at: Date = new Date()): Promise<EndpointLimitOutcome> {
  const limit = ENDPOINT_LIMITS[bucket];
  const windowStart = windowStartFor(at, limit.windowSeconds);
  const [row] = await db()
    .insert(schema.attendanceEndpointHit)
    .values({ bucket, keyHash, windowStart, hits: 1, lastAt: at })
    .onConflictDoUpdate({
      target: [schema.attendanceEndpointHit.bucket, schema.attendanceEndpointHit.keyHash, schema.attendanceEndpointHit.windowStart],
      set: { hits: sql`${schema.attendanceEndpointHit.hits} + 1`, lastAt: at },
    })
    .returning({ hits: schema.attendanceEndpointHit.hits });
  return withinLimit(row?.hits ?? 1, limit) ? { ok: true } : { ok: false, retryAfterSeconds: retryAfterSeconds(at, limit.windowSeconds) };
}

/** Counted windows nobody can still be inside. Swept nightly with the kiosk's other housekeeping (`faces.ts`). */
export async function purgeEndpointHits(before: Date): Promise<number> {
  // The database counts what it deleted; reading the rows back to count them would carry them here.
  const result = (await db().delete(schema.attendanceEndpointHit).where(lt(schema.attendanceEndpointHit.windowStart, before))) as { count?: number; rowCount?: number } | undefined;
  // postgres-js answers with `count`, the PGlite the service tests run on with `rowCount`.
  return result?.count ?? result?.rowCount ?? 0;
}
