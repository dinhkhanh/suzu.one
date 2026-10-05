import { createHash } from "node:crypto";

/** Bump when the shape of a cached value changes, so old deployments' entries are never read. */
export const CACHE_VERSION = "v1";

/**
 * On Hobby and Pro plans one Vercel Data Cache serves every project of the team (split only into
 * production and preview). Entries are scoped by the Postgres database they were read from — user,
 * host and database name, not the port, so a pooled and a session connection agree. Deployments of
 * one environment on the same database share entries, so a write through any of them clears them
 * for all. Production and preview never share a cache: a write made through a preview deployment
 * on the production database does not clear production's entries (their TTL does).
 */
export function cacheScopeTag(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const database = createHash("sha256").update(`${url.username}@${url.hostname}${url.pathname}`).digest("hex").slice(0, 10);
  return `suzu:${database}`;
}

/** The start of every entry's key (and tag) of this database and cache version. */
export function cachePrefix(databaseUrl: string): string {
  return `${cacheScopeTag(databaseUrl)}:${CACHE_VERSION}:`;
}
