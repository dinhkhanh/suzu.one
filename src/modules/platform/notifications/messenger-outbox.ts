// The Messenger outbox (docs/MESSENGER.md): delivery, and the one question asked again at the
// moment of sending — may this link still receive this person's notifications?
//
// `notify()` queues a row per live link. By the time the deliverer runs, the person may have
// unlinked, linked another account, told the bot to stop, been suspended or offboarded. Each of
// those is re-read here, per row, and any of them drops the message unsent.
import "server-only";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { invalidate } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { type MessengerDriver, type MessengerResult, messengerDriverFor } from "./messenger";

const MAX_ATTEMPTS = 5;
/** Meta's window is 24 hours from the person's last message; a margin keeps us clear of its edge. */
const WINDOW_MS = 23 * 60 * 60 * 1000;
/** Who may receive anything outside the app. Suspended people cannot sign in to read it either. */
const RECEIVING_STATUSES = ["active", "preboarding"] as const;

export const messengerStatusKey = (personId: string) => `messenger:status:${personId}`;
/** Every writer of a person's link or link attempts calls this after its change commits. */
export const invalidateMessengerStatus = (...personIds: string[]) => invalidate(...[...new Set(personIds)].map(messengerStatusKey));

/** Whether a person in this state may be sent anything through Messenger. */
export const mayReceive = (status: string) => (RECEIVING_STATUSES as readonly string[]).includes(status);

/** The deliverer found the account gone (blocked the Page, deleted): nothing more goes there. */
export async function revokeUnreachableLink(linkId: string, now: Date = new Date()): Promise<void> {
  const rows = await db()
    .update(schema.messengerLink)
    .set({ revokedAt: now, revokedReason: "unreachable" })
    .where(and(eq(schema.messengerLink.id, linkId), isNull(schema.messengerLink.revokedAt)))
    .returning({ personId: schema.messengerLink.personId });
  await invalidateMessengerStatus(...rows.map((row) => row.personId));
}

/** The "send me a test" button: one message to the caller's live link, if they have one. */
export async function queueTestMessenger(personId: string, message: { title: string; body: string; link: string | null }): Promise<number> {
  const links = await db()
    .select({ id: schema.messengerLink.id })
    .from(schema.messengerLink)
    .where(and(eq(schema.messengerLink.personId, personId), isNull(schema.messengerLink.revokedAt)));
  if (links.length) await db().insert(schema.messengerDelivery).values(links.map((link) => ({ linkId: link.id, personId, kind: "test", ...message })));
  return links.length;
}

export type MessengerTally = { sent: number; simulated: number; failed: number; dropped: number };

export async function deliverPendingMessengers(limit = 100, now: () => Date = () => new Date(), driver: MessengerDriver = messengerDriverFor()): Promise<MessengerTally> {
  const outbox = schema.messengerDelivery;
  const pending = await db()
    .select({ delivery: outbox, link: schema.messengerLink, personStatus: schema.person.status })
    .from(outbox)
    .innerJoin(schema.person, eq(schema.person.id, outbox.personId))
    .leftJoin(schema.messengerLink, eq(schema.messengerLink.id, outbox.linkId))
    .where(and(eq(outbox.status, "pending"), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
  const tally: MessengerTally = { sent: 0, simulated: 0, failed: 0, dropped: 0 };
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

    const message = { title: delivery.title, body: delivery.body, link: new URL(delivery.link ?? "/notifications", origin).toString() };
    const at = now();
    const inWindow = link.lastInboundAt !== null && at.getTime() - link.lastInboundAt.getTime() < WINDOW_MS;
    let via: "standard" | "utility" = inWindow ? "standard" : "utility";
    let result: MessengerResult = inWindow ? await driver.sendStandard(link.psid, message, "UPDATE") : await driver.sendUtility(link.psid, message);
    // Our clock said the window was open, Meta's said closed: the template is the way left.
    if (result.status === "outside_window") {
      via = "utility";
      result = await driver.sendUtility(link.psid, message);
    }

    if (result.status === "sent" || result.status === "simulated") {
      await db().update(outbox).set({ status: result.status, via, sentAt: at, lastError: null }).where(eq(outbox.id, delivery.id));
      if (result.status === "sent") delivered.set(link.id, link.personId);
      tally[result.status]++;
    } else if (result.status === "unreachable") {
      await db().update(outbox).set({ status: "dropped", via, lastError: result.error }).where(eq(outbox.id, delivery.id));
      await revokeUnreachableLink(link.id, at);
      tally.dropped++;
    } else {
      const givenUp = delivery.attempts + 1 >= MAX_ATTEMPTS;
      await db().update(outbox).set({ status: givenUp ? "failed" : "pending", via, lastError: result.error }).where(eq(outbox.id, delivery.id));
      tally.failed++;
    }
  }
  if (delivered.size) {
    await db().update(schema.messengerLink).set({ lastSuccessAt: now() }).where(inArray(schema.messengerLink.id, [...delivered.keys()]));
    await invalidateMessengerStatus(...delivered.values());
  }
  return tally;
}
