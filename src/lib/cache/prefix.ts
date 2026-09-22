import { createHash } from "node:crypto";

/** Bump when the shape of a cached value changes, so old deployments' entries are never read. */
export const CACHE_VERSION = "v1";

/**
 * One Upstash database may serve a laptop, previews and production at once. Entries are scoped by
 * the Postgres database they were read from — user, host and database name, not the port, so a
 * pooled and a session connection agree. Deployments on the same database share entries (so a
 * write through any of them clears them for all); deployments on different ones never meet.
 */
export function cachePrefix(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const database = createHash("sha256").update(`${url.username}@${url.hostname}${url.pathname}`).digest("hex").slice(0, 10);
  return `suzu:${database}:${CACHE_VERSION}:`;
}
