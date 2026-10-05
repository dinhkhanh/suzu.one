// Tables owned by Better Auth. Column names follow its Drizzle adapter contract — all but the last,
// which is the auth module's own.
import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Google's verified hosted-domain (`hd`) claim captured at first sign-in.
  hostedDomain: text("hosted_domain"),
  // The account's own preferences (owner's decision 2026-09-24): the language and the colour theme
  // follow the person to every device. Null is "never chosen", so the browser's cookie decides.
  locale: text("locale"),
  theme: text("theme"),
  // The sidebar entries the person pinned to its top, in the order they pinned them (keys of
  // `nav.ts`). Null is "never pinned anything". Entries they cannot open are skipped when drawn.
  navPins: text("nav_pins").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // When the person last proved who they are: set at sign-in and by the step-up round trip
    // (FR-PLT-06). Compensation screens and payroll actions ask for a recent value.
    reauthAt: timestamp("reauth_at", { withTimezone: true }),
    // Whose eyes this session is looking through (FR-PLT-40), and since when. Set and cleared only
    // by the impersonation actions; `getCurrentUser` re-checks the right on every request and
    // ignores a stale value. Text, not a person reference: a person who is deleted must not take a
    // session row with them.
    impersonatePersonId: text("impersonate_person_id"),
    impersonatedAt: timestamp("impersonated_at", { withTimezone: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
).enableRLS();

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
).enableRLS();

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
).enableRLS();

// The rate limiter of the sign-in endpoints (NFR-SEC-03): `/api/auth/*` counted per address, and
// the step-up round trip per session. Better Auth's own limiter counts in each server's memory, so
// on Vercel every new instance starts from zero; this one counts in Postgres, where every instance
// sees the same number. One row per (bucket, key, window) and one atomic upsert — the careers
// page's mechanism, in this module's own table (`endpoint-limit.ts`). `key_hash` is a hash of the
// address or the session, never either itself.
export const authEndpointHit = pgTable(
  "auth_endpoint_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What was counted: "sign_in", "session", "step_up". See `AUTH_LIMITS`.
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("auth_endpoint_hit_key").on(t.bucket, t.keyHash, t.windowStart), index("auth_endpoint_hit_window_idx").on(t.windowStart)],
).enableRLS();
