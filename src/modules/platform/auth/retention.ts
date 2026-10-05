// What the way in leaves behind (ENG-04), swept nightly by the platform's housekeeping job:
//   · sessions past their expiry — Better Auth deletes one only when its cookie comes back, and a
//     phone that is lost or reset never comes back, so the row (and its token) stayed for ever;
//   · `verification` rows — the OAuth state of a sign-in that was started and never finished;
//   · the rate limiter's counted windows (`endpoint-limit.ts`).
import "server-only";
import { lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { purgeAuthHits } from "./endpoint-limit";
import { AUTH_HIT_RETENTION_DAYS } from "./rate-limit";
import { invalidateSessionTokens } from "./session-cache";

/**
 * A day past its expiry, a session or a sign-in state is no use to anybody: nothing accepts it
 * after the expiry itself, and the day's grace only keeps the sweep away from a row Better Auth may
 * be refreshing at that moment.
 */
export const EXPIRED_AUTH_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const deleted = (result: unknown) => (result as { count?: number; rowCount?: number } | undefined)?.count ?? (result as { rowCount?: number } | undefined)?.rowCount ?? 0;

export async function purgeExpiredAuthRows(now: Date = new Date()): Promise<{ sessionsExpired: number; signInStatesExpired: number; authHits: number }> {
  const before = new Date(now.getTime() - EXPIRED_AUTH_GRACE_DAYS * DAY_MS);
  const sessions = await db().delete(schema.session).where(lt(schema.session.expiresAt, before)).returning({ token: schema.session.token });
  // Nothing reads an expired session from the cache either (`session.ts` checks the expiry), but a
  // writer of a cached table drops what it changed.
  if (sessions.length > 0) await invalidateSessionTokens(sessions.map((row) => row.token));
  const states = await db().delete(schema.verification).where(lt(schema.verification.expiresAt, before));
  const authHits = await purgeAuthHits(new Date(now.getTime() - AUTH_HIT_RETENTION_DAYS * DAY_MS));
  return { sessionsExpired: sessions.length, signInStatesExpired: deleted(states), authHits };
}
