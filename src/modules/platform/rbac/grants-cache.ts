import "server-only";
import { invalidate } from "@/lib/cache";

// The cache entries built on `role_assignment`, in a file of their own so that a writer outside
// the RBAC service (the bootstrap owner in people/service.ts, which the service itself depends on
// through the org tree) can drop them without importing it.
//
// Two shapes of the same rows: a person's own grants, read on every request (`loadGrants`), and
// the whole table, for the questions asked of everybody — "who holds this role over this unit?"
// (`listPeopleWithRole`, `listPeopleHolding`, `listOwnerPersonIds`). The table is small reference
// data: one key, every writer drops it, and the short TTL bounds anything written behind the app's
// back (a seed, a manual fix).
export const GRANTS_TTL = 10 * 60;
export const grantsKey = (personId: string) => `rbac:grants:${personId}`;
export const ALL_GRANTS_KEY = "rbac:grants";

/** Drops the cached grants of these people and the table's entry; call after the change to `role_assignment` is committed. */
export const invalidateGrants = (...personIds: string[]) => invalidate(ALL_GRANTS_KEY, ...personIds.map(grantsKey));
