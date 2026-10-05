// How long the notification tables keep what they hold (ENG-04, NFR-PRV-04), swept nightly by the
// platform's housekeeping job. None of them is the record of anything: the approval, the task, the
// payslip a notice points at is kept by its own module, for as long as its own law says. What is
// kept here is the *telling* — and an email body or a Chat card carries a person's name, a leave
// date, an amount waiting — so it goes once nobody needs to look it up.
//
// A delivery still owed (`pending`) is never swept: the outbox exists so that an outage loses
// nothing. Nor is a live Messenger or Telegram link: only the attempts that led to one.
import "server-only";
import { and, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { invalidateLive } from "@/lib/cache/live";
import { db, schema } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";

/**
 * Half a year: long past the point a notice is acted on (the inbox shows the newest first, thirty a
 * page), and long enough to answer "was I ever told?" about the half-year a review or a payslip
 * question looks back over.
 */
export const NOTIFICATION_RETENTION_DAYS = 180;

/**
 * A quarter: what was sent to whom, by email, push, Chat, Messenger or Telegram, can be looked up
 * for a support question about last month's run — and the bodies, which name people and dates, do
 * not outlive that. Admin → Jobs counts failures over the last week, well inside it.
 */
export const DELIVERY_LOG_RETENTION_DAYS = 90;

/** A month: an attempt to link Messenger or Telegram that expired or was used says nothing after it. */
export const LINK_REQUEST_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);
const deleted = (result: unknown) => (result as { count?: number; rowCount?: number } | undefined)?.count ?? (result as { rowCount?: number } | undefined)?.rowCount ?? 0;

export type NotificationSweep = { notifications: number; deliveries: number; linkRequests: number };

export async function purgeNotificationHistory(now: Date = new Date()): Promise<NotificationSweep> {
  const noticesBefore = daysBefore(now, NOTIFICATION_RETENTION_DAYS);
  // Who lost a row, once each — the database de-duplicates, so the rows themselves never come here.
  const rows = rowsOf<{ id: string; total: number }>(
    await db().execute(sql`
      WITH gone AS (DELETE FROM notification WHERE created_at < ${noticesBefore.toISOString()}::timestamptz RETURNING recipient_person_id AS id)
      SELECT DISTINCT id, (SELECT count(*) FROM gone)::int AS total FROM gone`),
  );
  if (rows.length > 0) await invalidateLive(...rows.map((row) => row.id));

  const logBefore = daysBefore(now, DELIVERY_LOG_RETENTION_DAYS);
  const outboxes = [
    db().delete(schema.emailOutbox).where(and(lt(schema.emailOutbox.createdAt, logBefore), inArray(schema.emailOutbox.status, ["sent", "failed", "skipped"]))),
    db().delete(schema.pushDelivery).where(and(lt(schema.pushDelivery.createdAt, logBefore), inArray(schema.pushDelivery.status, ["sent", "simulated", "failed", "gone"]))),
    db().delete(schema.chatDelivery).where(and(lt(schema.chatDelivery.createdAt, logBefore), inArray(schema.chatDelivery.status, ["sent", "simulated", "failed"]))),
    db().delete(schema.messengerDelivery).where(and(lt(schema.messengerDelivery.createdAt, logBefore), inArray(schema.messengerDelivery.status, ["sent", "simulated", "failed", "dropped"]))),
    db().delete(schema.telegramDelivery).where(and(lt(schema.telegramDelivery.createdAt, logBefore), inArray(schema.telegramDelivery.status, ["sent", "simulated", "failed", "dropped"]))),
  ];
  const deliveries = (await Promise.all(outboxes)).reduce((sum, result) => sum + deleted(result), 0);

  const linkBefore = daysBefore(now, LINK_REQUEST_RETENTION_DAYS);
  const requests = await Promise.all([
    db().delete(schema.messengerLinkRequest).where(or(lt(schema.messengerLinkRequest.expiresAt, linkBefore), and(isNotNull(schema.messengerLinkRequest.closedAt), lt(schema.messengerLinkRequest.closedAt, linkBefore)))),
    db().delete(schema.telegramLinkRequest).where(or(lt(schema.telegramLinkRequest.expiresAt, linkBefore), and(isNotNull(schema.telegramLinkRequest.closedAt), lt(schema.telegramLinkRequest.closedAt, linkBefore)))),
  ]);

  return { notifications: rows[0]?.total ?? 0, deliveries, linkRequests: requests.reduce((sum, result) => sum + deleted(result), 0) };
}
