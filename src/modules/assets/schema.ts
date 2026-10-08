// The asset register (FR-AST-01, 02). An asset belongs to a legal entity and is held by at most
// one person, team or office at a time; every handover and return is a row of its own, and the
// whole history of the thing is an append-only event log. Value lists are in enums.ts.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entity, orgUnit } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type {
  AccessLevel,
  AccessMethod,
  AccessStatus,
  AssetCondition,
  AssetEventType,
  AssetKind,
  AssetStatus,
  BillingCycle,
  BookingStatus,
  DigitalKind,
  DigitalOwnership,
  DigitalPlatform,
  DigitalStatus,
  DigitalVisibility,
  HolderType,
  LicenceStatus,
} from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// Shared by the group: a category is what a thing *is*, and a laptop is a laptop in every entity.
export const assetCategory = pgTable(
  "asset_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").$type<AssetKind>().notNull(),
    // A serial number is what tells two identical cameras apart; furniture has none.
    requiresSerial: boolean("requires_serial").notNull().default(false),
    // Suggested when an asset of this category is registered; the asset keeps its own date.
    defaultWarrantyMonths: integer("default_warranty_months"),
    // Shared production gear that people book rather than keep (week 3's calendar).
    bookable: boolean("bookable").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("asset_category_kind_idx").on(t.kind, t.sortOrder)],
).enableRLS();

export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What is written on the label: SZM-LAP-0007. Unique across the group, so a code scanned
    // anywhere means one thing.
    code: text("code").notNull().unique(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => assetCategory.id),
    name: text("name").notNull(),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    // The thing is bought by a company and sits on that company's books (CLAUDE.md: tables carry
    // `entity_id` where the data belongs to a legal entity).
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    purchaseDate: date("purchase_date"),
    // Integer VND. Not compensation, but not public either — `assets.policy.ts` keeps it to the
    // people who may read the register's money (restricted tier).
    purchasePrice: bigint("purchase_price", { mode: "number" }),
    supplier: text("supplier"),
    warrantyUntil: date("warranty_until"),
    condition: text("condition").$type<AssetCondition>().notNull().default("good"),
    status: text("status").$type<AssetStatus>().notNull().default("in_stock"),
    // Where it lives when nobody is holding it: "Kho tầng 3", "Studio A".
    location: text("location"),
    notes: text("notes"),
    photoFileId: uuid("photo_file_id"),
    // What the QR label carries. Opaque and unguessable, but not a credential: the session still
    // decides who may open the asset it names.
    qrToken: text("qr_token").notNull().unique(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("asset_entity_idx").on(t.entityId, t.status), index("asset_category_idx").on(t.categoryId), index("asset_serial_idx").on(t.serial)],
).enableRLS();

