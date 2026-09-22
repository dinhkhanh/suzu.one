import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("./email", () => ({ sendEmail }));
const pushSend = vi.hoisted(() => vi.fn());
vi.mock("./push", () => ({ pushDriver: () => ({ name: "web-push", send: pushSend }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import en from "../../../../messages/en.json";
import vi_ from "../../../../messages/vi.json";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { loadShellCounts } from "../shell/service";
import { KINDS, messageKey } from "./kinds";
import { countUnread, deliverPendingEmails, deliverPendingPushes, getPreferences, listNotifications, listPushSubscriptions, markRead, notify, queueTestPush, removePushSubscription, savePushSubscription, sendDigests, setPreferences } from "./service";

const people = {} as Record<"an" | "binh" | "ctv" | "gone", string>;

beforeAll(async () => {
  await migrateTestDb();
  const rows = await db()
    .insert(schema.person)
    .values([
      { fullName: "An", searchName: "an", workEmail: "an@suzu.vn", status: "active" },
      { fullName: "Binh", searchName: "binh", workEmail: "binh@suzu.vn", status: "active" },
      { fullName: "Ctv", searchName: "ctv", status: "active" },
      { fullName: "Gone", searchName: "gone", workEmail: "gone@suzu.vn", status: "offboarded" },
    ])
    .returning();
  Object.assign(people, { an: rows[0].id, binh: rows[1].id, ctv: rows[2].id, gone: rows[3].id });
});

beforeEach(async () => {
  sendEmail.mockReset().mockResolvedValue({ status: "sent" });
  pushSend.mockReset().mockResolvedValue({ status: "sent" });
  await db().delete(schema.emailOutbox);
  await db().delete(schema.pushDelivery);
  await db().delete(schema.pushSubscription);
  await db().delete(schema.notification);
});

const jobFailed = (recipients: string[]) => notify({ recipients, kind: "system.job_failed", params: { job: "people-roll-over", error: "boom" }, link: "/admin/jobs" });

it("has Vietnamese and English wording for every kind", () => {
  for (const kind of Object.keys(KINDS)) {
    for (const messages of [vi_, en]) {
      const entry = (messages.notifications.kinds as Record<string, { title?: string; body?: string }>)[messageKey(kind)];
      expect(entry?.title, kind).toBeTruthy();
      expect(entry?.body, kind).toBeTruthy();
    }
  }
});

describe("notify", () => {
  it("reaches each person once, skips leavers, and only emails people who have an address", async () => {
    await jobFailed([people.an, people.an, people.ctv, people.gone]);
    expect(await countUnread(people.an)).toBe(1);
    expect(await countUnread(people.ctv)).toBe(1);
    expect(await countUnread(people.gone)).toBe(0);
    expect((await loadShellCounts(people.an)).unread).toBe(1);

    const outbox = await db().select().from(schema.emailOutbox);
    expect(outbox.map((email) => email.toEmail)).toEqual(["an@suzu.vn"]);
    expect(outbox[0].subject).toBe("Tác vụ tự động thất bại: people-roll-over");
    expect(outbox[0].bodyText).toContain("https://suzu.one/admin/jobs");
  });

  it("follows each person's preferences, except for mandatory categories", async () => {
    await setPreferences(people.an, { system: { inApp: false, email: "off", push: false }, security: { inApp: false, email: "off", push: false } });
    await setPreferences(people.binh, { system: { inApp: true, email: "digest", push: false } });
    expect((await getPreferences(people.an)).security).toEqual({ inApp: true, email: "instant", push: true });

    await jobFailed([people.an, people.binh]);
    expect(await countUnread(people.an)).toBe(0);
    expect(await countUnread(people.binh)).toBe(1);
    expect(await db().$count(schema.emailOutbox)).toBe(0);

    await notify({ recipients: [people.an], kind: "security.role_granted", params: { actor: "Owner", role: "hr_admin", scopeType: "entity", scopeName: "Media", validFrom: "2026-09-19" } });
    const [email] = await db().select().from(schema.emailOutbox);
    expect(email.bodyText).toContain("Quản trị nhân sự (Pháp nhân: Media)");
    expect(await countUnread(people.an)).toBe(1);
  });

  it("sends nothing when the surrounding transaction rolls back", async () => {
    await setPreferences(people.an, { system: { inApp: true, email: "instant", push: false } });
    await db()
      .transaction(async (tx) => {
        // PGlite and postgres-js transactions differ only in type.
        await notify({ recipients: [people.an], kind: "system.job_failed", params: { job: "x", error: "y" } }, tx as unknown as Parameters<typeof notify>[1]);
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await countUnread(people.an)).toBe(0);
    expect(await db().$count(schema.emailOutbox)).toBe(0);
  });
});

describe("the daily job", () => {
  it("rolls a person's waiting notifications into one email, once", async () => {
    await jobFailed([people.binh]);
    await jobFailed([people.binh]);
    expect(await sendDigests()).toEqual({ digests: 1 });
    expect(await sendDigests()).toEqual({ digests: 0 });
    const [email] = await db().select().from(schema.emailOutbox);
    expect(email).toMatchObject({ toEmail: "binh@suzu.vn", subject: "2 thông báo mới trên SuZu One" });
  });

  it("retries failed emails and gives up after five attempts", async () => {
    await jobFailed([people.an]);
    sendEmail.mockResolvedValue({ status: "failed", error: "503" });
    for (let attempt = 0; attempt < 4; attempt++) expect(await deliverPendingEmails()).toMatchObject({ failed: 1 });
    let [email] = await db().select().from(schema.emailOutbox);
    expect(email).toMatchObject({ status: "pending", attempts: 4, lastError: "503" });

    await deliverPendingEmails();
    [email] = await db().select().from(schema.emailOutbox);
    expect(email.status).toBe("failed");
    expect(await deliverPendingEmails()).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("marks emails sent, or skipped when no provider is configured", async () => {
    await jobFailed([people.an]);
    sendEmail.mockResolvedValue({ status: "skipped" });
    expect(await deliverPendingEmails()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "an@suzu.vn" }));
  });
});

describe("the notification centre", () => {
  it("lets a person mark only their own notifications as read", async () => {
    await jobFailed([people.an, people.ctv]);
    const { rows } = await listNotifications(people.ctv);
    expect(await markRead(people.an, rows[0].id)).toBe(0);
    expect(await markRead(people.ctv, rows[0].id)).toBe(1);
    expect(await markRead(people.an, null)).toBe(1);
    expect(await db().$count(schema.notification, eq(schema.notification.recipientPersonId, people.ctv))).toBe(1);
  });
});

describe("web push", () => {
  const device = (name: string) => ({ endpoint: `https://push.example/${name}`, p256dh: "p".repeat(87), auth: "a".repeat(22), userAgent: name });
  const approval = (recipients: string[]) => notify({ recipients, kind: "approvals.requested", params: { requester: "Huy", requestType: "leave" }, link: "/approvals" });

  it("queues one push per subscribed device, in Vietnamese, for categories that push by default", async () => {
    await savePushSubscription(people.an, device("phone"));
    await savePushSubscription(people.an, device("laptop"));
    await approval([people.an, people.binh]);
    // "system" does not push unless the person asks for it.
    await jobFailed([people.an]);
    const queued = await db().select().from(schema.pushDelivery);
    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({ personId: people.an, kind: "approvals.requested", link: "/approvals", status: "pending" });
    expect(queued[0].title).toContain("Huy");

    expect(await deliverPendingPushes()).toEqual({ sent: 2, simulated: 0, failed: 0, gone: 0 });
    expect(pushSend).toHaveBeenCalledWith({ endpoint: "https://push.example/phone", p256dh: "p".repeat(87), auth: "a".repeat(22) }, expect.objectContaining({ link: "/approvals", tag: "approvals.requested" }));
    expect((await listPushSubscriptions(people.an)).every((row) => row.lastSuccessAt)).toBe(true);
    expect(await deliverPendingPushes()).toEqual({ sent: 0, simulated: 0, failed: 0, gone: 0 });
  });

  it("follows the person's push preference", async () => {
    await savePushSubscription(people.binh, device("binh-phone"));
    await setPreferences(people.binh, { approvals: { inApp: true, email: "off", push: false }, system: { inApp: true, email: "off", push: true } });
    await approval([people.binh]);
    await jobFailed([people.binh]);
    expect((await db().select().from(schema.pushDelivery)).map((row) => row.kind)).toEqual(["system.job_failed"]);
    await db().delete(schema.notificationPreference);
  });

  it("forgets a subscription the push service no longer knows, and retries failures up to five times", async () => {
    await savePushSubscription(people.an, device("old-phone"));
    await approval([people.an]);
    pushSend.mockResolvedValue({ status: "gone" });
    expect((await deliverPendingPushes()).gone).toBe(1);
    expect(await listPushSubscriptions(people.an)).toEqual([]);

    await savePushSubscription(people.an, device("phone"));
    await approval([people.an]);
    pushSend.mockResolvedValue({ status: "failed", error: "503" });
    for (let attempt = 0; attempt < 6; attempt++) await deliverPendingPushes();
    expect(pushSend).toHaveBeenCalledTimes(1 + 5);
    const [row] = await db().select().from(schema.pushDelivery).where(eq(schema.pushDelivery.status, "failed"));
    expect(row).toMatchObject({ attempts: 5, lastError: "503" });
  });

  it("moves an endpoint to whoever subscribed last, and removes only the caller's own", async () => {
    await savePushSubscription(people.an, device("shared-tablet"));
    await savePushSubscription(people.binh, device("shared-tablet"));
    expect(await listPushSubscriptions(people.an)).toEqual([]);
    expect(await removePushSubscription(people.an, "https://push.example/shared-tablet")).toBe(0);
    expect(await queueTestPush(people.binh, { title: "t", body: "b", link: null })).toBe(1);
    expect(await removePushSubscription(people.binh, null)).toBe(1);
    // The queued push finds its device gone.
    expect((await deliverPendingPushes()).gone).toBe(1);
  });
});
