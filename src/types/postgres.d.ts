import postgres from "postgres";

// postgres.js reads `max_pipeline` at runtime (src/index.js, `ints` and `defaults`) but leaves it
// out of its type declarations. The app sets it to 0 (src/lib/db/index.ts) because Supabase's
// transaction pooler drops the reply of a pipelined query. The package is an `export =` module, so
// the augmentation names its namespace members directly; the type parameters must match the
// package's own to the letter, or the merge fails silently under `skipLibCheck`.
declare module "postgres" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the package's own parameters, repeated
  interface Options<T extends Record<string, postgres.PostgresType>> {
    /** Queries a connection may have in flight beyond the active one; 0 = never pipeline. */
    max_pipeline?: number | undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type -- likewise
  interface ParsedOptions<T extends Record<string, unknown> = {}> {
    max_pipeline: number;
  }
}
