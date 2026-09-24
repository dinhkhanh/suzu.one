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
});
