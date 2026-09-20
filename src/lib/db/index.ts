import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

function create() {
  // `prepare: false` keeps the client compatible with Supabase's transaction pooler.
  const client = postgres(env().DATABASE_URL, { prepare: false, max: env().DATABASE_POOL_MAX });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof create>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __suzuDb?: Db };

// One pool per process; survives hot reloads in development.
export function db(): Db {
  return (globalForDb.__suzuDb ??= create());
}

export { schema };
