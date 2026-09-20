import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const database = drizzle(new PGlite({ extensions: { btree_gist } }), { schema });
  return { db: () => database, schema };
});

vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "@/lib/db";
import { runJob } from "./service";

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mocked db is a PGlite drizzle instance
  await migrate(db() as any, { migrationsFolder: "./drizzle" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

it("records what a job did, in its run row and in the audit log", async () => {
  const run = await runJob({ name: "count", run: async ({ today }) => ({ today, touched: 3 }) }, new Date("2026-03-01T17:05:00Z"));
  // 17:05 UTC is already the next day in Vietnam.
  expect(run).toMatchObject({ status: "succeeded", result: { today: "2026-03-02", touched: 3 } });
  const audit = await db().select().from(schema.auditLog);
  expect(audit.map((row) => row.action)).toContain("job.count");
});

it("records a failure instead of throwing", async () => {
  const run = await runJob({ name: "broken", run: async () => Promise.reject(new Error("boom")) });
  expect(run).toMatchObject({ status: "failed", error: "boom" });
});

it("does not start a job that is already running, but takes over from a run that died", async () => {
  const started = new Date("2026-03-01T00:00:00Z");
  await db().insert(schema.jobRun).values({ job: "slow", startedAt: started });

  expect(await runJob({ name: "slow", run: async () => ({}) }, new Date("2026-03-01T00:05:00Z"))).toBeNull();

  const takeover = await runJob({ name: "slow", run: async () => ({}) }, new Date("2026-03-01T00:20:00Z"));
  expect(takeover?.status).toBe("succeeded");
  const runs = await db().select().from(schema.jobRun);
  expect(runs.filter((row) => row.job === "slow").map((row) => row.error ?? row.status).sort()).toEqual(["succeeded", "timed_out"]);
});
