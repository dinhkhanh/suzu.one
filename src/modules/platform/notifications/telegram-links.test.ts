// Who a Telegram chat belongs to, and what it is sent (docs/TELEGRAM.md). Telegram is a fake
// driver that records what the bot would have said to which chat.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("./email", () => ({ sendEmail: vi.fn().mockResolvedValue({ status: "sent" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import type { TelegramDriver, TelegramMessage, TelegramResult } from "./telegram";
import { confirmTelegramLink, getTelegramStatus, handleTelegramEvent, startTelegramLink, unlinkTelegram } from "./telegram-links";
import { deliverPendingTelegrams } from "./telegram-outbox";
import { notify } from "./service";

const people = {} as Record<"an" | "binh" | "other", string>;

let sent: { chatId: string; message: TelegramMessage }[] = [];
let nextResult: TelegramResult | null = null;
const driver: TelegramDriver = {
  name: "telegram",
  send: async (chatId, message) => {
    sent.push({ chatId, message });
    return nextResult ?? { status: "sent" };
  },
};

const tokenOf = (url: string) => new URL(url).searchParams.get("start")!;
const codeSentTo = (chatId: string) => sent.filter((row) => row.chatId === chatId).at(-1)?.message.title.match(/\b(\d{6})\b/)?.[1];
const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);
const start = (chatId: string, payload: string, at = new Date()) => handleTelegramEvent({ type: "start", chatId, payload }, at, driver);

/** The whole happy path: start, press Start from `chatId`, type the code. */
async function link(personId: string, chatId: string, at = new Date()) {
  const { url } = await startTelegramLink(personId, at);
  await start(chatId, tokenOf(url), at);
  return confirmTelegramLink(personId, codeSentTo(chatId)!, at, driver);
}

beforeAll(async () => {
  await migrateTestDb();
  const rows = await db()
    .insert(schema.person)
    .values([
      { fullName: "An", searchName: "an", workEmail: "an@suzu.vn", status: "active" },
      { fullName: "Binh", searchName: "binh", workEmail: "binh@suzu.vn", status: "active" },
      { fullName: "Other", searchName: "other", status: "active" },
    ])
    .returning();
  Object.assign(people, { an: rows[0].id, binh: rows[1].id, other: rows[2].id });
});

beforeEach(async () => {
  sent = [];
  nextResult = null;
  await db().delete(schema.telegramDelivery);
  await db().delete(schema.telegramLink);
  await db().delete(schema.telegramLinkRequest);
  await db().delete(schema.notification);
  await db().delete(schema.emailOutbox);
  await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, people.other));
});

describe("linking", () => {
  it("links only after the chat got the code and the signed-in person typed it back", async () => {
    const { url } = await startTelegramLink(people.an);
    // Telegram allows 64 characters of [A-Za-z0-9_-] in a start parameter.
    expect(tokenOf(url)).toMatch(/^link_[A-Za-z0-9_-]{43}$/);
    expect((await getTelegramStatus(people.an)).pending).toMatchObject({ codeSent: false });

    await start("100", tokenOf(url));
    const code = codeSentTo("100");
    expect(code).toMatch(/^\d{6}$/);
    // The reply names nobody: whoever opened the link learns no one's identity from it.
    expect(sent[0].message.title).not.toContain("An");

    await confirmTelegramLink(people.an, code!, new Date(), driver);
    const status = await getTelegramStatus(people.an);
    expect(status.link).not.toBeNull();
    expect(status.pending).toBeNull();
    // A security notice goes out about it, in the app and by email.
    const [notice] = await db().select().from(schema.notification).where(eq(schema.notification.recipientPersonId, people.an));
    expect(notice.kind).toBe("security.telegram_linked");
    expect(await db().$count(schema.emailOutbox)).toBe(1);
    // The token and the code are stored only as hashes.
    const [request] = await db().select().from(schema.telegramLinkRequest);
    expect(request.tokenHash).not.toContain(tokenOf(url));
    expect(request.codeHash).not.toContain(code!);
  });

  it("gives a leaked link's finder a code they cannot use, and a second chat nothing", async () => {
    const { url } = await startTelegramLink(people.an);
    await start("666", tokenOf(url));
    const stolenCode = codeSentTo("666")!;
    // The finder has the code but no session of An's: typing it as themselves reaches nothing.
    await expect(confirmTelegramLink(people.binh, stolenCode, new Date(), driver)).rejects.toThrow("telegram_no_pending");
    // The real owner's chat, second on the same link, gets no code.
    await start("100", tokenOf(url));
    expect(codeSentTo("100")).toBeUndefined();
    // Guessing is capped: five wrong codes end the attempt.
    const wrong = stolenCode === "000000" ? "000001" : "000000";
    for (let attempt = 1; attempt < 5; attempt++) await expect(confirmTelegramLink(people.an, wrong, new Date(), driver)).rejects.toThrow("telegram_wrong_code");
    await expect(confirmTelegramLink(people.an, wrong, new Date(), driver)).rejects.toThrow("telegram_too_many_attempts");
    await expect(confirmTelegramLink(people.an, stolenCode, new Date(), driver)).rejects.toThrow("telegram_no_pending");
    expect(await db().$count(schema.telegramLink)).toBe(0);
  });

  it("refuses unknown, expired and replaced links with the same words", async () => {
    const at = new Date();
    const first = await startTelegramLink(people.an, at);
    const second = await startTelegramLink(people.an, at);
    await start("1", tokenOf(first.url), at);
    await start("2", "link_made-up", at);
    await start("3", tokenOf(second.url), minutes(at, 16));
    expect(sent.map((row) => codeSentTo(row.chatId))).toEqual([undefined, undefined, undefined]);
    expect(new Set(sent.map((row) => row.message.title)).size).toBe(1);
  });

  it("expires the code, and does not resend it for a double press", async () => {
    const at = new Date();
    const { url } = await startTelegramLink(people.an, at);
    await start("100", tokenOf(url), at);
    await start("100", tokenOf(url), minutes(at, 0.1));
    expect(sent).toHaveLength(1);
    await expect(confirmTelegramLink(people.an, codeSentTo("100")!, minutes(at, 11), driver)).rejects.toThrow("telegram_no_pending");
  });

  it("keeps one live link per person and per chat", async () => {
    await link(people.an, "shared");
    await link(people.binh, "shared");
    expect((await getTelegramStatus(people.an)).link).toBeNull();
    expect((await getTelegramStatus(people.binh)).link).not.toBeNull();
    const [old] = await db().select().from(schema.telegramLink).where(eq(schema.telegramLink.personId, people.an));
    expect(old.revokedReason).toBe("replaced");
  });

  it("stops from Telegram with /stop, and from the app", async () => {
    await link(people.an, "100");
    await handleTelegramEvent({ type: "text", chatId: "100", text: "/stop" }, new Date(), driver);
    expect((await getTelegramStatus(people.an)).link).toBeNull();

    await link(people.an, "100");
    expect(await unlinkTelegram(people.an)).toBe(1);
    expect((await getTelegramStatus(people.an)).link).toBeNull();
    // Anything else is answered, never with data.
    sent = [];
    await handleTelegramEvent({ type: "text", chatId: "100", text: "lương tháng này bao nhiêu?" }, new Date(), driver);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.link).toBe("https://suzu.one/notifications");
  });
});

