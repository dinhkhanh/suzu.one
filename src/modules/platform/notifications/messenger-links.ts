// Who a Messenger account belongs to (docs/MESSENGER.md).
//
// A Page-scoped ID (PSID) is just "somebody on Messenger". It becomes a person's delivery address
// only through a two-sided proof:
//   1. The signed-in person asks to connect. The app mints a one-time token and opens
//      m.me/<page>?ref=<token>. Meta hands the token back to the webhook — signed with the app
//      secret — together with the PSID of whoever opened it. The first PSID to present a live
//      token is attached to the attempt and gets a six-digit code from the bot; nobody else can.
//   2. The person types that code into the app, in the same signed-in session's account.
// So the Messenger account proved it holds the token, and the app account proved it can read that
// Messenger account's chat. A leaked link (a screenshot, a shoulder) gets its finder a code in
// their own Messenger that they cannot type into anybody else's session.
//
// Tokens and codes are stored only as hashes, expire in minutes, and five wrong codes end the attempt.
import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { cached, TTL } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import vi from "../../../../messages/vi.json";
import { type InboundEvent, type MessengerDriver, messengerConnectUrl, messengerDriverFor } from "./messenger";
import { invalidateMessengerStatus, messengerStatusKey } from "./messenger-outbox";
import { notify } from "./service";

/** Prefix of the m.me `ref`, so a ref meant for something else one day is never taken for a link. */
const REF_PREFIX = "link.";
const TOKEN_TTL_MINUTES = 15;
/** How long the person has to type the code once the bot sent it. */
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** A second tap on the link within this time does not send a second code. */
const RESEND_AFTER_SECONDS = 30;

/** What a person types into Messenger to stop the deliveries, lower-cased and without accents too. */
const STOP_WORDS = new Set(["stop", "unlink", "dừng", "dung", "hủy", "huỷ", "huy", "hủy liên kết", "huỷ liên kết", "huy lien ket"]);

// The bot speaks Vietnamese, like the emails and the lock-screen text.
const botText = createTranslator({ locale: "vi", messages: vi, namespace: "notifications.messenger.bot" });

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHashOf = (requestId: string, code: string) => sha256(`${requestId}:${code}`);
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const appUrl = (path: string) => new URL(path, env().BETTER_AUTH_URL).toString();

// ── The person's status, for the notifications page ─────────────────────────────────────────

export type MessengerStatus = {
  link: { linkedAt: Date; lastSuccessAt: Date | null } | null;
  /** An attempt still open: waiting for the person to open the link, or for them to type the code. */
  pending: { expiresAt: Date; codeSent: boolean } | null;
};


export async function getMessengerStatus(personId: string, now: Date = new Date()): Promise<MessengerStatus> {
  const status = await cached(messengerStatusKey(personId), TTL.personal, async (): Promise<MessengerStatus> => {
    const [[link], [pending]] = await Promise.all([
      db()
        .select({ linkedAt: schema.messengerLink.linkedAt, lastSuccessAt: schema.messengerLink.lastSuccessAt })
        .from(schema.messengerLink)
        .where(and(eq(schema.messengerLink.personId, personId), isNull(schema.messengerLink.revokedAt)))
        .limit(1),
      db()
        .select({ expiresAt: schema.messengerLinkRequest.expiresAt, codeSentAt: schema.messengerLinkRequest.codeSentAt })
        .from(schema.messengerLinkRequest)
        .where(and(eq(schema.messengerLinkRequest.personId, personId), isNull(schema.messengerLinkRequest.closedAt)))
        .orderBy(desc(schema.messengerLinkRequest.createdAt))
        .limit(1),
    ]);
    return { link: link ?? null, pending: pending ? { expiresAt: pending.expiresAt, codeSent: pending.codeSentAt !== null } : null };
  });
  // Expiry is a matter of time, not of a write: decided on every read.
  return { ...status, pending: status.pending && status.pending.expiresAt > now ? status.pending : null };
}

// ── Step 1: the link ────────────────────────────────────────────────────────────────────────

