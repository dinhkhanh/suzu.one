import type { Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keptAlive } from "./keep-alive";

// What @vercel/functions' waitUntil looks for on the runtime.
const CONTEXT = Symbol.for("@vercel/request-context");
const runtime = globalThis as unknown as Record<symbol, unknown>;

let kept: Promise<unknown>[];

beforeEach(() => {
  kept = [];
  runtime[CONTEXT] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => kept.push(promise) }) };
});

afterEach(() => {
  delete runtime[CONTEXT];
});

// A stand-in for postgres.js's Query: nothing is sent until the first `then`, sending goes through
// `handler`, and `.values()` returns the query itself (Drizzle's path).
class FakeQuery extends Promise<string> {
  static get [Symbol.species]() {
    return Promise;
  }

  handler: (query: FakeQuery) => void;
  settle: (value: string) => void;
  executed = false;

  constructor(handler: (query: FakeQuery) => void) {
    let settle!: (value: string) => void;
    super((resolve) => {
      settle = resolve;
    });
    this.settle = settle;
    this.handler = handler;
  }

  then<A = string, B = never>(onFulfilled?: ((value: string) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    if (!this.executed) {
      this.executed = true;
      queueMicrotask(() => this.handler(this));
    }
    return super.then(onFulfilled, onRejected);
  }

  values() {
    return this;
  }
}

function fakeClient(sent: string[]): Sql {
  const client = (() => new FakeQuery((query) => query.settle(sent[sent.push("tagged") - 1]))) as unknown as Sql;
  return Object.assign(client, {
    unsafe: (text: string) => new FakeQuery((query) => query.settle(sent[sent.push(text) - 1])),
    begin: async (callback: (client: Sql) => Promise<unknown>) => {
      sent.push("begin");
      const result = await callback(fakeClient(sent));
      sent.push("commit");
      return result;
    },
  });
}

describe("keptAlive", () => {
  it("keeps the instance awake from the moment a query is sent until it settles", async () => {
    const sent: string[] = [];
    const query = keptAlive(fakeClient(sent)).unsafe("select 1").values();
    expect(kept).toHaveLength(0);

    await expect(query).resolves.toBe("select 1");
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toBeUndefined();
    expect(sent).toEqual(["select 1"]);
  });

  it("registers nothing for a query that is never sent", () => {
    keptAlive(fakeClient([])).unsafe("select 2");
    expect(kept).toHaveLength(0);
  });

  it("waits for a transaction as a whole and for each query inside it", async () => {
    const sent: string[] = [];
    const result = await keptAlive(fakeClient(sent)).begin(async (tx) => {
      await tx.unsafe("insert");
      return 42;
    });
    expect(result).toBe(42);
    expect(sent).toEqual(["begin", "insert", "commit"]);
    expect(kept).toHaveLength(2);
    await expect(Promise.all(kept)).resolves.toEqual([undefined, undefined]);
  });

  it("covers the tagged-template form too", async () => {
    const sent: string[] = [];
    const sql = keptAlive(fakeClient(sent));
    await expect(sql`select 3`).resolves.toBe("tagged");
    expect(kept).toHaveLength(1);
  });

  it("is a no-op off Vercel", async () => {
    delete runtime[CONTEXT];
    const sent: string[] = [];
    await expect(keptAlive(fakeClient(sent)).unsafe("select 4")).resolves.toBe("select 4");
    expect(kept).toHaveLength(0);
  });
});
