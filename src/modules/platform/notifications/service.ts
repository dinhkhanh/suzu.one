import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { after } from "next/server";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { cachedLive, invalidateLive } from "@/lib/cache/live";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import vi from "../../../../messages/vi.json";
import { chatDriver } from "./chat";
import { sendEmail } from "./email";
import { pushDriver } from "./push";
import { CATEGORIES, CATEGORY_DEFINITIONS, type Category, type ChannelChoice, effectiveChoice, type Kind, KINDS, messageKey, resolveParams } from "./kinds";

export type NotificationRow = typeof schema.notification.$inferSelect;
type Params = Record<string, string | number>;

const MAX_ATTEMPTS = 5;
export const NOTIFICATIONS_PAGE_SIZE = 30;

// Emails are written in Vietnamese, the company's working language; the app shows each reader
// their own language.
const emailText = createTranslator({ locale: "vi", messages: vi, namespace: "notifications" });
const anyText = createTranslator({ locale: "vi", messages: vi });

function wording(kind: string, params: Params): { title: string; body: string } {
  const key = messageKey(kind);
  params = resolveParams(params, (messageId) => (anyText.has(messageId as never) ? anyText(messageId as never) : messageId));
  // Keys are built from the kind, so the compiler cannot check them; the kinds test does.
  return { title: emailText(`kinds.${key}.title` as "kinds.system_job_failed.title", params as never), body: emailText(`kinds.${key}.body` as "kinds.system_job_failed.body", params as never) };
}

const absolute = (link: string | null) => (link ? new URL(link, env().BETTER_AUTH_URL).toString() : env().BETTER_AUTH_URL);

export type NotifyInput = {
  recipients: readonly string[];
  kind: Kind;
  params?: Params;
  link?: string | null;
  /**
   * A card in the company's Google Chat space as well (FR-PLT-31), with an optional one-shot
   * "approve" link (FR-PLT-24). The space is shared, so `chat` is passed only for events that may
   * be read over a shoulder: who is waiting for what, never an amount or anything personal.
   */
  chat?: { actionPath?: string | null; actionLabel?: string | null } | false;
};

/**
 * Tells people that something happened, through the channels each of them chose.
 * Pass the transaction when the event is part of one, so nobody hears about a change that was
 * rolled back.
 */
