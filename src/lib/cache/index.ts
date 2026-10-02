import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { env } from "@/lib/env";
import { decode, encode } from "./codec";
import { cachePrefix, cacheScopeTag } from "./prefix";
import { purgeApi } from "./vercel";

// A shared read-through cache in front of Postgres: Vercel's Data Cache, through Next.js's
// `unstable_cache` (owner's decision 2026-10-02, replacing Upstash Redis). A page asks the cache
// first and Postgres only for what the cache does not hold; every entry has a TTL as a backstop,
// and every write path that changes cached data calls `invalidate()` with the entry's key. The
// cache being slow, full or absent is never an error: the read falls through to Postgres.
//
// Three tiers, by how the data changes (owner's decision 2026-09-25):
//   reference — types, templates, rules, the org tree: one key for the whole small table, a long
//               TTL, every writer invalidates.
//   personal  — a person's own rows (session, profile, memberships, saved views): one key per
//               person, a short TTL, every writer invalidates; the TTL only bounds a write made
//               behind the app's back.
//   live      — what many hands change (badges, inboxes, today's page): one key per person and
//               screen (`live.ts`), the shortest TTL, invalidated for the actor after every action
//               and for the recipients of every notification.
// Restricted and compensation data (identity numbers, bank details, salaries, payslips) are never
// cached: they stay in Postgres and are read per request.
//
// Every entry is tagged with its key, and `invalidate()` deletes by that tag through Vercel's purge
// API (`dangerouslyDeleteByTag`: gone at once, in every region, not served stale). Not Next's
// `revalidateTag`: that one waits for the end of the request and, in a server action, makes every
// action re-render the page it was called from, and `createAction()` invalidates after every action.
// The cache is only used where entries can be deleted again — inside a Vercel function. A
// developer's machine, a script and a test read Postgres directly.

/** Seconds an entry may live without a writer invalidating it. */
export const TTL = { reference: 60 * 60, personal: 5 * 60, live: 60 } as const;

/** What is stored: the value (codec-encoded, so Dates survive) and when the read behind it began. */
type Entry = { at: number; v?: string };

let scope: { prefix: string; all: string } | null | undefined;

function names(): { prefix: string; all: string } | null {
  if (scope !== undefined) return scope;
  try {
    const config = env();
    scope = config.DATA_CACHE === "off" ? null : { prefix: cachePrefix(config.POSTGRES_URL), all: cacheScopeTag(config.POSTGRES_URL) };
  } catch {
    // An environment without a database configured (unit tests) runs without the cache; a real
    // misconfiguration still fails loudly at the first query.
    scope = null;
  }
  return scope;
}

/**
 * How long, after `invalidate()`, this instance reads the key from Postgres and stores nothing. The
 * deletion is immediate but the change behind it may not be committed yet (writers may invalidate
 * inside their transaction): a read in that window would put the old rows straight back.
 */
const STALE_MS = 30_000;
/**
 * Another instance can still do that: read the old rows just before the commit and store them just
 * after the deletion. So the keys are deleted once more this long after the response — by then the
 * commit has landed and such a read has stored what it had.
 */
const REDELETE_AFTER_MS = 3_000;
const INVALIDATE_TIMEOUT_MS = 2_000;
/** Vercel takes at most this many tags per purge call. */
const TAGS_PER_CALL = 16;

/**
 * When this instance last invalidated each entry. Older than a day it cannot matter: no TTL is that
 * long. Kept on `globalThis` because Next may load this module once per route bundle, and the
 * action that writes and the page that reads next must see the same map.
 */
const INVALIDATED_AT = Symbol.for("suzu.cache.invalidatedAt");
const invalidatedAt: Map<string, number> = ((globalThis as { [INVALIDATED_AT]?: Map<string, number> })[INVALIDATED_AT] ??= new Map());
const REMEMBER_MS = 24 * 3600_000;

function noteInvalidated(tags: readonly string[], now: number) {
  if (invalidatedAt.size > 10_000) for (const [tag, at] of invalidatedAt) if (now - at > REMEMBER_MS) invalidatedAt.delete(tag);
  for (const tag of tags) invalidatedAt.set(tag, now);
}

function recentlyInvalidated(tag: string, now: number): boolean {
  const at = invalidatedAt.get(tag);
  return at !== undefined && now - at < STALE_MS;
}

/**
 * The entry's tag (and key): the key itself where Vercel takes it as one tag — printable ASCII, no
 * comma (its separator), well under its 256 bytes — and a hash of it otherwise, since an over-long
 * tag is quietly dropped and its entry could never be deleted.
 */
export function entryTag(prefix: string, key: string): string {
  return /^[\x21-\x2b\x2d-\x7e]{1,160}$/.test(key) ? prefix + key : `${prefix}#${createHash("sha256").update(key).digest("hex")}`;
}

