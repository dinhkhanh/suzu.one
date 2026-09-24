import { waitUntil } from "@vercel/functions";
import type { Sql, TransactionSql } from "postgres";

// Vercel freezes a function instance the moment its response is finished — and a response is
// finished with queries still in flight more often than it looks: a `Promise.all` whose first
// member throws (`notFound()`, a denied read), a `.rsc` prefetch the browser abandoned, a render
// that redirected. postgres.js keeps its sockets open across the freeze, so behind the pooler a
// Postgres backend sits in an open transaction waiting for the rest of a conversation that will
// not continue, pinned to our silent socket until TCP gives up on it (minutes). A handful of
// those and the pooler has no backend left to hand out; from then on every query from every
// instance waits in its queue until the 300-second function timeout, on pages that run nothing
// heavier than `select … from session where token = $1`.
//
// (The September 2026 timeouts that this was written for turned out to have a second, larger cause:
// the pooler dropping the reply of a pipelined query — `max_pipeline: 0` in index.ts. The freeze
// remains a real way to lose a backend, so this stays.)
//
// So: never freeze mid-query. Each query is registered with the runtime's `waitUntil` at the
// moment postgres.js sends it, which keeps the instance awake until the query has an answer,
// however the response ended. Off Vercel (development, tests, scripts) `waitUntil` is a no-op.

type Lazy = { handler: (query: Lazy) => unknown; then: Promise<unknown>["then"] };

const settled = () => undefined;

/**
 * postgres.js runs a query lazily, through its `handler`, the first time it is awaited. That is
 * the moment the socket becomes busy, and the moment the runtime is told to wait for it.
 */
function settleBeforeFreeze<T>(query: T): T {
  const lazy = query as unknown as Partial<Lazy>;
  const send = lazy.handler;
  if (typeof send !== "function") return query;
  lazy.handler = (pending) => {
    // `then` on an executing query only attaches; it does not send it a second time.
    waitUntil(pending.then(settled, settled));
    return send(pending);
  };
  return query;
}

type Callback = (client: TransactionSql) => unknown;

/** The client with every query, transaction and savepoint it issues kept alive until it settles. */
export function keptAlive<T extends Sql | TransactionSql>(client: T): T {
  return new Proxy(client, {
    // The tagged-template form: sql`select …`.
    apply: (target, self, args) => settleBeforeFreeze(Reflect.apply(target as unknown as (...input: unknown[]) => unknown, self, args)),
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      // Drizzle's own path: `client.unsafe(query, params)`, then `.values()` and `await`.
      if (property === "unsafe") return (...args: unknown[]) => settleBeforeFreeze(value.apply(target, args));
      // `begin`/`savepoint` wrap their body's client the same way, and the transaction as a whole
      // (its `begin`, `commit` and `rollback` are postgres.js's own statements) is waited for too.
      if (property === "begin" || property === "savepoint") {
        return (...args: unknown[]) => {
          const callback = args.at(-1) as Callback;
          const transaction = value.apply(target, [...args.slice(0, -1), (inner: TransactionSql) => callback(keptAlive(inner))]) as Promise<unknown>;
          waitUntil(transaction.then(settled, settled));
          return transaction;
        };
      }
      return value;
    },
  });
}