export async function notify(input: NotifyInput, executor: Tx | ReturnType<typeof db> = db()): Promise<void> {
  const recipientIds = [...new Set(input.recipients)];
  if (recipientIds.length === 0) return;
  const category: Category = KINDS[input.kind];
  const params = input.params ?? {};

  const [people, preferences, devices] = await Promise.all([
    executor.select({ id: schema.person.id, workEmail: schema.person.workEmail, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, recipientIds)),
    preferenceRows(executor === db() ? undefined : executor).then((rows) => rows.filter((row) => row.category === category && recipientIds.includes(row.personId))),
    executor.select({ id: schema.pushSubscription.id, personId: schema.pushSubscription.personId }).from(schema.pushSubscription).where(inArray(schema.pushSubscription.personId, recipientIds)),
  ]);

  const now = new Date();
  const rows: (typeof schema.notification.$inferInsert)[] = [];
  const emails: (typeof schema.emailOutbox.$inferInsert)[] = [];
  const pushes: (typeof schema.pushDelivery.$inferInsert)[] = [];
  for (const person of people) {
    if (person.status === "offboarded") continue;
    const choice = effectiveChoice(category, preferences.find((row) => row.personId === person.id));
    const wantsDigest = choice.email === "digest" && !!person.workEmail;
    if (choice.inApp || wantsDigest) {
      rows.push({ recipientPersonId: person.id, kind: input.kind, params, link: input.link ?? null, readAt: choice.inApp ? null : now, digestedAt: wantsDigest ? null : now });
    }
    if (choice.email === "instant" && person.workEmail) emails.push(composeEmail(person.workEmail, input.kind, params, input.link ?? null));
    if (choice.push) {
      // Lock-screen text, in Vietnamese like the emails. One row per subscribed device.
      const { title, body } = wording(input.kind, params);
      for (const device of devices.filter((row) => row.personId === person.id)) pushes.push({ subscriptionId: device.id, personId: person.id, kind: input.kind, title, body, link: input.link ?? null });
    }
  }
  if (rows.length) await executor.insert(schema.notification).values(rows);
  if (emails.length) await executor.insert(schema.emailOutbox).values(emails);
  if (pushes.length) await executor.insert(schema.pushDelivery).values(pushes);
  // What this tells them about is on their screens too (src/lib/cache/live.ts). Inside a
  // transaction the marker holds their entries off the cache until the commit lands.
  await invalidateLive(...people.filter((person) => person.status !== "offboarded").map((person) => person.id));
  // One card per recipient: the deep link belongs to one person, and a space with several
  // approvers in it must not let the wrong one press the button.
  if (input.chat) {
    const cards: (typeof schema.chatDelivery.$inferInsert)[] = [];
    for (const person of people) {
      if (person.status === "offboarded") continue;
      const { title, body } = wording(input.kind, params);
      cards.push({
        personId: person.id,
        kind: input.kind,
        title,
        body,
        link: absolute(input.link ?? null),
        actionLink: input.chat.actionPath ? absolute(input.chat.actionPath) : null,
        actionLabel: input.chat.actionLabel ?? null,
      });
    }
    if (cards.length) await executor.insert(schema.chatDelivery).values(cards);
  }
  if (emails.length || pushes.length || input.chat) deliverSoon();
}

function composeEmail(to: string, kind: string, params: Params, link: string | null): typeof schema.emailOutbox.$inferInsert {
  const { title, body } = wording(kind, params);
  return { toEmail: to, subject: title, bodyText: `${body}\n\n${absolute(link)}\n\n— ${emailText("emailFooter")}` };
}

/**
 * An email whose wording did **not** come from the notification catalogue: the subject and body
 * are already written. The one caller is recruitment, whose candidate letters are editable
 * templates in the database rather than message keys (FR-REC-05), and whose recipient is outside
 * the company and so has no person, no preferences and no digest.
 *
 * It still goes through the same outbox — same delivery, same retries, same "simulated" when no
 * `RESEND_API_KEY` is set — because a second mail path is a second thing to get wrong.
 */
export async function queueRawEmail(to: string, subject: string, bodyText: string, executor: Tx | ReturnType<typeof db> = db()): Promise<void> {
  await executor.insert(schema.emailOutbox).values({ toEmail: to, subject, bodyText });
  deliverSoon();
}

/** An email to an address rather than a person — e.g. the address someone just lost. */
export async function queueEmail(to: string, kind: Kind, params: Params, executor: Tx | ReturnType<typeof db> = db()): Promise<void> {
  await executor.insert(schema.emailOutbox).values(composeEmail(to, kind, params, null));
  deliverSoon();
}

// Send once the response is out; outside a request (jobs, tests) the daily sweep picks it up.
function deliverSoon(): void {
  try {
    after(() =>
      Promise.all([deliverPendingEmails(), deliverPendingPushes(), deliverPendingChats()]).catch((error) => console.error(JSON.stringify({ level: "error", event: "notification.delivery_failed", message: String(error) }))),
    );
  } catch {
    // Not in a request.
  }
}

