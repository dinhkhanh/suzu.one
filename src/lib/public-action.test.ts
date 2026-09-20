import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/db", () => import("../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));

const { db, schema, migrateTestDb } = await import("../../tests/helpers/db");
const { createPublicAction, visitorOf } = await import("./public-action");

beforeAll(async () => {
  await migrateTestDb();
});

const visitor = { ipHash: "deadbeefdeadbeef", userAgent: "probe/1.0" };

const auditRows = async (action: string) => (await db().select().from(schema.auditLog)).filter((row) => row.action.startsWith(action));

function actionUnder(name: string, overrides: Partial<Parameters<typeof createPublicAction>[0]> = {}) {
  const ran: unknown[] = [];
  const action = createPublicAction({
    name,
    input: z.object({ value: z.string().min(2) }),
    rateLimit: async () => ({ ok: true }),
    spamCheck: () => ({ verdict: "ok" }),
    dropped: () => ({ received: true }),
    run: async ({ input }) => {
      ran.push(input);
      return { data: { received: true }, audit: { resource: { type: "thing", id: "1", entityId: null }, summary: "ok" } };
    },
    ...overrides,
  } as Parameters<typeof createPublicAction>[0]);
  return { action, ran };
}

describe("visitorOf", () => {
  it("keys the address rather than keeping it — the same caller, a stable short hash, no address anywhere", () => {
    const one = visitorOf({ headers: new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) });
    const again = visitorOf({ headers: new Headers({ "x-forwarded-for": "203.0.113.9" }) });
    const other = visitorOf({ headers: new Headers({ "x-forwarded-for": "203.0.113.10" }) });
    expect(one.ipHash).toBe(again.ipHash);
    expect(one.ipHash).not.toBe(other.ipHash);
    expect(one.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(one)).not.toContain("203.0.113");
  });

  it("falls back to one shared bucket when nothing in front of the app sets a header", () => {
    expect(visitorOf({ headers: new Headers() }).ipHash).toBe(visitorOf({ headers: new Headers() }).ipHash);
  });

  it("keeps the user agent, capped", () => {
    expect(visitorOf({ headers: new Headers({ "user-agent": "x".repeat(500) }) }).userAgent).toHaveLength(300);
    expect(visitorOf({ headers: new Headers() }).userAgent).toBeNull();
  });
});

describe("the public pipeline", () => {
  it("runs, returns the data and writes one audit row with the hashed visitor and no person", async () => {
    const { action, ran } = actionUnder("test.ok");
    expect(await action({ value: "hello" }, visitor)).toEqual({ ok: true, data: { received: true } });
    expect(ran).toEqual([{ value: "hello" }]);
    const [row] = await auditRows("test.ok");
    expect(row.action).toBe("test.ok");
    expect(row.actorPersonId).toBeNull();
    expect(row.actorEmail).toBeNull();
    expect(row.ipAddress).toBe(visitor.ipHash);
  });

  it("refuses bad input without saying which field, and audits what was wrong", async () => {
    const { action, ran } = actionUnder("test.invalid");
    const result = await action({ value: "x" }, visitor);
    expect(result).toEqual({ ok: false, error: "invalid" });
    // The shape the caller sees has no `fieldErrors` at all: a public schema is not a map to hand out.
    expect(Object.keys(result)).toEqual(["ok", "error"]);
    expect(ran).toHaveLength(0);
    expect((await auditRows("test.invalid"))[0].summary).toContain("value:");
  });

  it("stops at the rate limit before the run and before anything is read", async () => {
    const { action, ran } = actionUnder("test.limited", { rateLimit: async () => ({ ok: false, retryAfterSeconds: 900 }) });
    expect(await action({ value: "hello" }, visitor)).toEqual({ ok: false, error: "rate_limited", message: "rate_limited" });
    expect(ran).toHaveLength(0);
    expect((await auditRows("test.limited"))[0].after).toEqual({ retryAfterSeconds: 900 });
  });

  it("answers a dropped submission exactly like a successful one, and writes nothing", async () => {
    const { action, ran } = actionUnder("test.dropped", { spamCheck: () => ({ verdict: "drop", reason: "honeypot" }) });
    const { action: ok } = actionUnder("test.dropped_ok");
    expect(await action({ value: "hello" }, visitor)).toEqual(await ok({ value: "hello" }, visitor));
    expect(ran).toHaveLength(0);
    expect((await auditRows("test.dropped"))[0].summary).toBe("honeypot");
  });

  it("refuses out loud when the reason is one a person can act on", async () => {
    const { action, ran } = actionUnder("test.refused", { spamCheck: () => ({ verdict: "refuse", reason: "careers_form_expired" }) });
    expect(await action({ value: "hello" }, visitor)).toEqual({ ok: false, error: "rejected", message: "careers_form_expired" });
    expect(ran).toHaveLength(0);
  });

  it("never lets an exception reach the caller — one word, and the detail stays in the log", async () => {
    const { action } = actionUnder("test.threw", {
      run: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:54322 while selecting candidate 8f2c…");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await action({ value: "hello" }, visitor);
    error.mockRestore();
    expect(result).toEqual({ ok: false, error: "failed", message: "failed" });
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    expect((await auditRows("test.threw"))[0].action).toBe("test.threw.failed");
  });

  it("passes an expected refusal on as a message key, and drops the details it was carrying", async () => {
    const { ActionError } = await import("./action");
    const { action } = actionUnder("test.expected", {
      run: async () => {
        throw new ActionError("careers_opening_closed", { duplicates: [{ id: "8f2c…", fullName: "Trần Thị Mai" }] });
      },
    });
    const result = await action({ value: "hello" }, visitor);
    expect(result).toEqual({ ok: false, error: "failed", message: "careers_opening_closed" });
    // `details` is where a leak would live — inside the app it carries candidate records.
    expect(JSON.stringify(result)).not.toContain("Mai");
    expect((await auditRows("test.expected"))[0].action).toBe("test.expected.refused");
  });

  it("checks in order: parse, then limit, then spam — a malformed probe never even counts", async () => {
    const calls: string[] = [];
    const { action } = actionUnder("test.order", {
      rateLimit: async () => {
        calls.push("limit");
        return { ok: true };
      },
      spamCheck: () => {
        calls.push("spam");
        return { verdict: "ok" };
      },
    });
    await action({ value: "x" }, visitor);
    expect(calls).toEqual([]);
    await action({ value: "hello" }, visitor);
    expect(calls).toEqual(["limit", "spam"]);
  });
});
