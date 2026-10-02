import "server-only";
import type { PurgeApi } from "@vercel/functions";

// The purge half of the Vercel runtime's request context: the same context `@vercel/functions`
// reads for `dangerouslyDeleteByTag`, which resolves quietly to nothing where there is none. Asked
// for directly because the cache needs to know the difference: without a way to delete an entry
// (a developer's machine, `next start`, a script) it must not store one. The variables Vercel
// pulls into `.env.local` (VERCEL, VERCEL_ENV) say nothing about this; the context does.
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

type RequestContextHolder = { get?: () => { purge?: PurgeApi } | undefined };

export function purgeApi(): PurgeApi | undefined {
  return (globalThis as { [REQUEST_CONTEXT]?: RequestContextHolder })[REQUEST_CONTEXT]?.get?.()?.purge;
}