export async function deliverPendingEmails(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const outbox = schema.emailOutbox;
  const pending = await db().select().from(outbox).where(and(eq(outbox.status, "pending"), lt(outbox.attempts, MAX_ATTEMPTS))).orderBy(asc(outbox.createdAt)).limit(limit);
  const tally = { sent: 0, failed: 0, skipped: 0 };
  for (const email of pending) {
    // Claim it: a second deliverer running at the same moment sees a different attempt count and moves on.
    const [claimed] = await db()
      .update(outbox)
      .set({ attempts: email.attempts + 1 })
      .where(and(eq(outbox.id, email.id), eq(outbox.status, "pending"), eq(outbox.attempts, email.attempts)))
      .returning({ id: outbox.id });
    if (!claimed) continue;

    const result = await sendEmail({ to: email.toEmail, subject: email.subject, text: email.bodyText });
    if (result.status === "failed") {
      const givenUp = email.attempts + 1 >= MAX_ATTEMPTS;
      await db().update(outbox).set({ status: givenUp ? "failed" : "pending", lastError: result.error }).where(eq(outbox.id, email.id));
      tally.failed++;
    } else {
      await db().update(outbox).set({ status: result.status, sentAt: result.status === "sent" ? new Date() : null, lastError: null }).where(eq(outbox.id, email.id));
      tally[result.status]++;
    }
  }
  return tally;
}

// ── Web push ────────────────────────────────────────────────────────────────────────────────

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string; userAgent: string | null };

/**
 * This device wants pushes for this person. An endpoint belongs to one person: whoever subscribed
 * last on the device. Moving it from somebody else takes the browser's own keys for it, which only
 * that browser's subscription carries — knowing an endpoint is not enough to take it over (and to
 * silence its owner's pushes).
 */
export async function savePushSubscription(personId: string, input: PushSubscriptionInput): Promise<{ id: string }> {
  const table = schema.pushSubscription;
  const [row] = await db()
    .insert(table)
    .values({ personId, ...input })
    .onConflictDoUpdate({
      target: table.endpoint,
      set: { personId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent, createdAt: new Date(), lastSuccessAt: null },
      setWhere: or(eq(table.personId, personId), and(eq(table.p256dh, input.p256dh), eq(table.auth, input.auth))),
    })
    .returning({ id: table.id });
  if (!row) throw new ActionError("push_endpoint_taken");
  return row;
}

/** Removes one of the caller's own subscriptions (or all of them). */
export async function removePushSubscription(personId: string, endpoint: string | null): Promise<number> {
  const rows = await db()
    .delete(schema.pushSubscription)
    .where(and(eq(schema.pushSubscription.personId, personId), endpoint ? eq(schema.pushSubscription.endpoint, endpoint) : sql`true`))
    .returning({ id: schema.pushSubscription.id });
  return rows.length;
}

export async function listPushSubscriptions(personId: string): Promise<{ id: string; endpoint: string; userAgent: string | null; createdAt: Date; lastSuccessAt: Date | null }[]> {
  return db()
    .select({ id: schema.pushSubscription.id, endpoint: schema.pushSubscription.endpoint, userAgent: schema.pushSubscription.userAgent, createdAt: schema.pushSubscription.createdAt, lastSuccessAt: schema.pushSubscription.lastSuccessAt })
    .from(schema.pushSubscription)
    .where(eq(schema.pushSubscription.personId, personId))
    .orderBy(desc(schema.pushSubscription.createdAt));
}

/** A push to every device of one person, outside the catalogue of kinds — the "send me a test" button. */
export async function queueTestPush(personId: string, message: { title: string; body: string; link: string | null }): Promise<number> {
  const devices = await db().select({ id: schema.pushSubscription.id }).from(schema.pushSubscription).where(eq(schema.pushSubscription.personId, personId));
  if (devices.length) await db().insert(schema.pushDelivery).values(devices.map((device) => ({ subscriptionId: device.id, personId, kind: "test", ...message })));
  return devices.length;
}

