import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({ POSTGRES_URL: "postgresql://app:secret@pooler.example:6543/postgres", DATABASE_POOL_MAX: 10 }),
}));

import { db } from "./index";

// The client talks to Supabase's transaction pooler (Supavisor). Two options keep it from hanging
// there, and both have been lost once: `prepare: false` (a pooled backend cannot hold a named
// statement across transactions) and `max_pipeline: 0` (a query pipelined behind another on the
// same socket gets no answer once the pooler has handed the backend back — index.ts explains).
describe("db client options", () => {
  it("never prepares and never pipelines behind the transaction pooler", () => {
    const options = db().$client.options;
    expect(options.prepare).toBe(false);
    expect(options.max_pipeline).toBe(0);
  });

  // With pipelining off, stock postgres.js never calls a query's `onexecute` hook, and `sql.begin`
  // relies on that hook to claim its connection: every BEGIN then fails with UNSAFE_TRANSACTION
  // (all of production's writes did, 2026-09-24). patches/postgres@3.4.9.patch runs the hook
  // before the pipelining gate, in each of the package's three builds.
  it("runs postgres.js's onexecute hook before its pipelining gate (the patch is installed)", () => {
    // The package hides its package.json behind `exports`, so the installed copy is found by path.
    const root = join(process.cwd(), "node_modules", "postgres");
    for (const build of ["src", "cjs/src", "cf/src"]) {
      const source = readFileSync(join(root, build, "connection.js"), "utf8");
      const hook = source.indexOf("q.options.onexecute(connection)");
      const gate = source.indexOf("sent.length < max_pipeline");
      expect(hook, `${build}/connection.js has the hook`).toBeGreaterThan(0);
      expect(gate, `${build}/connection.js has the gate`).toBeGreaterThan(0);
      expect(hook, `${build}/connection.js runs the hook before the gate`).toBeLessThan(gate);
    }
  });
});
