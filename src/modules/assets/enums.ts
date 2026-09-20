// Value lists of the asset register. Plain module: shared by the server, the forms and the seed.
// (Constants exported from a `"use client"` file become client references on the server, so shared
// lists live here — the same lesson `src/modules/core-hr/enums.ts` records.)

// What kind of thing it is. Drives nothing in the engine; it groups the register and decides which
// categories the production team may book (Phase 6 week 3).
export const ASSET_KINDS = ["it_equipment", "production_gear", "furniture", "vehicle", "phone_sim", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** How the thing is: recorded when it is handed over and when it comes back. */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "broken"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

/**
 * Where the thing is in its life. `assigned` is the one status the register does not set by hand:
 * it follows from there being an open assignment, and the two are kept in step in one transaction.
 */
export const ASSET_STATUSES = ["in_stock", "assigned", "in_repair", "lost", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** A status nobody can assign from: the thing is not there to hand over. */
export const UNASSIGNABLE_STATUSES: readonly AssetStatus[] = ["lost", "disposed"];

/** Who holds it. A camera can belong to a team's shelf and a printer to an office, not only to a person. */
export const HOLDER_TYPES = ["person", "team", "entity"] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

/** The history of one asset, append-only. */
export const ASSET_EVENT_TYPES = ["acquired", "edited", "assigned", "handover_confirmed", "returned", "condition_changed", "repaired", "lost", "disposed", "imported"] as const;
export type AssetEventType = (typeof ASSET_EVENT_TYPES)[number];
