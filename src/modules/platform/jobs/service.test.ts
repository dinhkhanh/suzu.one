import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const database = drizzle(new PGlite({ extensions: { btree_gist, vector } }), { schema });
  return { db: () => database, schema };
});

vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { JOB_RUN_RETENTION_DAYS, pingSchedule, purgeJobRuns, runJob, runSchedule, STALE_AFTER_MINUTES, sweepTimedOutRuns } from "./service";

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
  expect(
    runs
      .filter((row) => row.job === "slow")
      .map((row) => row.error ?? row.status)
      .sort(),
  ).toEqual(["succeeded", "timed_out"]);
});

it("tells the owners when a run died with its server, once", async () => {
  const [owner] = await db().insert(schema.person).values({ fullName: "Chủ", searchName: "chu", status: "active" }).returning();
  await db().insert(schema.roleAssignment).values({ personId: owner.id, role: "owner", scopeType: "group", validFrom: "2020-01-01" });
  await db()
    .insert(schema.jobRun)
    .values({ job: "killed", startedAt: new Date("2026-04-01T00:00:00Z") });

  // Ten minutes in, it may still be working; at twenty it cannot be.
  expect(await sweepTimedOutRuns(new Date("2026-04-01T00:10:00Z"))).toHaveLength(0);
  expect((await sweepTimedOutRuns(new Date("2026-04-01T00:20:00Z"))).map((run) => run.job)).toEqual(["killed"]);
  expect(await sweepTimedOutRuns(new Date("2026-04-01T00:30:00Z"))).toHaveLength(0);

  const notices = await db().select().from(schema.notification).where(eq(schema.notification.kind, "system.job_timed_out"));
  expect(notices.map((row) => [row.recipientPersonId, row.params])).toEqual([[owner.id, { job: "killed", minutes: STALE_AFTER_MINUTES }]]);
});

it("runs a schedule in order until its time budget is spent, and says where to go on", async () => {
  const ran: string[] = [];
  const job = (name: string) => ({ name: `budget-${name}`, run: async () => (ran.push(name), {}) });
  const jobs = [job("a"), job("b"), job("c"), job("d")];
  // Each look at the clock is a minute later: a stand-in for jobs that take a minute each.
  let minutes = 0;
  const startedAt = new Date("2026-05-01T17:05:00Z");
  const clock = () => new Date(startedAt.getTime() + minutes++ * 60_000);

  const first = await runSchedule(jobs, 0, { startedAt, budgetSeconds: 150, clock });
  expect(first.outcomes.map((outcome) => [outcome.job, outcome.status])).toEqual([
    ["budget-a", "succeeded"],
    ["budget-b", "succeeded"],
  ]);
  expect(first.next).toBe(2);

  // The next invocation starts its own budget, and always runs at least one job.
  const rest = await runSchedule(jobs, 2, { startedAt: new Date(), budgetSeconds: 0 });
  expect(rest).toMatchObject({ next: 3 });
  expect(ran).toEqual(["a", "b", "c"]);
  expect(await runSchedule(jobs, 3, { startedAt: new Date() })).toMatchObject({ next: null });
  expect(ran).toEqual(["a", "b", "c", "d"]);
});

it("forgets finished runs after the retention period, never one still going", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date(now.getTime() - (JOB_RUN_RETENTION_DAYS + 1) * 86_400_000);
  await db()
    .insert(schema.jobRun)
    .values([
      { job: "retention-old", startedAt: old, status: "succeeded", finishedAt: old },
      { job: "retention-old-running", startedAt: old },
      { job: "retention-recent", startedAt: new Date(now.getTime() - 86_400_000), status: "failed", finishedAt: now },
    ]);
  expect(await purgeJobRuns(now)).toBe(1);
  const left = (await db().select({ job: schema.jobRun.job }).from(schema.jobRun)).map((row) => row.job);
  expect(left).toEqual(expect.arrayContaining(["retention-old-running", "retention-recent"]));
  expect(left).not.toContain("retention-old");
});

it("pings the dead-man's switch only when it has a URL, and never throws for it", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
  await pingSchedule(undefined, "midnight", "start");
  expect(fetch).not.toHaveBeenCalled();
  await pingSchedule("https://hc-ping.com/key/", "midnight", "start");
  await pingSchedule("https://hc-ping.com/key", "midnight", "success");
  await pingSchedule("https://hc-ping.com/key", "midnight", "fail");
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["https://hc-ping.com/key/midnight/start", "https://hc-ping.com/key/midnight", "https://hc-ping.com/key/midnight/fail"]);
  fetch.mockRejectedValue(new Error("offline"));
  await expect(pingSchedule("https://hc-ping.com/key", "morning", "success")).resolves.toBeUndefined();
  fetch.mockRestore();
});
