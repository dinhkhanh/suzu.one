// Deliveries nobody saw fail (ENG-05): an email given up after five attempts, a Chat card, a push,
// a Messenger or Telegram message the outbox could not send. Each outbox marks its row `failed`
// and stops; this counts them for Admin → Jobs, so a provider that stopped answering shows up on a
// screen somebody opens rather than only in a table.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";

export const DELIVERY_CHANNELS = ["email", "push", "chat", "messenger", "telegram"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** Failed deliveries created since `since`, per channel — one statement, the database counts. Restricted to nobody's data: counts only. */
export async function countFailedDeliveries(since: Date): Promise<Record<DeliveryChannel, number>> {
  const at = since.toISOString();
  const rows = rowsOf<{ channel: DeliveryChannel; failed: number }>(
    await db().execute(sql`
      SELECT 'email' AS channel, count(*)::int AS failed FROM email_outbox WHERE status = 'failed' AND created_at >= ${at}::timestamptz
      UNION ALL SELECT 'push', count(*)::int FROM push_delivery WHERE status = 'failed' AND created_at >= ${at}::timestamptz
      UNION ALL SELECT 'chat', count(*)::int FROM chat_delivery WHERE status = 'failed' AND created_at >= ${at}::timestamptz
      UNION ALL SELECT 'messenger', count(*)::int FROM messenger_delivery WHERE status = 'failed' AND created_at >= ${at}::timestamptz
      UNION ALL SELECT 'telegram', count(*)::int FROM telegram_delivery WHERE status = 'failed' AND created_at >= ${at}::timestamptz`),
  );
  const counts = Object.fromEntries(DELIVERY_CHANNELS.map((channel) => [channel, 0])) as Record<DeliveryChannel, number>;
  for (const row of rows) counts[row.channel] = Number(row.failed);
  return counts;
}
