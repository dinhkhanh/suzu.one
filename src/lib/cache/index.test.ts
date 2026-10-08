import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Data Cache: `unstable_cache` over a Map that keeps what Next keeps (the
// result as JSON, its tags), and Vercel's purge API deleting from it by tag.
const fake = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  const scope = new AsyncLocalStorage<string>();
  const store = new Map<string, { body: string; tags: string[] }>();
  const purgeCalls: string[][] = [];
  const afterCallbacks: (() => Promise<void>)[] = [];
  const state = { onVercel: true, dataCache: undefined as string | undefined, failCache: false };
  const purge = {
    dangerouslyDeleteByTag: vi.fn(async (tag: string | string[]) => {
      const tags = Array.isArray(tag) ? tag : [tag];
      purgeCalls.push(tags);
      for (const [key, entry] of store) if (entry.tags.some((t) => tags.includes(t))) store.delete(key);
    }),
  };
  return { scope, store, purgeCalls, afterCallbacks, state, purge };
});

vi.mock("next/cache", () => ({
  unstable_cache: (load: () => Promise<unknown>, keyParts: string[], options: { tags: string[] }) => async () => {
    if (fake.state.failCache) throw new Error("Invariant: incrementalCache missing in unstable_cache");
    const key = keyParts.join(",");
    const hit = fake.store.get(key);
    if (hit) return JSON.parse(hit.body);
    const result = await fake.scope.run("unstable-cache", load);
    fake.store.set(key, { body: JSON.stringify(result), tags: options.tags });
    return result;
  },
}));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => fake.afterCallbacks.push(callback) }));
vi.mock("./vercel", () => ({ purgeApi: () => (fake.state.onVercel ? fake.purge : undefined) }));
vi.mock("@/lib/env", () => ({ env: () => ({ POSTGRES_URL: "postgres://app@db.example.com:6543/postgres", DATA_CACHE: fake.state.dataCache }) }));

async function cache() {
  vi.resetModules();
  return import("./index");
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-02T03:00:00Z") });
  fake.store.clear();
  fake.purgeCalls.length = 0;
  fake.afterCallbacks.length = 0;
  Object.assign(fake.state, { onVercel: true, dataCache: undefined, failCache: false });
  (globalThis as { [key: symbol]: Map<string, number> | undefined })[Symbol.for("suzu.cache.invalidatedAt")]?.clear();
});
afterEach(() => vi.useRealTimers());

