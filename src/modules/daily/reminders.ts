// The reminders' bookkeeping (`daily_reminder_sent`): one row per person, kind and day, written in
// the transaction that sends the notice — so a reminder goes out once however often its job runs,
// and two runs at once tell nobody twice. The daily loop's own jobs use it, and so does the work
// module's "hand the cover back" reminder (FR-PJM-44), through the service.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";

/** Marks the people as told of `kind` for the day, and returns the ones not told before. */
export async function claimReminders(tx: Tx, personIds: readonly string[], kind: string, sentOn: IsoDate): Promise<string[]> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return [];
  const fresh = await tx
    .insert(schema.dailyReminderSent)
    .values(ids.map((personId) => ({ personId, kind, sentOn })))
    .onConflictDoNothing()
    .returning({ personId: schema.dailyReminderSent.personId });
  return fresh.map((row) => row.personId);
}

/** Of these people, the `${personId}:${date}` pairs already told of `kind` on any of the dates. */
export async function remindedOn(personIds: readonly string[], kind: string, dates: readonly IsoDate[]): Promise<Set<string>> {
  if (personIds.length === 0 || dates.length === 0) return new Set();
  const rows = await db()
    .select({ personId: schema.dailyReminderSent.personId, sentOn: schema.dailyReminderSent.sentOn })
    .from(schema.dailyReminderSent)
    .where(and(inArray(schema.dailyReminderSent.personId, [...new Set(personIds)]), eq(schema.dailyReminderSent.kind, kind), inArray(schema.dailyReminderSent.sentOn, [...new Set(dates)])));
  return new Set(rows.map((row) => `${row.personId}:${row.sentOn}`));
}