describe("delivery", () => {
  const approval = (recipients: string[]) => notify({ recipients, kind: "approvals.requested", params: { requester: "Huy", requestType: "leave" }, link: "/approvals" });
  const payslip = (recipients: string[]) => notify({ recipients, kind: "payroll.payslip_published", params: { month: "09/2026" }, link: "/payslips" });

  it("sends the words for ordinary categories and only 'something new' for sensitive ones", async () => {
    await link(people.an, "100");
    await db().delete(schema.telegramDelivery);
    await approval([people.an, people.binh]);
    await payslip([people.an]);
    const queued = await db().select().from(schema.telegramDelivery);
    // Binh has no link: nothing is queued for him.
    expect(queued.map((row) => row.personId)).toEqual([people.an, people.an]);
    expect(queued[0].title).toContain("Huy");
    expect(queued[1].title).toBe("Bạn có thông báo mới: Lương & bảng lương");
    expect(queued[1].body).not.toContain("09/2026");

    expect(await deliverPendingTelegrams(100, () => new Date(), driver)).toEqual({ sent: 2, simulated: 0, failed: 0, dropped: 0 });
    expect(sent.at(-2)).toMatchObject({ chatId: "100", message: { link: "https://suzu.one/approvals" } });
    expect((await getTelegramStatus(people.an)).link?.lastSuccessAt).not.toBeNull();
  });

  it("drops, unsent, whatever is queued for a link that was revoked or a person who may no longer receive", async () => {
    await link(people.an, "100");
    await link(people.other, "200");
    await db().delete(schema.telegramDelivery);
    await approval([people.an, people.other]);
    await unlinkTelegram(people.an);
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, people.other));
    sent = [];
    expect(await deliverPendingTelegrams(100, () => new Date(), driver)).toEqual({ sent: 0, simulated: 0, failed: 0, dropped: 2 });
    expect(sent).toEqual([]);
    const reasons = (await db().select().from(schema.telegramDelivery)).map((row) => row.lastError).sort();
    expect(reasons).toEqual(["link revoked (unlinked)", "person is offboarded"]);
  });

  it("revokes a chat that blocked the bot, and retries other failures up to five times", async () => {
    await link(people.an, "100");
    await db().delete(schema.telegramDelivery);
    await approval([people.an]);
    nextResult = { status: "failed", error: "429 Too Many Requests" };
    for (let attempt = 0; attempt < 6; attempt++) await deliverPendingTelegrams(100, () => new Date(), driver);
    const [row] = await db().select().from(schema.telegramDelivery);
    expect(row).toMatchObject({ status: "failed", attempts: 5 });

    await approval([people.an]);
    nextResult = { status: "unreachable", error: "403 bot was blocked by the user" };
    expect((await deliverPendingTelegrams(100, () => new Date(), driver)).dropped).toBe(1);
    expect((await getTelegramStatus(people.an)).link).toBeNull();
  });

  it("delivers to Messenger and Telegram side by side", async () => {
    await link(people.an, "100");
    // A Messenger link made directly: this test is about notify() fanning out, not Messenger's linking.
    await db().insert(schema.messengerLink).values({ personId: people.an, psid: "psid-an" });
    await db().delete(schema.telegramDelivery);
    await approval([people.an]);
    expect(await db().$count(schema.telegramDelivery)).toBe(1);
    expect(await db().$count(schema.messengerDelivery)).toBe(1);
    await db().delete(schema.messengerDelivery);
    await db().delete(schema.messengerLink);
  });
});
