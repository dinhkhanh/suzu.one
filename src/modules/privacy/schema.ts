// Privacy (NFR-PRV-01..04): what a person was told and what they said to it, and which former
// employees have been anonymised. Everything else this module does — the export, the retention
// sweeps, the anonymisation itself — works on other modules' tables and owns none.
import { date, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../platform/people/schema";

// What a notice is about. GPS at check-in is a notice the person answers in the app; face check-in
// is consented to on a signed paper form that HR records on `face_enrolment` — its rows here are
// only the person's own withdrawals, which the NAS kiosk's roster reads (`faceWithdrawnAmong`).
export const privacyPurpose = pgEnum("privacy_purpose", ["gps_check_in", "face_check_in"]);
export const privacyDecision = pgEnum("privacy_decision", ["given", "declined", "withdrawn"]);

// One row per answer, never updated (Law 91/2025: consent must be provable). The person's current
// answer is their latest row for the purpose. A "given" or "declined" row keeps the notice exactly
// as it was shown — its version, its language and its words — so "what did they agree to?" is
// answered by the row itself, not by whatever the notice says today.
export const privacyConsentEvent = pgTable(
  "privacy_consent_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    purpose: privacyPurpose("purpose").notNull(),
    decision: privacyDecision("decision").notNull(),
    noticeVersion: text("notice_version"),
    noticeLocale: text("notice_locale"),
    noticeText: text("notice_text"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("privacy_consent_event_person_idx").on(t.personId, t.purpose, t.at)],
).enableRLS();

// A former employee whose personal details were removed after their retention period, with who
// confirmed it and what went (counts only — never the values). Its presence is what takes the
// person off HR's "due" list; the person row itself stays, because payroll, tax and insurance
// records must still name the person they are about.
export const personAnonymisation = pgTable("person_anonymisation", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => person.id),
  /** The last day of their last employment, which the retention period was counted from. */
  lastDay: date("last_day").notNull(),
  anonymisedAt: timestamp("anonymised_at", { withTimezone: true }).notNull().defaultNow(),
  anonymisedByPersonId: uuid("anonymised_by_person_id")
    .notNull()
    .references(() => person.id),
  removed: jsonb("removed").$type<Record<string, number>>().notNull().default({}),
}).enableRLS();
