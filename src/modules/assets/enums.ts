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

// ── Licences and subscriptions (FR-AST-05) ──────────────────────────────────────────────────

/** How often the bill comes round. `perpetual` never renews — it is tracked for the seat count. */
export const BILLING_CYCLES = ["monthly", "quarterly", "annual", "perpetual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Months between renewals; `perpetual` has none, which is why the map returns null for it. */
export const CYCLE_MONTHS: Record<BillingCycle, number | null> = { monthly: 1, quarterly: 3, annual: 12, perpetual: null };

export const LICENCE_STATUSES = ["active", "cancelled", "expired"] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

// ── Digital assets (FR-AST-07) ──────────────────────────────────────────────────────────────
// What the company owns or runs that has no shelf: a Facebook page, a TikTok or YouTube channel,
// an ad account, a website, the business accounts behind them. Nothing here is a credential — the
// register says where the login is kept, never what it is.

export const DIGITAL_KINDS = ["social_channel", "ad_account", "website", "business_account", "other"] as const;
export type DigitalKind = (typeof DIGITAL_KINDS)[number];

/** Where the thing lives. The names shared with the work module's channels are spelt the same. */
export const DIGITAL_PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "zalo", "linkedin", "threads", "x", "google", "website", "other"] as const;
export type DigitalPlatform = (typeof DIGITAL_PLATFORMS)[number];

/** Whose it is: the company's own, or a client's that the company runs for them. */
export const DIGITAL_OWNERSHIPS = ["company", "client"] as const;
export type DigitalOwnership = (typeof DIGITAL_OWNERSHIPS)[number];

/**
 * Who may see that the thing exists. `staff`: in the directory for everybody, and work can name it
 * as where its output goes. `restricted`: only its keepers and the people who hold access — the
 * bank portal, the tax account.
 */
export const DIGITAL_VISIBILITIES = ["staff", "restricted"] as const;
export type DigitalVisibility = (typeof DIGITAL_VISIBILITIES)[number];

export const DIGITAL_STATUSES = ["active", "paused", "retired"] as const;
export type DigitalStatus = (typeof DIGITAL_STATUSES)[number];

/** What a person may do on the platform, strongest first. The platforms' own names differ; these are the five every one of them has. */
export const ACCESS_LEVELS = ["admin", "editor", "moderator", "advertiser", "analyst"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * How the person gets in. `own_account`: their own profile was given a role, and taking the role
 * away ends it. `shared_login`: they know the account's password — revoking that is only true once
 * the password has been changed, which is why the register asks for it.
 */
export const ACCESS_METHODS = ["own_account", "shared_login"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];

/**
 * A grant's life. Somebody asks (`requested`) and the owner answers, or the owner grants straight
 * into `active`. `declined` and `revoked` are the two ends; a row is never deleted, so the table
 * is also the history of who could get in and when.
 */
export const ACCESS_STATUSES = ["requested", "active", "declined", "revoked"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/** The statuses that hold the (asset, person) pair: one open grant or request per person per asset. */
export const ACCESS_OPEN: readonly AccessStatus[] = ["requested", "active"];
