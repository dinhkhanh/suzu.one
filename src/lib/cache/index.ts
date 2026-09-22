import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { decode, encode } from "./codec";
import { cachePrefix } from "./prefix";

// A shared read-through cache in front of Postgres (Upstash Redis). What may go in it: reference
// data (org tree, entities, types, policies, rates, calendars) and a person's role grants — never
// personal, restricted or compensation data, which stay in Postgres and are read per request.
//
// Every entry has a TTL as a backstop, and every write path that changes cached data calls
// `invalidate()` with the entry's key after its change is committed. Redis being slow or down is
// never an error: the read falls through to Postgres.

type Client = { redis: Redis; prefix: string } | null;
let client: Client | undefined;

function connect(): Client {
  const config = env();
  if (!config.KV_REST_API_URL || !config.KV_REST_API_TOKEN) return null;
  return {
    redis: new Redis({ url: config.KV_REST_API_URL, token: config.KV_REST_API_TOKEN, automaticDeserialization: false, enableTelemetry: false }),
    prefix: cachePrefix(config.DATABASE_URL),
  };
}

function redis(): Client {
  if (client !== undefined) return client;
  try {
    client = connect();
  } catch {
    // An environment without a database configured (unit tests) runs without the cache; a real
    // misconfiguration still fails loudly at the first query.
    client = null;
  }
  return client;
}

/** Long enough to cover a slow region hop, short enough that a Redis outage costs little. */
const TIMEOUT_MS = 400;

function withTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), TIMEOUT_MS))]);
}

function warn(operation: string, error: unknown) {
  console.warn(`[cache] ${operation} failed:`, error instanceof Error ? error.message : error);
}

/**
 * Returns the cached value under `key`, or runs `load`, stores its result for `ttlSeconds` and
 * returns it. `undefined` is never cached (use null for "known to be absent").
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const connection = redis();
  if (!connection) return load();
  const fullKey = connection.prefix + key;
  try {
    const hit = await withTimeout(connection.redis.get<string>(fullKey));
    if (typeof hit === "string") return decode<T>(hit);
  } catch (error) {
    warn(`get ${key}`, error);
  }
  const value = await load();
  if (value !== undefined) {
    connection.redis.set(fullKey, encode(value), { ex: ttlSeconds }).catch((error: unknown) => warn(`set ${key}`, error));
  }
  return value;
}

/** Drops entries after the data behind them changed. Call once the change is committed. */
export async function invalidate(...keys: string[]): Promise<void> {
  const connection = redis();
  if (!connection || !keys.length) return;
  try {
    await withTimeout(connection.redis.del(...keys.map((key) => connection.prefix + key)));
  } catch (error) {
    warn(`del ${keys.join(",")}`, error);
  }
}

/** Seconds until the next midnight in Vietnam, for entries that are only true for "today". */
export function secondsUntilVietnamMidnight(now: Date = new Date()): number {
  const vietnam = new Date(now.getTime() + 7 * 3600_000);
  const secondsIntoDay = vietnam.getUTCHours() * 3600 + vietnam.getUTCMinutes() * 60 + vietnam.getUTCSeconds();
  return Math.max(60, 86_400 - secondsIntoDay);
}
