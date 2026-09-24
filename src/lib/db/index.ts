import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import { keptAlive } from "./keep-alive";
import * as schema from "./schema";

function create() {
  const client = postgres(env().DATABASE_URL, {
    // `prepare: false` keeps the client compatible with Supabase's transaction pooler.
    prepare: false,
    max: env().DATABASE_POOL_MAX,
    // A serverless instance is frozen between requests and its sockets go stale unnoticed. Close
    // what has sat idle, recycle what has lived long, and never wait half a minute on a connect.
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
  // And never freeze with a query in flight (see keep-alive.ts).
  return drizzle(keptAlive(client), { schema });
}

export type Db = ReturnType<typeof create>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __suzuDb?: Db };

// One pool per process; survives hot reloads in development.
export function db(): Db {
  return (globalForDb.__suzuDb ??= create());
}

export { schema };
