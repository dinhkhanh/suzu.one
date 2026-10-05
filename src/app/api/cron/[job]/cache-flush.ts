// Empties this database's entries in the shared cache (src/lib/cache), on the deployment it is
// called on. The app clears what it changes itself; run this after writing behind its back — a
// seed, a manual fix in SQL — or the old values stay until their TTL runs out (at most an hour).
// `pnpm cache:flush` calls it.
import "server-only";
import { flushCache } from "@/lib/cache";
import type { JobDefinition } from "@/modules/platform/jobs/service";

export const cacheFlushJob: JobDefinition = {
  name: "cache-flush",
  run: async () => ({ flushed: await flushCache() }),
};
