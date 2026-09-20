// Scheduled reports (FR-RPT-05, Phase 9). A schedule says *which* report, with *what* parameters,
// to *whom* and *how often*. It does not say what the recipients may see: that is decided again,
// per recipient, every time the job runs — so a schedule cannot outlive the permission that made it
// reasonable. What each recipient got (or did not, and why) is recorded on the run.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../platform/people/schema";

export const reportCadence = pgEnum("report_cadence", ["daily", "weekly", "monthly"]);
export const reportRunStatus = pgEnum("report_run_status", ["succeeded", "partial", "failed"]);

export const reportSchedule = pgTable(
  "report_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A key from the catalogue (reports/catalogue.ts), e.g. "headcount". Text, not an enum: adding
    // a report must not need a migration, and a key that has been retired still reads back.
    reportKey: text("report_key").notNull(),
    name: text("name").notNull(),
    // The report's own filters — entity, team, months back. Validated by the catalogue entry, which
    // owns their shape; nothing here is trusted on the way out.
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    cadence: reportCadence("cadence").notNull(),
    // weekly: 1 = Monday … 7 = Sunday. monthly: 1–31, clamped to a short month's last day.
    dayOfWeek: smallint("day_of_week"),
    dayOfMonth: smallint("day_of_month"),
    // The next calendar day (Vietnam) it is due. The job takes everything due on or before today,
    // so a day the job did not run is caught up once rather than repeated.
    nextRunOn: date("next_run_on").notNull(),
    lastRunOn: date("last_run_on"),
    isActive: boolean("is_active").notNull().default(true),
    locale: text("locale").notNull().default("vi"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("report_schedule_due_idx").on(t.nextRunOn).where(sql`${t.isActive} AND ${t.deletedAt} IS NULL`), index("report_schedule_owner_idx").on(t.createdByPersonId)],
).enableRLS();

/** Who a schedule sends to. A person, never a bare address: delivery re-checks their permissions. */
export const reportScheduleRecipient = pgTable(
  "report_schedule_recipient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => reportSchedule.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [index("report_schedule_recipient_idx").on(t.scheduleId, t.personId)],
).enableRLS();

/**
 * One delivery attempt. `outcomes` names each recipient and what happened to them —
 * `delivered`, `not_permitted` (they may not read this report today), `no_email`, `failed` —
 * which is the record that a report was *withheld*, not merely that it was not sent.
 */
export const reportScheduleRun = pgTable(
  "report_schedule_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => reportSchedule.id, { onDelete: "cascade" }),
    runOn: date("run_on").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    status: reportRunStatus("status").notNull(),
    delivered: integer("delivered").notNull().default(0),
    withheld: integer("withheld").notNull().default(0),
    outcomes: jsonb("outcomes").$type<{ personId: string; outcome: "delivered" | "not_permitted" | "no_email" | "failed"; rows: number }[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_schedule_run_idx").on(t.scheduleId, t.runOn)],
).enableRLS();
