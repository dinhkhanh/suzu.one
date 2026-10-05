// The service worker's static cache must not only grow (PERF-05): every deploy brings new hashed
// files. public/sw.js runs here in a sandbox with a cache store kept in memory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

class MemoryCache {
  entries = new Map<string, Response>();
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async match(request: Request | string) {
    return this.entries.get(typeof request === "string" ? new URL(request, "https://suzu.one").href : request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.entries.delete(request.url);
    this.entries.set(request.url, response);
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
  async addAll(paths: string[]) {
    for (const path of paths) await this.put(new Request(new URL(path, "https://suzu.one").href), new Response("shell", { headers: { date: new Date().toUTCString() } }));
  }
}

function worker() {
  const stores = new Map<string, MemoryCache>();
  const listeners = new Map<string, (event: unknown) => void>();
  const caches = {
    open: async (name: string) => stores.get(name) ?? stores.set(name, new MemoryCache()).get(name)!,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = { location: new URL("https://suzu.one/sw.js"), addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  runInNewContext(readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8"), { self, caches, URL, Date, Promise, Request, Response });
  const fire = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
  };
  return { stores, caches, fire };
}

const file = (index: number, daysAgo: number) => [new Request(`https://suzu.one/_next/static/chunks/${index}.js`), new Response("x", { headers: { date: new Date(Date.now() - daysAgo * 86_400_000).toUTCString() } })] as const;

describe("the service worker's cache", () => {
  it("drops files the server sent over a month ago, and the oldest past the limit, but keeps the shell", async () => {
    const { caches, fire } = worker();
    await fire("install");
    const cache = (await caches.open("suzu-static-v2")) as MemoryCache;
    await cache.put(...file(0, 45));
    for (let index = 1; index <= 410; index++) await cache.put(...file(index, 1));
    await fire("activate");

    const left = [...cache.entries.keys()].map((url) => new URL(url).pathname);
    expect(left).toContain("/offline.html");
    expect(left).toContain("/icons/icon-192.png");
    expect(left).not.toContain("/_next/static/chunks/0.js");
    // 410 recent files, a limit of 400: the ten filled first go.
    expect(left.filter((path) => path.startsWith("/_next/"))).toHaveLength(400);
    expect(left).not.toContain("/_next/static/chunks/10.js");
    expect(left).toContain("/_next/static/chunks/11.js");
  });

  it("still removes the caches of an older worker version", async () => {
    const { caches, stores, fire } = worker();
    await caches.open("suzu-static-v1");
    await fire("install");
    await fire("activate");
    expect([...stores.keys()]).toEqual(["suzu-static-v2"]);
  });
});