describe("cached", () => {
  it("reads Postgres once, then the cache, with Dates intact", async () => {
    const { cached } = await cache();
    const load = vi.fn(async () => ({ at: new Date("2026-10-01T00:00:00Z"), name: "Kế toán" }));
    const first = await cached("ref:teams", 3600, load);
    const second = await cached("ref:teams", 3600, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.at).toBeInstanceOf(Date);
  });

  it("stores nothing outside a Vercel function, or when turned off", async () => {
    for (const state of [{ onVercel: false }, { dataCache: "off" }]) {
      Object.assign(fake.state, { onVercel: true, dataCache: undefined }, state);
      const { cached } = await cache();
      const load = vi.fn(async () => 1);
      await cached("ref:teams", 3600, load);
      await cached("ref:teams", 3600, load);
      expect(load).toHaveBeenCalledTimes(2);
      expect(fake.store.size).toBe(0);
    }
  });

  it("never serves an entry past its TTL", async () => {
    const { cached } = await cache();
    const load = vi.fn(async () => "value");
    await cached("live:p1:shell", 60, load);
    vi.advanceTimersByTime(61_000);
    await cached("live:p1:shell", 60, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("runs the loader in the caller's context, not the cache's", async () => {
    const { cached } = await cache();
    const seen = await fake.scope.run("request", () => cached("ref:teams", 3600, async () => fake.scope.getStore()));
    expect(seen).toBe("request");
  });

  it("passes the loader's error on without running it twice", async () => {
    const { cached } = await cache();
    const load = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(cached("ref:teams", 3600, load)).rejects.toThrow("db down");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("falls through to Postgres when the cache itself fails", async () => {
    const { cached } = await cache();
    fake.state.failCache = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(cached("ref:teams", 3600, async () => "rows")).resolves.toBe("rows");
  });
});

describe("invalidate", () => {
  it("deletes the entry by its tag, and this instance reads Postgres for a while", async () => {
    const { cached, invalidate } = await cache();
    let version = 1;
    const load = vi.fn(async () => version);
    await cached("ref:teams", 3600, load);
    version = 2;
    await invalidate("ref:teams");
    expect(fake.purgeCalls).toEqual([[expect.stringMatching(/^suzu:[0-9a-f]{10}:v1:ref:teams$/)]]);
    expect(fake.store.size).toBe(0);

    // Within the window nothing is stored, even by a read that began before the commit.
    await expect(cached("ref:teams", 3600, load)).resolves.toBe(2);
    expect(fake.store.size).toBe(0);
    vi.advanceTimersByTime(31_000);
    await expect(cached("ref:teams", 3600, load)).resolves.toBe(2);
    expect(fake.store.size).toBe(1);
  });

  it("refuses an entry another instance read before this instance's change", async () => {
    const { cached, invalidate } = await cache();
    const load = vi.fn(async () => "new");
    // Another instance began its read before the change below, and stored it after the deletion.
    await cached("ref:teams", 3600, async () => "old");
    const [key, entry] = [...fake.store][0];
    vi.advanceTimersByTime(1_000);
    await invalidate("ref:teams");
    fake.store.set(key, entry);
    vi.advanceTimersByTime(31_000);
    await expect(cached("ref:teams", 3600, load)).resolves.toBe("new");
  });

  it("deletes sixteen tags per call, and everything once more after the response", async () => {
    const { invalidate } = await cache();
    const keys = Array.from({ length: 20 }, (_, index) => `live:p${index}:shell`);
    await invalidate(...keys, keys[0]);
    expect(fake.purgeCalls.map((tags) => tags.length)).toEqual([16, 4]);
    expect(fake.afterCallbacks).toHaveLength(1);

    const again = fake.afterCallbacks[0]();
    await vi.advanceTimersByTimeAsync(3_000);
    await again;
    expect(fake.purgeCalls.map((tags) => tags.length)).toEqual([16, 4, 16, 4]);
  });

  it("does nothing outside a Vercel function but remember the change", async () => {
    fake.state.onVercel = false;
    const { invalidate } = await cache();
    await invalidate("ref:teams");
    expect(fake.purgeCalls).toHaveLength(0);
    expect(fake.afterCallbacks).toHaveLength(0);
  });
});

describe("entryTag", () => {
  it("is the key where Vercel takes it as one tag, a hash where it would not", async () => {
    const { entryTag } = await cache();
    expect(entryTag("suzu:abc:v1:", "auth:session:0f")).toBe("suzu:abc:v1:auth:session:0f");
    expect(entryTag("suzu:abc:v1:", "person:email:a,b@x.vn")).toMatch(/^suzu:abc:v1:#[0-9a-f]{64}$/);
    expect(entryTag("suzu:abc:v1:", "x".repeat(300))).toMatch(/^suzu:abc:v1:#[0-9a-f]{64}$/);
    expect(entryTag("suzu:abc:v1:", "tên")).toMatch(/^suzu:abc:v1:#/);
  });
});

describe("flushCache", () => {
  it("deletes every entry of this database by its scope tag", async () => {
    const { cached, flushCache } = await cache();
    await cached("ref:teams", 3600, async () => 1);
    await cached("live:p1:shell", 60, async () => 2);
    await expect(flushCache()).resolves.toBe(true);
    expect(fake.purgeCalls).toEqual([[expect.stringMatching(/^suzu:[0-9a-f]{10}$/)]]);
    expect(fake.store.size).toBe(0);
  });
});

it("counts down to midnight in Vietnam (UTC+7), never below a minute", async () => {
  const { secondsUntilVietnamMidnight } = await cache();
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T17:00:00Z"))).toBe(86_400);
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T16:00:00Z"))).toBe(3_600);
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T16:59:59Z"))).toBe(60);
});