// One spell of someone holding something. Open while `returned_at` is null.
export const assetAssignment = pgTable(
  "asset_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    holderType: text("holder_type").$type<HolderType>().notNull(),
    holderPersonId: uuid("holder_person_id").references(() => person.id),
    holderTeamId: uuid("holder_team_id").references(() => orgUnit.id),
    holderEntityId: uuid("holder_entity_id").references(() => entity.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByPersonId: uuid("assigned_by_person_id").references(() => person.id),
    // When the thing is lent rather than given: the day it is expected back.
    dueBack: date("due_back"),
    purpose: text("purpose"),
    conditionOut: text("condition_out").$type<AssetCondition>().notNull(),
    // Chargers, cases, lenses — what went out with it, so what comes back is checked against it.
    accessories: jsonb("accessories").$type<string[]>().notNull().default([]),
    // The holder's own confirmation that they received it (FR-AST-02: digital handover).
    handoverConfirmedAt: timestamp("handover_confirmed_at", { withTimezone: true }),
    handoverNote: text("handover_note"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedToPersonId: uuid("returned_to_person_id").references(() => person.id),
    conditionIn: text("condition_in").$type<AssetCondition>(),
    returnNote: text("return_note"),
    ...timestamps,
  },
  (t) => [
    // One thing, one holder. Two people cannot both have the camera, and the database says so
    // rather than the code remembering to check.
    uniqueIndex("asset_assignment_open_key")
      .on(t.assetId)
      .where(sql`${t.returnedAt} is null`),
    index("asset_assignment_holder_idx").on(t.holderPersonId, t.returnedAt),
    index("asset_assignment_asset_idx").on(t.assetId, t.assignedAt),
  ],
).enableRLS();

// A spell of shared production gear reserved for somebody (FR-AST-03). Two bookings of one thing
// never overlap, and it is the database that says so: migration 0056 adds
//   EXCLUDE USING gist (asset_id WITH =, tstzrange(start_at, end_at) WITH &&)
//     WHERE (status in ('requested', 'confirmed', 'checked_out'))
// which drizzle-kit cannot express, so it is hand-written there beside the other exclusion
// constraints (0005, 0010, 0020). The check in `bookAsset` is for a decent message, not the rule.
export const assetBooking = pgTable(
  "asset_booking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    // Who will have it. A booking is always a person's — a shelf does not shoot a film.
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    // The reservation. Half-open in the constraint: a booking ending at 17:00 and one starting
    // at 17:00 do not clash.
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    purpose: text("purpose"),
    // The shoot or the client it is for, typed as the production team says it: "PRJ-2026-014".
    projectRef: text("project_ref"),
    status: text("status").$type<BookingStatus>().notNull().default("requested"),
    // What actually happened, kept apart from what was reserved.
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkedOutByPersonId: uuid("checked_out_by_person_id").references(() => person.id),
    conditionOut: text("condition_out").$type<AssetCondition>(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInByPersonId: uuid("checked_in_by_person_id").references(() => person.id),
    conditionIn: text("condition_in").$type<AssetCondition>(),
    note: text("note"),
    // Why it was called off, or who confirmed it.
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("asset_booking_asset_idx").on(t.assetId, t.startAt), index("asset_booking_person_idx").on(t.personId, t.startAt), index("asset_booking_window_idx").on(t.startAt, t.endAt)],
).enableRLS();

// Software licences and subscriptions (FR-AST-05). Not assets on a shelf: what matters is the
// seat count, the bill, and — above all — the renewal date, which is why the ops tracker pulls
// these rows as dated facts (`listLicenceRenewalFacts`) exactly as it pulls HR lifecycle events.
export const licence = pgTable(
  "licence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    vendor: text("vendor"),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    // How many seats are paid for; null = not counted. Who is using them is `licence_seat`.
    seats: integer("seats"),
    // Superseded by `licence_seat` (migration 0111 copied what it held). Kept until the code that
    // still names it is no longer deployed; nothing reads it.
    seatHolderPersonIds: uuid("seat_holder_person_ids").array(),
    // Integer VND per billing cycle. Read by the same people who read an asset's price.
    costPerCycle: bigint("cost_per_cycle", { mode: "number" }),
    billingCycle: text("billing_cycle").$type<BillingCycle>().notNull(),
    // The next date money is due. The scheduler walks forward from here on the cycle.
    renewalDate: date("renewal_date"),
    // Whether it renews itself if nobody acts — which changes what the obligation is *for*.
    autoRenews: boolean("auto_renews").notNull().default(true),
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    // Superseded by `licence_seat` as well: a seat on a device is a row there.
    assetId: uuid("asset_id").references(() => asset.id),
    accountRef: text("account_ref"),
    notes: text("notes"),
    status: text("status").$type<LicenceStatus>().notNull().default("active"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("licence_entity_idx").on(t.entityId, t.status), index("licence_renewal_idx").on(t.renewalDate)],
).enableRLS();

// Everything that ever happened to one asset, in order. Only ever inserted.
export const assetEvent = pgTable(
  "asset_event",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id),
    assignmentId: uuid("assignment_id").references(() => assetAssignment.id),
    type: text("type").$type<AssetEventType>().notNull(),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    note: text("note"),
    // What changed, or who it went to — never a price (the history is read more widely than the money).
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_event_asset_idx").on(t.assetId, t.id)],
).enableRLS();

