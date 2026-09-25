import { boolean, index, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { person } from "../people/schema";

// One row per person per event. The wording is not stored: `kind` + `params` are turned into text
// in the reader's language when shown (see kinds.ts and the `notifications.kinds` messages).
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, string | number>>().notNull().default({}),
    // In-app path to open, e.g. "/people/<id>".
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Set once the daily digest has carried it, or when no digest is wanted.
    digestedAt: timestamp("digested_at", { withTimezone: true }),
  },
  (t) => [index("notification_recipient_idx").on(t.recipientPersonId, t.createdAt), index("notification_unread_idx").on(t.recipientPersonId).where(sql`${t.readAt} IS NULL`)],
).enableRLS();

export const emailChannel = pgEnum("email_channel", ["instant", "digest", "off"]);

// Only what differs from the defaults in kinds.ts is stored.
export const notificationPreference = pgTable(
  "notification_preference",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    category: text("category").notNull(),
    inApp: boolean("in_app").notNull(),
    email: emailChannel("email").notNull(),
    // Web push to the person's subscribed devices. null = the category's default (rows older than push).
    push: boolean("push"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.category] })],
).enableRLS();

export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed", "skipped"]);

// "simulated" = no Chat webhook is configured: the local driver recorded the card instead of sending it.
export const chatStatus = pgEnum("chat_status", ["pending", "sent", "simulated", "failed"]);

// Every email the app sends goes through here first, so a provider outage loses nothing.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: emailStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("email_outbox_status_idx").on(t.status, t.createdAt)],
).enableRLS();

// A browser or installed app that agreed to receive web push for a person (one row per device).
// The endpoint is a capability URL at the browser vendor's push service; the keys encrypt the
// message so that the push service cannot read it.
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [index("push_subscription_person_idx").on(t.personId)],
).enableRLS();

// Google Chat (FR-PLT-31). One row per card, exactly like `email_outbox` and `push_delivery`: an
// outage loses nothing, and what was sent to whom can be looked up. `space` is the webhook the
// card went to — the company has one space today, so it is recorded rather than configured per row.
export const chatDelivery = pgTable(
  "chat_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => person.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    /** The "approve" deep link (FR-PLT-24), when the card offers one. */
    actionLink: text("action_link"),
    actionLabel: text("action_label"),
    space: text("space"),
    status: chatStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("chat_delivery_status_idx").on(t.status, t.createdAt)],
).enableRLS();

// "simulated" = no VAPID keys are configured: the local driver recorded the push instead of sending it.
// "gone" = the push service said the subscription no longer exists; it was removed.
export const pushStatus = pgEnum("push_status", ["pending", "sent", "simulated", "failed", "gone"]);

