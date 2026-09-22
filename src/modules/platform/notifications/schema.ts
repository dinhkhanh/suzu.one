import { boolean, index, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
