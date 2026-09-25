// The Telegram outbox (docs/TELEGRAM.md): delivery, and the one question asked again at the moment
// of sending — may this link still receive this person's notifications?
//
// `notify()` queues a row per live link. By the time the deliverer runs, the person may have
// unlinked, linked another chat, told the bot to stop, been suspended or offboarded. Each of those
// is re-read here, per row, and any of them drops the message unsent.
import "server-only";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { invalidate } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { type TelegramDriver, telegramDriverFor } from "./telegram";

const MAX_ATTEMPTS = 5;
/** Who may receive anything outside the app. Suspended people cannot sign in to read it either. */
const RECEIVING_STATUSES = ["active", "preboarding"] as const;

export const telegramStatusKey = (personId: string) => `telegram:status:${personId}`;
/** Every writer of a person's link or link attempts calls this after its change commits. */
export const invalidateTelegramStatus = (...personIds: string[]) => invalidate(...[...new Set(personIds)].map(telegramStatusKey));

/** Whether a person in this state may be sent anything through Telegram. */
export const mayReceive = (status: string) => (RECEIVING_STATUSES as readonly string[]).includes(status);

/** The deliverer found the chat gone (blocked the bot, deleted the account): nothing more goes there. */
export async function revokeUnreachableLink(linkId: string, now: Date = new Date()): Promise<void> {
  const rows = await db()
    .update(schema.telegramLink)
    .set({ revokedAt: now, revokedReason: "unreachable" })
    .where(and(eq(schema.telegramLink.id, linkId), isNull(schema.telegramLink.revokedAt)))
    .returning({ personId: schema.telegramLink.personId });
  await invalidateTelegramStatus(...rows.map((row) => row.personId));
}

/** The "send me a test" button: one message to the caller's live link, if they have one. */
export async function queueTestTelegram(personId: string, message: { title: string; body: string; link: string | null }): Promise<number> {
  const links = await db()
    .select({ id: schema.telegramLink.id })
    .from(schema.telegramLink)
    .where(and(eq(schema.telegramLink.personId, personId), isNull(schema.telegramLink.revokedAt)));
  if (links.length) await db().insert(schema.telegramDelivery).values(links.map((link) => ({ linkId: link.id, personId, kind: "test", ...message })));
  return links.length;
}

export type TelegramTally = { sent: number; simulated: number; failed: number; dropped: number };

export async function deliverPendingTelegrams(limit = 100, now: () => Date = () => new Date(), driver: TelegramDriver = telegramDriverFor()): Promise<TelegramTally> {
  const outbox = schema.telegramDelivery;
  const pending = await db()
    .select({ delivery: outbox, link: schema.telegramLink, personStatus: schema.person.status })
    .from(outbox)
    .innerJoin(schema.person, eq(schema.person.id, outbox.personId))
    .leftJoin(schema.telegramLink, eq(schema.telegramLink.id, outbox.linkId))
    .where(and(eq(outbox.status, "pending"), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
  const tally: TelegramTally = { sent: 0, simulated: 0, failed: 0, dropped: 0 };
  const origin = env().BETTER_AUTH_URL;
  const delivered = new Map<string, string>();

  for (const { delivery, link, personStatus } of pending) {
    // Claim it, as the other deliverers do.
    const [claimed] = await db()
      .update(outbox)
      .set({ attempts: delivery.attempts + 1 })
      .where(and(eq(outbox.id, delivery.id), eq(outbox.status, "pending"), eq(outbox.attempts, delivery.attempts)))
      .returning({ id: outbox.id });
    if (!claimed) continue;

    // The guard. Each reason is recorded; none of them sends anything.
    const refusal = !link ? "link missing" : link.revokedAt ? `link revoked (${link.revokedReason ?? "?"})` : link.personId !== delivery.personId ? "link belongs to someone else" : !mayReceive(personStatus) ? `person is ${personStatus}` : null;
    if (refusal || !link) {
      await db().update(outbox).set({ status: "dropped", lastError: refusal }).where(eq(outbox.id, delivery.id));
      tally.dropped++;
      continue;
    }

    const at = now();
    const result = await driver.send(link.chatId, { title: delivery.title, body: delivery.body, link: new URL(delivery.link ?? "/notifications", origin).toString() });
    if (result.status === "sent" || result.status === "simulated") {
      await db().update(outbox).set({ status: result.status, sentAt: at, lastError: null }).where(eq(outbox.id, delivery.id));
      if (result.status === "sent") delivered.set(link.id, link.personId);
      tally[result.status]++;
    } else if (result.status === "unreachable") {
      await db().update(outbox).set({ status: "dropped", lastError: result.error }).where(eq(outbox.id, delivery.id));
      await revokeUnreachableLink(link.id, at);
      tally.dropped++;
    } else {
      const givenUp = delivery.attempts + 1 >= MAX_ATTEMPTS;
      await db().update(outbox).set({ status: givenUp ? "failed" : "pending", lastError: result.error }).where(eq(outbox.id, delivery.id));
      tally.failed++;
    }
  }
  if (delivered.size) {
    await db().update(schema.telegramLink).set({ lastSuccessAt: now() }).where(inArray(schema.telegramLink.id, [...delivered.keys()]));
    await invalidateTelegramStatus(...delivered.values());
  }
  return tally;
}