// Every push goes through here first (like email_outbox): nothing is lost to an outage, and what
// was sent to whom can be looked up.
export const pushDelivery = pgTable(
  "push_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id").references(() => pushSubscription.id, { onDelete: "set null" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    status: pushStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("push_delivery_status_idx").on(t.status, t.createdAt), index("push_delivery_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

// ── Facebook Messenger (docs/MESSENGER.md) ──────────────────────────────────────────────────
//
// A Messenger account receives a person's notifications only after **both** sides proved
// themselves: the signed-in person opened a one-time link to the Page (so Meta tells us which
// Messenger account — the PSID — answered), and then typed into the app the code the bot sent to
// that account. Knowing the link alone reaches nobody: whoever opens a leaked link receives the
// code in *their* Messenger, and cannot type it into somebody else's session.

// One attempt to link. The token (in the m.me link) and the code (sent by the bot) are stored
// hashed; `psid` is whichever Messenger account last opened the link.
export const messengerLinkRequest = pgTable(
  "messenger_link_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    tokenHash: text("token_hash").notNull().unique(),
    psid: text("psid"),
    codeHash: text("code_hash"),
    codeSentAt: timestamp("code_sent_at", { withTimezone: true }),
    /** Wrong codes typed so far; the request is dead at five. */
    attempts: smallint("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Linked, replaced by a newer attempt, or given up: either way it can no longer be used. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("messenger_link_request_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

// A verified Messenger account of a person. Never deleted, only revoked, so what was sent where
// can still be read back. At most one live link per person and per Messenger account.
export const messengerLink = pgTable(
  "messenger_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    /** The Page-scoped ID Meta gives this Messenger account; meaningless to any other Page. */
    psid: text("psid").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    /** The person's last message to the Page: Meta lets a Page write freely for 24 hours after it. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** "unlinked" (in the app), "stopped" (from Messenger), "replaced", "unreachable". */
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("messenger_link_live_person_idx").on(t.personId).where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex("messenger_link_live_psid_idx").on(t.psid).where(sql`${t.revokedAt} IS NULL`),
  ],
).enableRLS();

// "simulated" = Messenger is not configured: the local driver recorded the message instead.
// "dropped" = refused at delivery time: the link was revoked or replaced, or the person may no
// longer receive anything (suspended, offboarded). Nothing was sent.
export const messengerStatus = pgEnum("messenger_status", ["pending", "sent", "simulated", "failed", "dropped"]);

// Every Messenger message goes through here first, like the other outboxes. A row is addressed to
// a *link*, not to a Messenger account: the deliverer re-reads the link and the person when it
// sends, so a message queued before an unlink or an offboarding is never delivered after it.
export const messengerDelivery = pgTable(
  "messenger_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => messengerLink.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    status: messengerStatus("status").notNull().default("pending"),
    /** "standard" inside the 24-hour window, "utility" (the approved template) outside it. */
    via: text("via"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("messenger_delivery_status_idx").on(t.status, t.createdAt), index("messenger_delivery_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

// ── Telegram (docs/TELEGRAM.md) ─────────────────────────────────────────────────────────────
//
// The same design as Messenger's, for a Telegram bot. A chat receives a person's notifications
// only after **both** sides proved themselves: the signed-in person opened a one-time t.me link to
// the bot (so Telegram tells us, over the authenticated webhook, which private chat pressed
// Start), and then typed into the app the code the bot sent to that chat. Whoever opens a leaked
// link receives the code in *their* Telegram, and cannot type it into somebody else's session.

// One attempt to link. The token (the t.me `start` parameter) and the code (sent by the bot) are
// stored hashed; `chat_id` is whichever private chat first opened the link.
export const telegramLinkRequest = pgTable(
  "telegram_link_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    tokenHash: text("token_hash").notNull().unique(),
    chatId: text("chat_id"),
    codeHash: text("code_hash"),
    codeSentAt: timestamp("code_sent_at", { withTimezone: true }),
    /** Wrong codes typed so far; the request is dead at five. */
    attempts: smallint("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Linked, replaced by a newer attempt, or given up: either way it can no longer be used. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("telegram_link_request_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

// A verified Telegram chat of a person. Never deleted, only revoked, so what was sent where can
// still be read back. At most one live link per person and per chat.
export const telegramLink = pgTable(
  "telegram_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    /** The private chat with the bot — for a private chat, the Telegram user's own id. Text: it can exceed 2^31. */
    chatId: text("chat_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** "unlinked" (in the app), "stopped" (from Telegram), "replaced", "unreachable". */
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("telegram_link_live_person_idx").on(t.personId).where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex("telegram_link_live_chat_idx").on(t.chatId).where(sql`${t.revokedAt} IS NULL`),
  ],
).enableRLS();

// "simulated" = Telegram is not configured: the local driver recorded the message instead.
// "dropped" = refused at delivery time: the link was revoked or replaced, or the person may no
// longer receive anything (suspended, offboarded). Nothing was sent.
export const telegramStatus = pgEnum("telegram_status", ["pending", "sent", "simulated", "failed", "dropped"]);

// Every Telegram message goes through here first, like the other outboxes. A row is addressed to a
// *link*, not to a chat: the deliverer re-reads the link and the person when it sends, so a message
// queued before an unlink or an offboarding is never delivered after it.
export const telegramDelivery = pgTable(
  "telegram_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => telegramLink.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    status: telegramStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("telegram_delivery_status_idx").on(t.status, t.createdAt), index("telegram_delivery_person_idx").on(t.personId, t.createdAt)],
).enableRLS();