export async function deliverPendingPushes(limit = 100): Promise<{ sent: number; simulated: number; failed: number; gone: number }> {
  const outbox = schema.pushDelivery;
  const driver = pushDriver();
  const pending = await db()
    .select({ delivery: outbox, device: schema.pushSubscription })
    .from(outbox)
    .leftJoin(schema.pushSubscription, eq(schema.pushSubscription.id, outbox.subscriptionId))
    .where(and(eq(outbox.status, "pending"), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
  const tally = { sent: 0, simulated: 0, failed: 0, gone: 0 };
  for (const { delivery, device } of pending) {
    // Claim it, as the email deliverer does.
    const [claimed] = await db()
      .update(outbox)
      .set({ attempts: delivery.attempts + 1 })
      .where(and(eq(outbox.id, delivery.id), eq(outbox.status, "pending"), eq(outbox.attempts, delivery.attempts)))
      .returning({ id: outbox.id });
    if (!claimed) continue;
    // The device unsubscribed between the event and now.
    const result = device ? await driver.send({ endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth }, { title: delivery.title, body: delivery.body, link: delivery.link, tag: delivery.kind }) : ({ status: "gone" } as const);

    if (result.status === "failed") {
      const givenUp = delivery.attempts + 1 >= MAX_ATTEMPTS;
      await db().update(outbox).set({ status: givenUp ? "failed" : "pending", lastError: result.error }).where(eq(outbox.id, delivery.id));
    } else {
      await db().update(outbox).set({ status: result.status, sentAt: result.status === "gone" ? null : new Date(), lastError: null }).where(eq(outbox.id, delivery.id));
      if (result.status === "gone" && device) await db().delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, device.id));
      if (result.status === "sent" && device) await db().update(schema.pushSubscription).set({ lastSuccessAt: new Date() }).where(eq(schema.pushSubscription.id, device.id));
    }
    tally[result.status]++;
  }
  return tally;
}

// ── Google Chat (FR-PLT-31) ─────────────────────────────────────────────────────────────────

/** Posts the waiting cards. Without a webhook the driver records them as "simulated" instead. */
export async function deliverPendingChats(limit = 50): Promise<{ sent: number; simulated: number; failed: number }> {
  const outbox = schema.chatDelivery;
  const driver = chatDriver();
  const pending = await db().select().from(outbox).where(and(eq(outbox.status, "pending"), lt(outbox.attempts, MAX_ATTEMPTS))).orderBy(asc(outbox.createdAt)).limit(limit);
  const tally = { sent: 0, simulated: 0, failed: 0 };
  for (const card of pending) {
    // Claim it, as the email and push deliverers do.
    const [claimed] = await db()
      .update(outbox)
      .set({ attempts: card.attempts + 1, space: driver.space })
      .where(and(eq(outbox.id, card.id), eq(outbox.status, "pending"), eq(outbox.attempts, card.attempts)))
      .returning({ id: outbox.id });
    if (!claimed) continue;

    const result = await driver.send({ title: card.title, body: card.body, link: card.link, actionLink: card.actionLink, actionLabel: card.actionLabel });
    if (result.status === "failed") {
      const givenUp = card.attempts + 1 >= MAX_ATTEMPTS;
      await db().update(outbox).set({ status: givenUp ? "failed" : "pending", lastError: result.error }).where(eq(outbox.id, card.id));
    } else {
      await db().update(outbox).set({ status: result.status, sentAt: new Date(), lastError: null }).where(eq(outbox.id, card.id));
    }
    tally[result.status]++;
  }
  return tally;
}

