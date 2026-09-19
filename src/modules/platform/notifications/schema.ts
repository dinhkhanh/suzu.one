import { boolean, index, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  (t) => [index("notification_recipient_idx").on(t.recipientPersonId, t.createdAt)],
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.category] })],
).enableRLS();

export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed", "skipped"]);

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