/** A fresh attempt for the caller; any earlier open attempt of theirs is closed. Returns the m.me URL. */
export async function startMessengerLink(personId: string, now: Date = new Date()): Promise<{ url: string; expiresAt: Date }> {
  const token = `${REF_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000);
  await db().transaction(async (tx) => {
    await tx
      .update(schema.messengerLinkRequest)
      .set({ closedAt: now })
      .where(and(eq(schema.messengerLinkRequest.personId, personId), isNull(schema.messengerLinkRequest.closedAt)));
    await tx.insert(schema.messengerLinkRequest).values({ personId, tokenHash: sha256(token), expiresAt, createdAt: now });
  });
  await invalidateMessengerStatus(personId);
  return { url: messengerConnectUrl(token), expiresAt };
}

/**
 * Somebody on Messenger opened a connect link. The first PSID to present a live token owns the
 * attempt and receives a code; a different PSID is told the link is spent. Never says whose link
 * it was: the reply is the same for an unknown, expired or taken token.
 */
async function receiveRef(driver: MessengerDriver, psid: string, ref: string, now: Date): Promise<void> {
  const request = ref.startsWith(REF_PREFIX)
    ? (
        await db()
          .select()
          .from(schema.messengerLinkRequest)
          .where(and(eq(schema.messengerLinkRequest.tokenHash, sha256(ref)), isNull(schema.messengerLinkRequest.closedAt), gt(schema.messengerLinkRequest.expiresAt, now)))
          .limit(1)
      )[0]
    : undefined;
  if (!request || (request.psid !== null && request.psid !== psid)) {
    await reply(driver, psid, botText("linkInvalid"), appUrl("/notifications"));
    return;
  }
  // Meta may deliver the same event twice, and people tap twice: one code per half-minute.
  if (request.codeSentAt && now.getTime() - request.codeSentAt.getTime() < RESEND_AFTER_SECONDS * 1000) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // The PSID is claimed in the same statement that checks nobody else has: two accounts racing on
  // one link cannot both get a code.
  const [claimed] = await db()
    .update(schema.messengerLinkRequest)
    .set({ psid, codeHash: codeHashOf(request.id, code), codeSentAt: now, attempts: 0, expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000) })
    .where(and(eq(schema.messengerLinkRequest.id, request.id), isNull(schema.messengerLinkRequest.closedAt), or(isNull(schema.messengerLinkRequest.psid), eq(schema.messengerLinkRequest.psid, psid))))
    .returning({ id: schema.messengerLinkRequest.id });
  if (!claimed) {
    await reply(driver, psid, botText("linkInvalid"), appUrl("/notifications"));
    return;
  }
  await invalidateMessengerStatus(request.personId);
  await reply(driver, psid, botText("code", { code, minutes: CODE_TTL_MINUTES }), null);
}

// ── Step 2: the code ────────────────────────────────────────────────────────────────────────

/**
 * The caller types the code the bot sent. Only the caller's own open attempt is looked at, so a
 * code can never attach a Messenger account to anybody but the person who started the attempt.
 */
export async function confirmMessengerLink(personId: string, code: string, now: Date = new Date(), driver: MessengerDriver = messengerDriverFor()): Promise<{ linkId: string }> {
  const [request] = await db()
    .select()
    .from(schema.messengerLinkRequest)
    .where(and(eq(schema.messengerLinkRequest.personId, personId), isNull(schema.messengerLinkRequest.closedAt), isNotNull(schema.messengerLinkRequest.psid), gt(schema.messengerLinkRequest.expiresAt, now)))
    .orderBy(desc(schema.messengerLinkRequest.createdAt))
    .limit(1);
  if (!request?.psid || !request.codeHash) throw new ActionError("messenger_no_pending");

  if (!sameHash(request.codeHash, codeHashOf(request.id, code))) {
    const attempts = request.attempts + 1;
    await db()
      .update(schema.messengerLinkRequest)
      .set({ attempts, closedAt: attempts >= MAX_ATTEMPTS ? now : null })
      .where(eq(schema.messengerLinkRequest.id, request.id));
    await invalidateMessengerStatus(personId);
    throw new ActionError(attempts >= MAX_ATTEMPTS ? "messenger_too_many_attempts" : "messenger_wrong_code");
  }

  const psid = request.psid;
  const { linkId, replaced } = await db().transaction(async (tx) => {
    // Spend the attempt first: of two submissions of the right code, one links and one finds nothing.
    const [spent] = await tx
      .update(schema.messengerLinkRequest)
      .set({ closedAt: now })
      .where(and(eq(schema.messengerLinkRequest.id, request.id), isNull(schema.messengerLinkRequest.closedAt)))
      .returning({ id: schema.messengerLinkRequest.id });
    if (!spent) throw new ActionError("messenger_no_pending");
    // One live link per person and per Messenger account: this person's old account, and this
    // account's old person, stop receiving now.
    const old = await tx
      .update(schema.messengerLink)
      .set({ revokedAt: now, revokedReason: "replaced" })
      .where(and(isNull(schema.messengerLink.revokedAt), or(eq(schema.messengerLink.personId, personId), eq(schema.messengerLink.psid, psid))))
      .returning({ personId: schema.messengerLink.personId });
    // Opening the link was a message to the Page: the 24-hour window starts there.
    const [link] = await tx.insert(schema.messengerLink).values({ personId, psid, linkedAt: now, lastInboundAt: request.codeSentAt ?? now }).returning({ id: schema.messengerLink.id });
    return { linkId: link.id, replaced: old.map((row) => row.personId) };
  });
  await invalidateMessengerStatus(personId, ...replaced);
  await reply(driver, psid, botText("linked"), appUrl("/notifications"));
  // A security notice to every channel the person has, the new one included: if it was not them,
  // their email says so.
  await notify({ recipients: [personId], kind: "security.messenger_linked", params: {}, link: "/notifications" });
  return { linkId };
}

// ── Unlinking ───────────────────────────────────────────────────────────────────────────────

/** From the app: the caller's own link, and any attempt still open. */
export async function unlinkMessenger(personId: string, now: Date = new Date()): Promise<number> {
  const rows = await db()
    .update(schema.messengerLink)
    .set({ revokedAt: now, revokedReason: "unlinked" })
    .where(and(eq(schema.messengerLink.personId, personId), isNull(schema.messengerLink.revokedAt)))
    .returning({ psid: schema.messengerLink.psid });
  await db()
    .update(schema.messengerLinkRequest)
    .set({ closedAt: now })
    .where(and(eq(schema.messengerLinkRequest.personId, personId), isNull(schema.messengerLinkRequest.closedAt)));
  await invalidateMessengerStatus(personId);
  return rows.length;
}

// ── The webhook's events ────────────────────────────────────────────────────────────────────

async function reply(driver: MessengerDriver, psid: string, text: string, link: string | null): Promise<void> {
  // A reply to what the person just sent: always inside the window. A failure is only logged —
  // Meta retries the webhook on an error, and re-running a whole call to resend a reply is worse.
  const result = await driver.sendStandard(psid, { title: text, body: "", link }, "RESPONSE");
  if (result.status !== "sent" && result.status !== "simulated") console.error(JSON.stringify({ level: "error", event: "messenger.reply_failed", status: result.status, error: result.error }));
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Handles what arrived at the webhook, already verified as Meta's and as this Page's. The bot
 * holds no conversation: it links, it stops, and to anything else it says what it is for. It never
 * answers a question with data — whatever the person wants to read is behind the app's sign-in.
 */
export async function handleMessengerEvents(events: readonly InboundEvent[], now: Date = new Date(), driver: MessengerDriver = messengerDriverFor()): Promise<void> {
  for (const event of events) {
    // Any input reopens Meta's 24-hour window for this account.
    const [live] = await db()
      .update(schema.messengerLink)
      .set({ lastInboundAt: now })
      .where(and(eq(schema.messengerLink.psid, event.psid), isNull(schema.messengerLink.revokedAt)))
      .returning({ id: schema.messengerLink.id, personId: schema.messengerLink.personId });

    if (event.type === "ref") {
      await receiveRef(driver, event.psid, event.ref, now);
    } else if (event.type === "text" && STOP_WORDS.has(normalise(event.text))) {
      if (live) {
        await db().update(schema.messengerLink).set({ revokedAt: now, revokedReason: "stopped" }).where(eq(schema.messengerLink.id, live.id));
        await invalidateMessengerStatus(live.personId);
      }
      await reply(driver, event.psid, botText(live ? "stopped" : "notLinked"), appUrl("/notifications"));
    } else {
      await reply(driver, event.psid, botText(live ? "help" : "notLinked"), appUrl("/notifications"));
    }
  }
}