/** One email per person with everything their digest has not carried yet. */
export async function sendDigests(): Promise<{ digests: number }> {
  const waiting = await db()
    .select({ id: schema.notification.id, personId: schema.notification.recipientPersonId, kind: schema.notification.kind, params: schema.notification.params, workEmail: schema.person.workEmail })
    .from(schema.notification)
    .innerJoin(schema.person, eq(schema.person.id, schema.notification.recipientPersonId))
    .where(isNull(schema.notification.digestedAt))
    .orderBy(asc(schema.notification.createdAt));

  const byPerson = Map.groupBy(waiting, (row) => row.personId);
  let digests = 0;
  for (const items of byPerson.values()) {
    const to = items[0].workEmail;
    await db().transaction(async (tx) => {
      if (to) {
        const lines = items.map((item) => `• ${wording(item.kind, item.params).title}`);
        await tx.insert(schema.emailOutbox).values({
          toEmail: to,
          subject: emailText("digestSubject", { count: items.length }),
          bodyText: `${lines.join("\n")}\n\n${absolute("/notifications")}\n\n— ${emailText("emailFooter")}`,
        });
        digests++;
      }
      await tx.update(schema.notification).set({ digestedAt: new Date() }).where(inArray(schema.notification.id, items.map((item) => item.id)));
    });
  }
  return { digests };
}

// ── The notification centre ─────────────────────────────────────────────────────────────────

export async function countUnread(personId: string): Promise<number> {
  const [row] = await db().select({ value: count() }).from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), isNull(schema.notification.readAt)));
  return row?.value ?? 0;
}

/** The first page, the one the badge leads to, comes from the live tier; older pages are read as they stand. */
export async function listNotifications(personId: string, page = 1): Promise<{ rows: NotificationRow[]; total: number }> {
  const load = async () => {
    const where = eq(schema.notification.recipientPersonId, personId);
    const [rows, total] = await Promise.all([
      db().select().from(schema.notification).where(where).orderBy(desc(schema.notification.createdAt)).limit(NOTIFICATIONS_PAGE_SIZE).offset((Math.max(1, page) - 1) * NOTIFICATIONS_PAGE_SIZE),
      db().$count(schema.notification, where),
    ]);
    return { rows, total };
  };
  return page <= 1 ? cachedLive(personId, "notifications", load) : load();
}

/** Marks one notification read, or all of them. Only ever the caller's own. */
export async function markRead(personId: string, notificationId: string | null): Promise<number> {
  const rows = await db()
    .update(schema.notification)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notification.recipientPersonId, personId), isNull(schema.notification.readAt), notificationId ? eq(schema.notification.id, notificationId) : sql`true`))
    .returning({ id: schema.notification.id });
  return rows.length;
}

// Everyone's explicit choices in one entry (a few rows per person who ever changed one), read for
// every recipient of every notification and on the notifications page; `setPreferences` drops it.
const PREFERENCES_KEY = "notifications:preferences";
type PreferenceRow = typeof schema.notificationPreference.$inferSelect;

/** Inside a transaction the rows are read there; otherwise from the shared cache. */
async function preferenceRows(executor?: Tx | ReturnType<typeof db>): Promise<PreferenceRow[]> {
  const read = (from: Tx | ReturnType<typeof db>) => from.select().from(schema.notificationPreference).orderBy(asc(schema.notificationPreference.personId), asc(schema.notificationPreference.category));
  return executor ? read(executor) : cached(PREFERENCES_KEY, TTL.reference, () => read(db()));
}

export async function getPreferences(personId: string): Promise<Record<Category, ChannelChoice>> {
  const stored = (await preferenceRows()).filter((row) => row.personId === personId);
  return Object.fromEntries(
    CATEGORIES.map((category) => {
      return [category, effectiveChoice(category, stored.find((row) => row.category === category))];
    }),
  ) as Record<Category, ChannelChoice>;
}

export async function setPreferences(personId: string, choices: Partial<Record<Category, ChannelChoice>>): Promise<Record<Category, ChannelChoice>> {
  for (const category of CATEGORIES) {
    const choice = choices[category];
    if (!choice || CATEGORY_DEFINITIONS[category].mandatory) continue;
    await db()
      .insert(schema.notificationPreference)
      .values({ personId, category, ...choice })
      .onConflictDoUpdate({ target: [schema.notificationPreference.personId, schema.notificationPreference.category], set: { ...choice, updatedAt: new Date() } });
  }
  await invalidate(PREFERENCES_KEY);
  return getPreferences(personId);
}
