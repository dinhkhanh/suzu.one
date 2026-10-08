// The morning reminders of a review cycle (FR-PRF-03): a form due soon, a form overdue, a sign-off
// conversation not yet recorded, a released review not yet acknowledged. Told to whoever owes it,
// with how many and by when — never what anybody wrote, never a rating.
//
//   review_due        a self, manager or peer form not submitted, due within DUE_SOON_DAYS — once
//   review_overdue    the same, past its day — once a week while it stays open
//   sign_off_waiting  released SETTLE_DAYS ago, the cycle asks for a sign-off, none recorded — weekly, to the manager
//   ack_waiting       released (and signed off where asked) SETTLE_DAYS ago, not acknowledged — weekly, to the person
//
// `performance_reminder_sent` remembers each one by person, kind and subject (the form, plus the
// week for the repeating kinds), claimed in the same transaction as the notice: a second run of
// the job on the same day, or a retry after a failure, tells nobody twice.
import "server-only";
import { and, eq, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { byParams } from "./review-notices";

/** How far ahead "due soon" looks. Company practice, like the other reminders' cadence. */
export const DUE_SOON_DAYS = 3;
/** How long a released review sits before its sign-off or acknowledgement is chased. */
export const SETTLE_DAYS = 3;
const REPEAT_EVERY_DAYS = 7;

export type ReminderKind = "review_due" | "review_overdue" | "sign_off_waiting" | "ack_waiting";
const NOTICE: Record<ReminderKind, "performance.review_due" | "performance.review_overdue" | "performance.sign_off_waiting" | "performance.ack_waiting"> = {
  review_due: "performance.review_due",
  review_overdue: "performance.review_overdue",
  sign_off_waiting: "performance.sign_off_waiting",
  ack_waiting: "performance.ack_waiting",
};

type Reminder = { personId: string; kind: ReminderKind; subject: string; dueOn: IsoDate | null };

const daysFrom = (from: IsoDate, to: IsoDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Which week of waiting `today` is in, counted from the first day it was chased: 0, 1, 2… */
const weekOf = (since: IsoDate, today: IsoDate): number => Math.max(0, Math.floor(daysFrom(since, today) / REPEAT_EVERY_DAYS));

const { reviewCycle: cycle, reviewParticipant: participant, reviewForm: form, reviewPeerNomination: nomination, person } = schema;

/** No submitted form of this kind (by this author, for peers) on the participant. */
const notSubmitted = (kind: "self" | "manager" | "peer", author?: SQL): SQL =>
  sql`not exists (select 1 from ${form} where ${form.participantId} = ${participant.id} and ${form.kind} = ${kind} and ${form.status} = 'submitted'${author ? sql` and ${form.authorPersonId} = ${author}` : sql``})`;

/** The forms still owed in a collecting cycle whose deadline is at most `horizon`. One query per kind of form. */
async function owedForms(horizon: IsoDate): Promise<{ personId: string; participantId: string; formKind: "self" | "manager" | "peer"; dueOn: IsoDate }[]> {
  const live = and(eq(cycle.status, "active"), isNull(participant.releasedAt), eq(person.status, "active"));
  const selfDue = sql<IsoDate>`coalesce(${participant.selfDueOn}, ${cycle.selfDueOn})`;
  const managerDue = sql<IsoDate>`coalesce(${participant.managerDueOn}, ${cycle.managerDueOn})`;
  const peer = alias(person, "peer");
  const [self, manager, peers] = await Promise.all([
    db()
      .select({ personId: participant.personId, participantId: participant.id, dueOn: selfDue })
      .from(participant)
      .innerJoin(cycle, eq(cycle.id, participant.cycleId))
      .innerJoin(person, eq(person.id, participant.personId))
      .where(and(live, sql`${selfDue} <= ${horizon}`, notSubmitted("self"))),
    db()
      .select({ personId: person.id, participantId: participant.id, dueOn: managerDue })
      .from(participant)
      .innerJoin(cycle, eq(cycle.id, participant.cycleId))
      .innerJoin(person, eq(person.id, participant.managerPersonId))
      .where(and(live, sql`${managerDue} <= ${horizon}`, notSubmitted("manager"))),
    db()
      .select({ personId: peer.id, participantId: participant.id, dueOn: sql<IsoDate>`${cycle.peerDueOn}` })
      .from(nomination)
      .innerJoin(participant, eq(participant.id, nomination.participantId))
      .innerJoin(cycle, eq(cycle.id, participant.cycleId))
      .innerJoin(person, eq(person.id, participant.personId))
      .innerJoin(peer, eq(peer.id, nomination.peerPersonId))
      .where(and(live, eq(peer.status, "active"), eq(nomination.status, "approved"), isNotNull(cycle.peerDueOn), lte(cycle.peerDueOn, horizon), notSubmitted("peer", sql`${nomination.peerPersonId}`))),
  ]);
  return [...self.map((row) => ({ ...row, formKind: "self" as const })), ...manager.map((row) => ({ ...row, formKind: "manager" as const })), ...peers.map((row) => ({ ...row, formKind: "peer" as const }))];
}

/** The Vietnam calendar day of an instant column, as a date string. */
const vietnamDay = (instant: SQL): SQL<IsoDate> => sql<IsoDate>`((${instant} at time zone 'Asia/Ho_Chi_Minh')::date)::text`;

/** Released reviews still waiting on the manager's sign-off or the person's acknowledgement, with the day the wait began. */
async function waitingAfterRelease(settledBefore: Date): Promise<{ personId: string; participantId: string; kind: "sign_off_waiting" | "ack_waiting"; sinceDay: IsoDate }[]> {
  const released = and(isNotNull(participant.releasedAt), isNull(participant.acknowledgedAt), lte(participant.releasedAt, settledBefore), eq(person.status, "active"));
  const [signOff, ack] = await Promise.all([
    db()
      .select({ personId: person.id, participantId: participant.id, sinceDay: vietnamDay(sql`${participant.releasedAt}`) })
      .from(participant)
      .innerJoin(cycle, eq(cycle.id, participant.cycleId))
      .innerJoin(person, eq(person.id, participant.managerPersonId))
      .where(and(released, eq(cycle.signOffRequired, true), isNull(participant.signOffRecordedAt))),
    db()
      .select({ personId: person.id, participantId: participant.id, sinceDay: vietnamDay(sql`greatest(${participant.releasedAt}, ${participant.signOffRecordedAt})`) })
      .from(participant)
      .innerJoin(cycle, eq(cycle.id, participant.cycleId))
      .innerJoin(person, eq(person.id, participant.personId))
      // Where the cycle asks for a sign-off, the person is chased only once it has been recorded — and SETTLE_DAYS after it.
      .where(and(released, or(eq(cycle.signOffRequired, false), and(isNotNull(participant.signOffRecordedAt), lte(participant.signOffRecordedAt, settledBefore))))),
  ]);
  return [...signOff.map((row) => ({ ...row, kind: "sign_off_waiting" as const })), ...ack.map((row) => ({ ...row, kind: "ack_waiting" as const }))];
}

/** What is owed this morning, as reminder rows — pure once the rows are read, so the subjects are testable. */
export function plannedReminders(today: IsoDate, owed: Awaited<ReturnType<typeof owedForms>>, waiting: { personId: string; participantId: string; kind: "sign_off_waiting" | "ack_waiting"; sinceDay: IsoDate }[]): Reminder[] {
  return [
    ...owed.map((row): Reminder => {
      const subject = `${row.participantId}:${row.formKind}`;
      return row.dueOn >= today
        ? { personId: row.personId, kind: "review_due", subject, dueOn: row.dueOn }
        : { personId: row.personId, kind: "review_overdue", subject: `${subject}:${weekOf(addDays(row.dueOn, 1), today)}`, dueOn: row.dueOn };
    }),
    ...waiting.map((row): Reminder => ({ personId: row.personId, kind: row.kind, subject: `${row.participantId}:${weekOf(addDays(row.sinceDay, SETTLE_DAYS), today)}`, dueOn: null })),
  ];
}

export async function sendReviewReminders(today: IsoDate, now: Date = new Date()): Promise<Record<ReminderKind, number>> {
  const settledBefore = new Date(now.getTime() - SETTLE_DAYS * 86_400_000);
  const [owed, waiting] = await Promise.all([owedForms(addDays(today, DUE_SOON_DAYS)), waitingAfterRelease(settledBefore)]);
  const reminders = plannedReminders(today, owed, waiting);
  const tally: Record<ReminderKind, number> = { review_due: 0, review_overdue: 0, sign_off_waiting: 0, ack_waiting: 0 };
  if (reminders.length === 0) return tally;

  await db().transaction(async (tx) => {
    // The insert is the claim: only what was not sent before goes out.
    const claimed = await tx
      .insert(schema.performanceReminderSent)
      .values(reminders.map((row) => ({ personId: row.personId, kind: row.kind, subject: row.subject, sentOn: today })))
      .onConflictDoNothing()
      .returning({ personId: schema.performanceReminderSent.personId, kind: schema.performanceReminderSent.kind, subject: schema.performanceReminderSent.subject });
    const fresh = new Set(claimed.map((row) => `${row.personId}|${row.kind}|${row.subject}`));
    const sent = reminders.filter((row) => fresh.has(`${row.personId}|${row.kind}|${row.subject}`));

    // One notice per person and kind: how many, and (for the forms due) the nearest day.
    const perPerson = new Map<string, { recipient: string; kind: ReminderKind; params: { count: number; date: string } }>();
    for (const row of sent) {
      const key = `${row.personId}|${row.kind}`;
      const entry = perPerson.get(key) ?? { recipient: row.personId, kind: row.kind, params: { count: 0, date: row.dueOn ?? "none" } };
      entry.params.count += 1;
      if (row.dueOn && (entry.params.date === "none" || row.dueOn < entry.params.date)) entry.params.date = row.dueOn;
      perPerson.set(key, entry);
      tally[row.kind] += 1;
    }
    for (const kind of Object.keys(NOTICE) as ReminderKind[]) {
      for (const group of byParams([...perPerson.values()].filter((entry) => entry.kind === kind))) {
        await notify({ recipients: group.recipients, kind: NOTICE[kind], params: group.params, link: "/performance/reviews" }, tx);
      }
    }
  });
  return tally;
}
