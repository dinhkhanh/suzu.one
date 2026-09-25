// Who a Messenger account belongs to, and what it is sent (docs/MESSENGER.md). The Meta side is a
// fake driver that records what the bot would have said to which PSID.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", MESSENGER_TEMPLATE_LANGUAGE: "vi" }) }));
vi.mock("./email", () => ({ sendEmail: vi.fn().mockResolvedValue({ status: "sent" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import type { MessengerDriver, MessengerMessage, MessengerResult } from "./messenger";
import { confirmMessengerLink, getMessengerStatus, handleMessengerEvents, startMessengerLink, unlinkMessenger } from "./messenger-links";
import { deliverPendingMessengers } from "./messenger-outbox";
import { notify } from "./service";

const people = {} as Record<"an" | "binh" | "suspended", string>;

type Sent = { psid: string; message: MessengerMessage; via: "standard" | "utility"; type?: string };
let sent: Sent[] = [];
let nextResult: MessengerResult | null = null;
const driver: MessengerDriver = {
  name: "messenger",
  hasUtilityTemplate: true,
  sendStandard: async (psid, message, type) => {
    sent.push({ psid, message, via: "standard", type });
    return nextResult ?? { status: "sent" };
  },
  sendUtility: async (psid, message) => {
    sent.push({ psid, message, via: "utility" });
    return nextResult ?? { status: "sent" };
  },
};

const tokenOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("ref")!);
const codeSentTo = (psid: string) => sent.filter((row) => row.psid === psid).at(-1)?.message.title.match(/\b(\d{6})\b/)?.[1];
const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);

/** The whole happy path: start, open the link from `psid`, type the code. */
async function link(personId: string, psid: string, at = new Date()) {
  const { url } = await startMessengerLink(personId, at);
  await handleMessengerEvents([{ type: "ref", psid, ref: tokenOf(url) }], at, driver);
  return confirmMessengerLink(personId, codeSentTo(psid)!, at, driver);
}

beforeAll(async () => {
  await migrateTestDb();
  const rows = await db()
    .insert(schema.person)
    .values([
      { fullName: "An", searchName: "an", workEmail: "an@suzu.vn", status: "active" },
      { fullName: "Binh", searchName: "binh", workEmail: "binh@suzu.vn", status: "active" },
      { fullName: "Sus", searchName: "sus", status: "active" },
    ])
    .returning();
  Object.assign(people, { an: rows[0].id, binh: rows[1].id, suspended: rows[2].id });
});

beforeEach(async () => {
  sent = [];
  nextResult = null;
  await db().delete(schema.messengerDelivery);
  await db().delete(schema.messengerLink);
  await db().delete(schema.messengerLinkRequest);
  await db().delete(schema.notification);
  await db().delete(schema.emailOutbox);
  await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, people.suspended));
});

describe("linking", () => {
  it("links only after the Messenger account got the code and the signed-in person typed it back", async () => {
    const { url } = await startMessengerLink(people.an);
    expect(url).toMatch(/^https:\/\/m\.me\/[^?]+\?ref=link\./);
    expect((await getMessengerStatus(people.an)).pending).toMatchObject({ codeSent: false });

    await handleMessengerEvents([{ type: "ref", psid: "psid-an", ref: tokenOf(url) }], new Date(), driver);
    const code = codeSentTo("psid-an");
    expect(code).toMatch(/^\d{6}$/);
    // The reply names nobody: whoever opened the link learns no one's identity from it.
    expect(sent[0].message.title).not.toContain("An");
    expect(sent[0].type).toBe("RESPONSE");

    await confirmMessengerLink(people.an, code!, new Date(), driver);
    const status = await getMessengerStatus(people.an);
    expect(status.link).not.toBeNull();
    expect(status.pending).toBeNull();
    // A security notice goes out about it: in the app, by email, and as a generic Messenger line.
    const [notice] = await db().select().from(schema.notification).where(eq(schema.notification.recipientPersonId, people.an));
    expect(notice.kind).toBe("security.messenger_linked");
    expect(await db().$count(schema.emailOutbox)).toBe(1);
    // The token and the code are stored only as hashes.
    const [request] = await db().select().from(schema.messengerLinkRequest);
    expect(request.tokenHash).not.toContain(tokenOf(url));
    expect(request.codeHash).not.toContain(code!);
  });

  it("gives a leaked link's finder a code they cannot use, and locks the real owner's Messenger out of that attempt", async () => {
    const { url } = await startMessengerLink(people.an);
    // Somebody else opens An's link first: the code goes to *their* Messenger.
    await handleMessengerEvents([{ type: "ref", psid: "psid-mallory", ref: tokenOf(url) }], new Date(), driver);
    const stolenCode = codeSentTo("psid-mallory")!;
    // The finder has the code but no session of An's: typing it as themselves reaches nothing.
    await expect(confirmMessengerLink(people.binh, stolenCode, new Date(), driver)).rejects.toThrow("messenger_no_pending");
    // A second Messenger account on the same link gets no code at all.
    await handleMessengerEvents([{ type: "ref", psid: "psid-an", ref: tokenOf(url) }], new Date(), driver);
    expect(codeSentTo("psid-an")).toBeUndefined();
    // An, not having the code, cannot guess it: five wrong codes end the attempt.
    const wrong = stolenCode === "000000" ? "000001" : "000000";
    for (let attempt = 1; attempt < 5; attempt++) await expect(confirmMessengerLink(people.an, wrong, new Date(), driver)).rejects.toThrow("messenger_wrong_code");
    await expect(confirmMessengerLink(people.an, wrong, new Date(), driver)).rejects.toThrow("messenger_too_many_attempts");
    await expect(confirmMessengerLink(people.an, stolenCode, new Date(), driver)).rejects.toThrow("messenger_no_pending");
    expect(await db().$count(schema.messengerLink)).toBe(0);
  });

  it("refuses unknown, expired and replaced links without saying whose they were", async () => {
    const start = new Date();
    const first = await startMessengerLink(people.an, start);
    const second = await startMessengerLink(people.an, start);
    await handleMessengerEvents([{ type: "ref", psid: "p1", ref: tokenOf(first.url) }], start, driver);
    await handleMessengerEvents([{ type: "ref", psid: "p2", ref: "link.made-up" }], start, driver);
    await handleMessengerEvents([{ type: "ref", psid: "p3", ref: tokenOf(second.url) }], minutes(start, 16), driver);
    expect(sent.map((row) => codeSentTo(row.psid))).toEqual([undefined, undefined, undefined]);
    expect(new Set(sent.map((row) => row.message.title)).size).toBe(1);
  });

  it("expires the code, and does not resend it for a double tap", async () => {
    const start = new Date();
    const { url } = await startMessengerLink(people.an, start);
    await handleMessengerEvents([{ type: "ref", psid: "psid-an", ref: tokenOf(url) }], start, driver);
    await handleMessengerEvents([{ type: "ref", psid: "psid-an", ref: tokenOf(url) }], minutes(start, 0.1), driver);
    expect(sent).toHaveLength(1);
    await expect(confirmMessengerLink(people.an, codeSentTo("psid-an")!, minutes(start, 11), driver)).rejects.toThrow("messenger_no_pending");
  });

  it("keeps one live link per person and per Messenger account", async () => {
    await link(people.an, "shared-psid");
    await link(people.binh, "shared-psid");
    expect((await getMessengerStatus(people.an)).link).toBeNull();
    expect((await getMessengerStatus(people.binh)).link).not.toBeNull();
    const [old] = await db().select().from(schema.messengerLink).where(eq(schema.messengerLink.personId, people.an));
    expect(old.revokedReason).toBe("replaced");
  });

  it("stops from Messenger with a stop word, and from the app", async () => {
    await link(people.an, "psid-an");
    await handleMessengerEvents([{ type: "text", psid: "psid-an", text: "  Dừng " }], new Date(), driver);
    expect((await getMessengerStatus(people.an)).link).toBeNull();

    await link(people.an, "psid-an");
    expect(await unlinkMessenger(people.an)).toBe(1);
    expect((await getMessengerStatus(people.an)).link).toBeNull();
    // Anything else is answered, never with data.
    sent = [];
    await handleMessengerEvents([{ type: "text", psid: "psid-an", text: "lương tháng này bao nhiêu?" }], new Date(), driver);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.link).toBe("https://suzu.one/notifications");
  });
});