function warn(operation: string, error: unknown) {
  console.warn(`[cache] ${operation} failed:`, error instanceof Error ? error.message : error);
}

/** True when this request runs where the Data Cache is, and the entry may be stored and read. */
function usable(): { prefix: string; all: string } | null {
  const named = names();
  return named && purgeApi() ? named : null;
}

/**
 * A stored entry still answers: it holds a value, is younger than its TTL (Next serves an older one
 * once while it refreshes it behind the response), and its read began after the last change this
 * instance made to it (`changedAt`).
 */
export function isFresh(entry: Entry | undefined, ttlSeconds: number, now: number, changedAt?: number): entry is Entry & { v: string } {
  return !!entry && typeof entry.v === "string" && now - entry.at < ttlSeconds * 1000 && (changedAt === undefined || entry.at > changedAt);
}

/**
 * Returns the cached value under `key`, or runs `load`, stores its result for `ttlSeconds` and
 * returns it. `undefined` is never cached (use null for "known to be absent").
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const named = usable();
  if (!named) return load();
  const tag = entryTag(named.prefix, key);
  if (recentlyInvalidated(tag, Date.now())) return load();

  // `load` runs in the caller's context, not inside `unstable_cache`'s: there Next refuses headers
  // and cookies (Better Auth's session read uses both), revalidation and `after()`, and a loader may
  // need any of them — as it could when the cache was Redis.
  const loadHere = AsyncLocalStorage.bind(load);
  let outcome: { value: T } | { error: unknown } | undefined;
  const read = unstable_cache(
    async (): Promise<Entry> => {
      const at = Date.now();
      try {
        const value = await loadHere();
        outcome = { value };
        return { at, v: value === undefined ? undefined : encode(value) };
      } catch (error) {
        outcome = { error };
        throw error;
      }
    },
    [tag],
    { tags: [tag, named.all], revalidate: ttlSeconds },
  );

  let entry: Entry | undefined;
  try {
    entry = await read();
  } catch (error) {
    // A failing `load` is the caller's error; a failing cache is not.
    if (outcome && "error" in outcome) throw outcome.error;
    if (!outcome) {
      warn(`read ${key}`, error);
      return load();
    }
  }
  if (outcome && "value" in outcome) return outcome.value;
  if (!isFresh(entry, ttlSeconds, Date.now(), invalidatedAt.get(tag))) return load();
  return decode<T>(entry.v);
}

async function deleteTags(tags: readonly string[], purge: NonNullable<ReturnType<typeof purgeApi>>): Promise<void> {
  const calls: Promise<void>[] = [];
  for (let start = 0; start < tags.length; start += TAGS_PER_CALL) calls.push(purge.dangerouslyDeleteByTag(tags.slice(start, start + TAGS_PER_CALL)));
  await Promise.all(calls);
}

/**
 * Deletes the entries after the data behind them changed — at once, and once more shortly after
 * the response (see `REDELETE_AFTER_MS`). Tried twice with a timeout: a missed deletion is what
 * leaves stale data behind.
 */
export async function invalidate(...keys: string[]): Promise<void> {
  const named = names();
  if (!named || !keys.length) return;
  const tags = [...new Set(keys.map((key) => entryTag(named.prefix, key)))];
  noteInvalidated(tags, Date.now());
  const purge = purgeApi();
  if (!purge) return;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await Promise.race([deleteTags(tags, purge), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), INVALIDATE_TIMEOUT_MS))]);
      break;
    } catch (error) {
      if (attempt === 2) console.error(`[cache] invalidate ${keys.join(",")} failed; entries may stay stale until their TTL:`, error instanceof Error ? error.message : error);
    }
  }
  try {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, REDELETE_AFTER_MS));
      await deleteTags(tags, purge).catch((error) => warn(`invalidate ${keys.join(",")} (again)`, error));
    });
  } catch (error) {
    // Outside a request (nothing to come back to) or inside a cached function (which writes nothing).
    warn(`schedule invalidate ${keys.join(",")} (again)`, error);
  }
}

/** Every entry of this database, every version. After writing behind the app's back: a seed, a manual fix in SQL. */
export async function flushCache(): Promise<boolean> {
  const named = names();
  const purge = purgeApi();
  if (!named || !purge) return false;
  invalidatedAt.clear();
  await purge.dangerouslyDeleteByTag(named.all);
  return true;
}

/** Seconds until the next midnight in Vietnam, for entries that are only true for "today". */
export function secondsUntilVietnamMidnight(now: Date = new Date()): number {
  const vietnam = new Date(now.getTime() + 7 * 3600_000);
  const secondsIntoDay = vietnam.getUTCHours() * 3600 + vietnam.getUTCMinutes() * 60 + vietnam.getUTCSeconds();
  return Math.max(60, 86_400 - secondsIntoDay);
}
