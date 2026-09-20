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
export const ASSET_EVENT_TYPES = [
  "acquired",
  "edited",
  "assigned",
  "handover_confirmed",
  "returned",
  "condition_changed",
  "repaired",
  "lost",
  "disposed",
  "imported",
  // Week 3: shared gear booked, taken off the shelf and brought back (FR-AST-03).
  "booked",
  "booking_cancelled",
  "checked_out",
  "checked_in",
] as const;
export type AssetEventType = (typeof ASSET_EVENT_TYPES)[number];

/**
 * A booking of shared production gear (FR-AST-03). Someone without `asset:manage` asks
 * (`requested`) and whoever keeps the gear confirms; someone who keeps it books straight into
 * `confirmed`. A booking is refused — never silently moved — when it overlaps one that already
 * holds the slot, and the four statuses that hold a slot are listed in `BOOKING_HOLDS_SLOT`,
 * which is the same list the database's exclusion constraint names (migration 0056).
 */
export const BOOKING_STATUSES = ["requested", "confirmed", "checked_out", "returned", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * The statuses that reserve the asset for their window. `returned` is deliberately *not* among
 * them: once the gear is back on the shelf the rest of the window is free, and a late check-in
 * must never be refused because the booking's own reservation is in the way. What actually
 * happened is kept apart, on `checked_out_at` / `checked_in_at`.
 */
export const BOOKING_HOLDS_SLOT: readonly BookingStatus[] = ["requested", "confirmed", "checked_out"];

/** A booking nobody can still act on. */
export const BOOKING_CLOSED: readonly BookingStatus[] = ["returned", "cancelled"];
