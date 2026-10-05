// The service worker's static cache stays bounded (PERF-05): every deploy brings new hashed files
// and the old ones are never asked for again, so without a limit the cache only ever grows. The
// worker runs here in a sandbox with a Cache Storage held in memory, and is driven through its own
// event listeners.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const LIMIT = Number(/const STATIC_LIMIT = (\d+);/.exec(SOURCE)?.[1]);

/** A Cache Storage in memory: each cache keeps its requests in the order they were stored, as the real one does. */
function memoryCaches(initial: Record<string, string[]> = {}) {
  const stores = new Map<string, Map<string, Response>>(Object.entries(initial).map(([name, urls]) => [name, new Map(urls.map((url) => [url, new Response(url)]))]));
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (request: Request | string) => store.get(typeof request === "string" ? request : request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        store.delete(request.url);
        store.set(request.url, response);
      },
      addAll: async (urls: string[]) => urls.forEach((url) => store.set(url, new Response(url))),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => store.delete(request.url),
    };
  };
  return {
    stores,
    api: {
      open: async (name: string) => open(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (request: string) => {
        for (const name of stores.keys()) {
          const hit = await open(name).match(request);
          if (hit) return hit;
        }
      },
    },
  };
}

/** Loads the worker into a sandbox and returns a way to dispatch its events and wait for them. */
function loadWorker(caches: ReturnType<typeof memoryCaches>) {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL("https://suzu.one/sw.js"),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(SOURCE, { self, caches: caches.api, fetch: async () => Object.defineProperty(new Response("body"), "type", { value: "basic" }), URL, Response, Request, Promise, Math });
  return async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    const event = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), respondWith: (promise: Promise<unknown>) => pending.push(promise), ...extra };
    listeners.get(type)!(event);
    // A promise handed over may hand over more (the fetch handler stores, then prunes).
    for (let index = 0; index < pending.length; index++) await pending[index];
  };
}

const chunk = (index: number) => new Request(`https://suzu.one/_next/static/chunks/${index}.js`);

describe("service worker", () => {
  it("keeps only the most recent static files, dropping the oldest first", async () => {
    expect(LIMIT).toBeGreaterThan(0);
    const caches = memoryCaches();
    const dispatch = loadWorker(caches);
    await dispatch("install");
    for (let index = 0; index < LIMIT + 25; index++) await dispatch("fetch", { request: chunk(index) });

    const stored = [...caches.stores.get("suzu-static-v3")!.keys()];
    expect(stored).toHaveLength(LIMIT);
    expect(stored[0]).toBe(chunk(25).url);
    expect(stored.at(-1)).toBe(chunk(LIMIT + 24).url);
    // The offline page lives apart and is never pruned.
    expect([...caches.stores.get("suzu-shell-v3")!.keys()]).toEqual(["/offline.html", "/icons/icon-192.png"]);
  });

  it("drops the unbounded cache an earlier worker gathered when it takes over", async () => {
    const caches = memoryCaches({ "suzu-static-v2": Array.from({ length: 900 }, (_, index) => chunk(index).url), "other-app": ["x"] });
    const dispatch = loadWorker(caches);
    await dispatch("install");
    await dispatch("activate");
    expect([...caches.stores.keys()].sort()).toEqual(["other-app", "suzu-shell-v3"]);
  });

  it("still never stores a page", async () => {
    const caches = memoryCaches();
    const dispatch = loadWorker(caches);
    await dispatch("fetch", { request: Object.defineProperty(new Request("https://suzu.one/today"), "mode", { value: "navigate" }) });
    expect(caches.stores.has("suzu-static-v3")).toBe(false);
  });
});