describe("delivery", () => {
  const approval = (recipients: string[]) => notify({ recipients, kind: "approvals.requested", params: { requester: "Huy", requestType: "leave" }, link: "/approvals" });
  const payslip = (recipients: string[]) => notify({ recipients, kind: "payroll.payslip_published", params: { month: "09/2026" }, link: "/payslips" });

  it("sends the words for ordinary categories and only 'something new' for sensitive ones", async () => {
    await link(people.an, "psid-an");
    await db().delete(schema.messengerDelivery);
    await approval([people.an, people.binh]);
    await payslip([people.an]);
    const queued = await db().select().from(schema.messengerDelivery);
    // Binh has no link: nothing is queued for him.
    expect(queued.map((row) => row.personId)).toEqual([people.an, people.an]);
    expect(queued[0].title).toContain("Huy");
    expect(queued[1].title).toBe("Bạn có thông báo mới: Lương & bảng lương");
    expect(queued[1].body).not.toContain("09/2026");
  });

  it("writes freely inside Meta's 24-hour window and uses the approved template outside it", async () => {
    const start = new Date();
    await link(people.an, "psid-an", start);
    await db().delete(schema.messengerDelivery);
    sent = [];
    await approval([people.an]);
    expect(await deliverPendingMessengers(100, () => minutes(start, 60), driver)).toEqual({ sent: 1, simulated: 0, failed: 0, dropped: 0 });
    expect(sent[0]).toMatchObject({ psid: "psid-an", via: "standard", type: "UPDATE", message: { link: "https://suzu.one/approvals" } });

    await approval([people.an]);
    await deliverPendingMessengers(100, () => minutes(start, 25 * 60), driver);
    expect(sent[1].via).toBe("utility");

    // Meta says the window closed before our clock did: the template goes instead.
    await approval([people.an]);
    nextResult = { status: "outside_window", error: "10/2018278" };
    const tally = await deliverPendingMessengers(100, () => minutes(start, 60), driver);
    expect(sent.slice(2).map((row) => row.via)).toEqual(["standard", "utility"]);
    expect(tally.failed).toBe(1);
  });

  it("drops, unsent, whatever is queued for a link that was revoked or a person who may no longer receive", async () => {
    await link(people.an, "psid-an");
    await link(people.suspended, "psid-sus");
    await db().delete(schema.messengerDelivery);
    await approval([people.an, people.suspended]);
    await unlinkMessenger(people.an);
    await db().update(schema.person).set({ status: "suspended" }).where(eq(schema.person.id, people.suspended));
    sent = [];
    expect(await deliverPendingMessengers(100, () => new Date(), driver)).toEqual({ sent: 0, simulated: 0, failed: 0, dropped: 2 });
    expect(sent).toEqual([]);
    const reasons = (await db().select().from(schema.messengerDelivery)).map((row) => row.lastError).sort();
    expect(reasons).toEqual(["link revoked (unlinked)", "person is suspended"]);
    // And nothing new is queued for the suspended person.
    await approval([people.suspended]);
    expect(await db().$count(schema.messengerDelivery, eq(schema.messengerDelivery.status, "pending"))).toBe(0);
  });

  it("revokes a link Meta says is gone", async () => {
    await link(people.an, "psid-an");
    await db().delete(schema.messengerDelivery);
    await approval([people.an]);
    nextResult = { status: "unreachable", error: "551" };
    expect((await deliverPendingMessengers(100, () => new Date(), driver)).dropped).toBe(1);
    expect((await getMessengerStatus(people.an)).link).toBeNull();
  });
});
