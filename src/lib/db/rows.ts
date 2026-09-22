// `db().execute()` answers with an array of rows on postgres-js (the app) and with `{ rows }` on
// PGlite (the tests). Calls to database functions read their rows through this.
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