// Who is using a paid seat (FR-AST-11): a person, or a device — the edit suite's Adobe seat belongs
// to the machine, whoever sits at it. Exactly one of the two. Open while `released_at` is null; a
// released row stays, so the table is also the history of who had the seat and when.
export const licenceSeat = pgTable(
  "licence_seat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    licenceId: uuid("licence_id")
      .notNull()
      .references(() => licence.id),
    personId: uuid("person_id").references(() => person.id),
    assetId: uuid("asset_id").references(() => asset.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByPersonId: uuid("assigned_by_person_id").references(() => person.id),
    note: text("note"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByPersonId: uuid("released_by_person_id").references(() => person.id),
    releaseNote: text("release_note"),
    ...timestamps,
  },
  (t) => [
    check("licence_seat_one_holder", sql`(${t.personId} IS NULL) <> (${t.assetId} IS NULL)`),
    // Nobody holds two seats of one subscription, and no machine does either — the database says so.
    uniqueIndex("licence_seat_person_open_key")
      .on(t.licenceId, t.personId)
      .where(sql`${t.releasedAt} is null and ${t.personId} is not null`),
    uniqueIndex("licence_seat_asset_open_key")
      .on(t.licenceId, t.assetId)
      .where(sql`${t.releasedAt} is null and ${t.assetId} is not null`),
    index("licence_seat_licence_idx").on(t.licenceId, t.releasedAt),
    index("licence_seat_person_idx")
      .on(t.personId)
      .where(sql`${t.releasedAt} is null`),
    index("licence_seat_asset_idx")
      .on(t.assetId)
      .where(sql`${t.releasedAt} is null`),
  ],
).enableRLS();

// A digital asset (FR-AST-07): a page, a channel, an ad account, a website, a business account.
// It sits on an entity's books like a camera does, has one person who answers for it, and — unlike
// a camera — is used by several people at once, each with their own access (`digital_asset_access`).
export const digitalAsset = pgTable(
  "digital_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<DigitalKind>().notNull(),
    platform: text("platform").$type<DigitalPlatform>().notNull(),
    // What people call it: "SuZu Media — Fanpage".
    name: text("name").notNull(),
    // What the platform calls it: "@suzumedia", a page id, a domain.
    handle: text("handle"),
    url: text("url"),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    ownership: text("ownership").$type<DigitalOwnership>().notNull().default("company"),
    // The client or brand it belongs to or speaks for (`work_client`). The foreign key is written
    // in migration 0111 by hand: the work schema imports this file for its links to an asset, and
    // importing it back would make the two schemas depend on each other.
    clientId: uuid("client_id"),
    // Who answers for it: grants and takes away access, and is asked when it changes hands.
    ownerPersonId: uuid("owner_person_id").references(() => person.id),
    visibility: text("visibility").$type<DigitalVisibility>().notNull().default("staff"),
    status: text("status").$type<DigitalStatus>().notNull().default("active"),
    // Restricted from here down (`canReadDigitalSecrets`): the email or phone the account is
    // registered under, who receives its two-factor codes, and where the password is kept — the
    // name of the vault item, never the password.
    loginIdentity: text("login_identity"),
    recoveryContact: text("recovery_contact"),
    credentialLocation: text("credential_location"),
    notes: text("notes"),
    // Set when somebody who knew the shared login lost their access; cleared when the password is changed.
    rotationDueSince: timestamp("rotation_due_since", { withTimezone: true }),
    credentialsRotatedAt: timestamp("credentials_rotated_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("digital_asset_entity_idx").on(t.entityId, t.status), index("digital_asset_owner_idx").on(t.ownerPersonId), index("digital_asset_client_idx").on(t.clientId)],
).enableRLS();

// One person's access to one digital asset (FR-AST-08), from the request to the day it was taken
// away. Only ever inserted and moved forward; never deleted.
export const digitalAssetAccess = pgTable(
  "digital_asset_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    digitalAssetId: uuid("digital_asset_id")
      .notNull()
      .references(() => digitalAsset.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    level: text("level").$type<AccessLevel>().notNull(),
    method: text("method").$type<AccessMethod>().notNull().default("own_account"),
    status: text("status").$type<AccessStatus>().notNull(),
    // Why it is needed, in the words of whoever asked or granted.
    note: text("note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    // Who answered the request or made the grant, and when.
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    // Access for a campaign: the day it should be looked at again.
    expiresOn: date("expires_on"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByPersonId: uuid("ended_by_person_id").references(() => person.id),
    // Why it was declined or taken away.
    endNote: text("end_note"),
    ...timestamps,
  },
  (t) => [
    // One open grant or request per person per asset; the history of closed ones is unlimited.
    uniqueIndex("digital_asset_access_open_key")
      .on(t.digitalAssetId, t.personId)
      .where(sql`${t.status} in ('requested', 'active')`),
    index("digital_asset_access_asset_idx").on(t.digitalAssetId, t.status),
    index("digital_asset_access_person_idx")
      .on(t.personId)
      .where(sql`${t.status} in ('requested', 'active')`),
  ],
).enableRLS();
