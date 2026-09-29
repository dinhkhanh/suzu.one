// Office networks named by DNS (FR-ATT-04). An office on a dynamic public address has its router
// publish the address under a name (DDNS); the allowlist carries the name and a check-in resolves
// it. The answer is never stored in Postgres or the shared cache: the address may change any
// minute, and a stale one would let the wrong network through.
import "server-only";
import { Resolver } from "node:dns/promises";

/** A check-in waits at most this long for an answer; no answer = the name matches nothing. */
const TIMEOUT_MS = 1_500;
/** An answer is reused on this server for its DNS TTL, but never longer than this. */
const MAX_REUSE_SECONDS = 30;

const answers = new Map<string, { addresses: string[]; until: number }>();

async function lookup(name: string, now: number): Promise<string[]> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(name, { ttl: true }), resolver.resolve6(name, { ttl: true })]);
  const records = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])];
  const addresses = records.map((record) => record.address);
  // A failed lookup is not remembered: the next check-in asks again.
  if (addresses.length) answers.set(name, { addresses, until: now + Math.min(MAX_REUSE_SECONDS, ...records.map((record) => record.ttl)) * 1000 });
  return addresses;
}

/** The addresses each name points to now (A and AAAA records). A name that did not resolve maps to []. */
export async function resolveNetworkNames(names: readonly string[], now: number = Date.now()): Promise<Map<string, string[]>> {
  const entries = await Promise.all(
    names.map(async (name): Promise<[string, string[]]> => {
      const answer = answers.get(name);
      return [name, answer && answer.until > now ? answer.addresses : await lookup(name, now)];
    }),
  );
  return new Map(entries);
}
