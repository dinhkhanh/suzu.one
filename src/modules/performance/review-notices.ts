// "Your review is open" and "you have reviews to write" (FR-PRF-03): told when a cycle is launched,
// when HR puts somebody in by hand, and when a probation is enrolled. The cycle's name and a
// deadline — never anything written, and never a rating.
//
// People who share a cycle and a deadline share one notice call; so do managers who owe the same
// number by the same day. A launch of a hundred people is a handful of calls, not a hundred.
import "server-only";
import type { IsoDate } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import type { Enrolled } from "./reviews";

type Executor = Tx | ReturnType<typeof db>;

/** ICU `select` needs a word, not an empty value, for "no deadline". */
const dateParam = (date: IsoDate | null): string => date ?? "none";

/** Group recipients by the parameters their notice carries, so each distinct notice is one call. */
export function byParams<P extends Record<string, string | number>>(entries: { recipient: string; params: P }[]): { recipients: string[]; params: P }[] {
  const groups = new Map<string, { recipients: string[]; params: P }>();
  for (const entry of entries) {
    const key = JSON.stringify(entry.params);
    const group = groups.get(key) ?? { recipients: [], params: entry.params };
    group.recipients.push(entry.recipient);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function sendOpenNotices(enrolled: readonly Enrolled[], executor: Executor = db()): Promise<{ people: number; managers: number }> {
  if (enrolled.length === 0) return { people: 0, managers: 0 };
  const people = byParams(enrolled.map((row) => ({ recipient: row.personId, params: { cycle: row.cycleName, date: dateParam(row.selfDueOn) } })));

  // One line per manager, cycle and deadline: how many reviews they owe by then.
  const owed = new Map<string, { recipient: string; params: { cycle: string; date: string; count: number } }>();
  for (const row of enrolled) {
    if (!row.managerPersonId) continue;
    const key = JSON.stringify([row.managerPersonId, row.cycleId, row.managerDueOn]);
    const entry = owed.get(key) ?? { recipient: row.managerPersonId, params: { cycle: row.cycleName, date: dateParam(row.managerDueOn), count: 0 } };
    entry.params.count += 1;
    owed.set(key, entry);
  }
  const managers = byParams([...owed.values()]);

  for (const group of people) await notify({ recipients: group.recipients, kind: "performance.review_open", params: group.params, link: "/performance/reviews" }, executor);
  for (const group of managers) await notify({ recipients: group.recipients, kind: "performance.reviews_owed", params: group.params, link: "/performance/reviews" }, executor);
  return { people: new Set(enrolled.map((row) => row.personId)).size, managers: new Set([...owed.values()].map((entry) => entry.recipient)).size };
}
