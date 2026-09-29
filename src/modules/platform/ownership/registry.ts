// Ownership providers: what else a person owns, beyond work management, when they leave or move
// (the exit and transfer handover, FR-PJM-45). The handover is the work module's; the CRM's accounts,
// deals, leads and follow-ups (FR-CRM-40) are the CRM's. The work module cannot import the CRM —
// HR and PJM never depend on it — so a module registers a provider here and the handover lists,
// gates and reassigns the provider's items beside its own.
//
// Like the completion guards: no "server-only" and no database import; modules register at load
// time beside their tables, the provider's code loads lazily, and the registry sits on `globalThis`
// so the several copies of this module a server build may hold share one list.
import type { Principal } from "../rbac/policy";

/** One thing a person owns, as the handover page lists it. `kind` is the provider's own ("crm_deal"). */
export type ProvidedItem = { kind: string; id: string; label: string; context: string | null };

/**
 * What the person running a handover may do with an item: read its name, hand it on, and to whom
 * (`eligible` null = any active employee of the company).
 */
export type ProvidedGate = { visible: boolean; manage: boolean; ownerName: string | null; eligible: ReadonlySet<string> | null };

/** `executor` is the caller's database or transaction (typed loosely: the platform's database types are not imported here). */
export type OwnershipProvider = {
  kinds: readonly string[];
  list: (executor: unknown, personId: string) => Promise<ProvidedItem[]>;
  /** Keyed `${kind}:${id}`. An item missing from the map is closed to the runner. */
  gate: (executor: unknown, runner: { principal: Principal }, items: readonly ProvidedItem[]) => Promise<Map<string, ProvidedGate>>;
  /** Moves the items to `toPersonId` inside the caller's transaction; returns what to do once it commits (cache entries to drop). */
  reassign: (tx: unknown, items: readonly ProvidedItem[], fromPersonId: string, toPersonId: string, actorPersonId: string) => Promise<(() => Promise<void>) | void>;
};

type Registry = Map<string, () => Promise<OwnershipProvider>>;
const KEY = Symbol.for("suzu.ownership.providers");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= new Map());

/** Registers a provider under a name; a second registration of the name replaces the first. */
export function registerOwnershipProvider(name: string, load: () => Promise<OwnershipProvider>): void {
  registry().set(name, load);
}

/** Every registered provider, loaded. */
export async function ownershipProviders(): Promise<OwnershipProvider[]> {
  return Promise.all([...registry().values()].map((load) => load()));
}

export const providedKey = (item: { kind: string; id: string }): string => `${item.kind}:${item.id}`;
