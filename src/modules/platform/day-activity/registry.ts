// The day's activity from other modules, for the end-of-day report's prefill (FR-PJM-22 "write
// once"; FR-CRM-43): the daily module reads work management's activity itself, and asks here for
// what other modules recorded of the person's day — the CRM's calls, meetings and deals moved —
// without importing them. Like the completion guards: no "server-only", no database import, a
// registry on `globalThis`, and each source's code loaded lazily when a report is first prefilled.

/** One line of the day: `kind` is the source's own ("client_activity"), `title` what the reader sees. */
export type DayActivity = { kind: string; title: string; detail: string | null; at: string };

/** `executor` is the caller's database (typed loosely: the platform's database types are not imported here). */
export type DayActivitySource = (executor: unknown, personId: string, date: string) => Promise<DayActivity[]>;

type Registry = Map<string, () => Promise<DayActivitySource>>;
const KEY = Symbol.for("suzu.day-activity.sources");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= new Map());

export function registerDayActivitySource(name: string, load: () => Promise<DayActivitySource>): void {
  registry().set(name, load);
}

/** Every source's lines for the person's day, in no particular order (the caller sorts). */
export async function dayActivities(executor: unknown, personId: string, date: string): Promise<DayActivity[]> {
  const sources = await Promise.all([...registry().values()].map((load) => load()));
  return (await Promise.all(sources.map((source) => source(executor, personId, date)))).flat();
}
