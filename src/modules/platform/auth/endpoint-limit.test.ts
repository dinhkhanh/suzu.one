// The way in's rate limiter (NFR-SEC-03) against a real Postgres (PGlite): the arithmetic, the one
// upsert, and the wiring — Better Auth's per-instance limiter is off because this one is on, and
// the session ends after the idle timeout.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", allowedWorkspaceDomains: ["suzu.vn"], bootstrapOwnerEmails: [] }),
}));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { auth, IDLE_TIMEOUT_SECONDS, SESSION_REFRESH_SECONDS } from "./auth";
import { authLimitKey, countAuthHit, purgeAuthHits } from "./endpoint-limit";
import { AUTH_LIMITS, authBucketOf, retryAfterSeconds, windowStartFor } from "./rate-limit";

beforeAll(async () => {
  await migrateTestDb();
});

describe("which allowance a request spends", () => {
  it("counts starting a sign-in and Google's callback as signing in, everything else as session traffic", () => {
    expect(authBucketOf("/api/auth/sign-in/social")).toBe("sign_in");
    expect(authBucketOf("/api/auth/callback/google")).toBe("sign_in");
    expect(authBucketOf("/api/auth/get-session")).toBe("session");
    expect(authBucketOf("/api/auth/sign-out")).toBe("session");
    expect(authBucketOf("/api/auth/sign-inx")).toBe("session");
  });

  it("aligns windows to the clock, so every server counts into the same row", () => {
    const at = new Date("2026-10-05T01:02:34.500Z");
    expect(windowStartFor(at, 60).toISOString()).toBe("2026-10-05T01:02:00.000Z");
    expect(retryAfterSeconds(at, 60)).toBe(26);
  });
});

describe("countAuthHit", () => {
  it("lets a Monday morning of the office through and turns a script away until the window turns", async () => {
    const office = authLimitKey("ip", "203.0.113.7");
    const at = new Date("2026-10-05T01:00:10Z");
    for (let i = 0; i < AUTH_LIMITS.sign_in.max; i++) expect((await countAuthHit("sign_in", office, at)).ok).toBe(true);
    expect(await countAuthHit("sign_in", office, at)).toEqual({ ok: false, retryAfterSeconds: 50 });
    // Another address, and another bucket, count on their own.
    expect((await countAuthHit("sign_in", authLimitKey("ip", "198.51.100.1"), at)).ok).toBe(true);
    expect((await countAuthHit("session", office, at)).ok).toBe(true);
    // The next minute starts again.
    expect((await countAuthHit("sign_in", office, new Date("2026-10-05T01:01:00Z"))).ok).toBe(true);
  });

  it("names nobody in the table", async () => {
    const rows = await db().select({ keyHash: schema.authEndpointHit.keyHash }).from(schema.authEndpointHit);
    expect(rows.every((row) => /^[0-9a-f]{32}$/.test(row.keyHash))).toBe(true);
    expect(authLimitKey("ip", null)).toBe(authLimitKey("ip", null));
    expect(authLimitKey("ip", "1.2.3.4")).not.toBe(authLimitKey("session", "1.2.3.4"));
  });

  it("forgets windows nobody can still be inside", async () => {
    expect(await purgeAuthHits(new Date("2026-10-05T01:01:00Z"))).toBeGreaterThan(0);
    expect((await db().select().from(schema.authEndpointHit)).map((row) => row.windowStart.toISOString())).toEqual(["2026-10-05T01:01:00.000Z"]);
  });
});

describe("Better Auth's configuration", () => {
  it("ends a session after the idle timeout, pushes a used one forward hourly, and leaves limiting to the shared counter", () => {
    const options = auth().options;
    expect(options.session?.expiresIn).toBe(IDLE_TIMEOUT_SECONDS);
    expect(options.session?.updateAge).toBe(SESSION_REFRESH_SECONDS);
    expect(IDLE_TIMEOUT_SECONDS).toBeLessThan(7 * 24 * 60 * 60);
    expect(options.rateLimit?.enabled).toBe(false);
  });
});
