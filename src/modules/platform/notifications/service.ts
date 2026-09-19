import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { after } from "next/server";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import vi from "../../../../messages/vi.json";
import { sendEmail } from "./email";
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

export type NotifyInput = { recipients: readonly string[]; kind: Kind; params?: Params; link?: string | null };

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

  const [people, preferences] = await Promise.all([
    executor.select({ id: schema.person.id, workEmail: schema.person.workEmail, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, recipientIds)),
    executor
      .select()
      .from(schema.notificationPreference)
      .where(and(inArray(schema.notificationPreference.personId, recipientIds), eq(schema.notificationPreference.category, category))),
  ]);

  const now = new Date();
  const rows: (typeof schema.notification.$inferInsert)[] = [];
  const emails: (typeof schema.emailOutbox.$inferInsert)[] = [];
  for (const person of people) {
    if (person.status === "offboarded") continue;
    const choice = effectiveChoice(category, preferences.find((row) => row.personId === person.id));
    const wantsDigest = choice.email === "digest" && !!person.workEmail;
    if (choice.inApp || wantsDigest) {
      rows.push({ recipientPersonId: person.id, kind: input.kind, params, link: input.link ?? null, readAt: choice.inApp ? null : now, digestedAt: wantsDigest ? null : now });
    }
    if (choice.email === "instant" && person.workEmail) emails.push(composeEmail(person.workEmail, input.kind, params, input.link ?? null));
  }
  if (rows.length) await executor.insert(schema.notification).values(rows);
  if (emails.length) {
    await executor.insert(schema.emailOutbox).values(emails);
    deliverSoon();
  }
}

function composeEmail(to: string, kind: string, params: Params, link: string | null): typeof schema.emailOutbox.$inferInsert {
  const { title, body } = wording(kind, params);
  return { toEmail: to, subject: title, bodyText: `${body}\n\n${absolute(link)}\n\n— ${emailText("emailFooter")}` };
}

/** An email to an address rather than a person — e.g. the address someone just lost. */
export async function queueEmail(to: string, kind: Kind, params: Params, executor: Tx | ReturnType<typeof db> = db()): Promise<void> {
  await executor.insert(schema.emailOutbox).values(composeEmail(to, kind, params, null));
  deliverSoon();
}

// Send once the response is out; outside a request (jobs, tests) the daily sweep picks it up.
function deliverSoon(): void {
  try {
    after(() => deliverPendingEmails().catch((error) => console.error(JSON.stringify({ level: "error", event: "email.delivery_failed", message: String(error) }))));
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

export async function listNotifications(personId: string, page = 1): Promise<{ rows: NotificationRow[]; total: number }> {
  const where = eq(schema.notification.recipientPersonId, personId);
  const [rows, total] = await Promise.all([
    db().select().from(schema.notification).where(where).orderBy(desc(schema.notification.createdAt)).limit(NOTIFICATIONS_PAGE_SIZE).offset((Math.max(1, page) - 1) * NOTIFICATIONS_PAGE_SIZE),
    db().$count(schema.notification, where),
  ]);
  return { rows, total };
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

export async function getPreferences(personId: string): Promise<Record<Category, ChannelChoice>> {
  const stored = await db().select().from(schema.notificationPreference).where(eq(schema.notificationPreference.personId, personId));
  return Object.fromEntries(
    CATEGORIES.map((category) => {
      const { inApp, email } = effectiveChoice(category, stored.find((row) => row.category === category));
      return [category, { inApp, email }];
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
  return getPreferences(personId);
}
