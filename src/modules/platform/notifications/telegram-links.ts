// Who a Telegram chat belongs to (docs/TELEGRAM.md).
//
// A chat id is just "somebody on Telegram". It becomes a person's delivery address only through a
// two-sided proof:
//   1. The signed-in person asks to connect. The app mints a one-time token and opens
//      t.me/<bot>?start=<token>. Pressing Start sends "/start <token>" from that private chat to
//      the webhook, which Telegram authenticates with the secret registered at setWebhook. The
//      first chat to present a live token is attached to the attempt and gets a six-digit code
//      from the bot; nobody else can.
//   2. The person types that code into the app, in their own signed-in session.
// So the chat proved it holds the token, and the app account proved it can read that chat. A
// leaked link (a screenshot, a shoulder) gets its finder a code in their own Telegram that they
// cannot type into anybody else's session.
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
import { type InboundEvent, type TelegramDriver, telegramConnectUrl, telegramDriverFor } from "./telegram";
import { invalidateTelegramStatus, telegramStatusKey } from "./telegram-outbox";
import { notify } from "./service";

/**
 * Prefix of the start parameter, so a parameter meant for something else one day is never taken
 * for a link. Telegram allows 64 characters of [A-Za-z0-9_-]: "link_" and 43 of base64url fit.
 */
const START_PREFIX = "link_";
const TOKEN_TTL_MINUTES = 15;
/** How long the person has to type the code once the bot sent it. */
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** A second press of Start within this time does not send a second code. */
const RESEND_AFTER_SECONDS = 30;

/** What a person sends the bot to stop the deliveries, lower-cased; with or without accents. */
const STOP_WORDS = new Set(["/stop", "stop", "unlink", "dừng", "dung", "hủy", "huỷ", "huy", "hủy liên kết", "huỷ liên kết", "huy lien ket"]);

// The bot speaks Vietnamese, like the emails and the lock-screen text.
const botText = createTranslator({ locale: "vi", messages: vi, namespace: "notifications.telegram.bot" });

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHashOf = (requestId: string, code: string) => sha256(`${requestId}:${code}`);
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const appUrl = (path: string) => new URL(path, env().BETTER_AUTH_URL).toString();

// ── The person's status, for the notifications page ─────────────────────────────────────────

export type TelegramStatus = {
  link: { linkedAt: Date; lastSuccessAt: Date | null } | null;
  /** An attempt still open: waiting for the person to open the link, or for them to type the code. */
  pending: { expiresAt: Date; codeSent: boolean } | null;
};

export async function getTelegramStatus(personId: string, now: Date = new Date()): Promise<TelegramStatus> {
  const status = await cached(telegramStatusKey(personId), TTL.personal, async (): Promise<TelegramStatus> => {
    const [[link], [pending]] = await Promise.all([
      db()
        .select({ linkedAt: schema.telegramLink.linkedAt, lastSuccessAt: schema.telegramLink.lastSuccessAt })
        .from(schema.telegramLink)
        .where(and(eq(schema.telegramLink.personId, personId), isNull(schema.telegramLink.revokedAt)))
        .limit(1),
      db()
        .select({ expiresAt: schema.telegramLinkRequest.expiresAt, codeSentAt: schema.telegramLinkRequest.codeSentAt })
        .from(schema.telegramLinkRequest)
        .where(and(eq(schema.telegramLinkRequest.personId, personId), isNull(schema.telegramLinkRequest.closedAt)))
        .orderBy(desc(schema.telegramLinkRequest.createdAt))
        .limit(1),
    ]);
    return { link: link ?? null, pending: pending ? { expiresAt: pending.expiresAt, codeSent: pending.codeSentAt !== null } : null };
  });
  // Expiry is a matter of time, not of a write: decided on every read.
  return { ...status, pending: status.pending && status.pending.expiresAt > now ? status.pending : null };
}

// ── Step 1: the link ────────────────────────────────────────────────────────────────────────

/** A fresh attempt for the caller; any earlier open attempt of theirs is closed. Returns the t.me URL. */
export async function startTelegramLink(personId: string, now: Date = new Date()): Promise<{ url: string; expiresAt: Date }> {
  const token = `${START_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000);
  await db().transaction(async (tx) => {
    await tx
      .update(schema.telegramLinkRequest)
      .set({ closedAt: now })
      .where(and(eq(schema.telegramLinkRequest.personId, personId), isNull(schema.telegramLinkRequest.closedAt)));
    await tx.insert(schema.telegramLinkRequest).values({ personId, tokenHash: sha256(token), expiresAt, createdAt: now });
  });
  await invalidateTelegramStatus(personId);
  return { url: telegramConnectUrl(token), expiresAt };
}

/**
 * A private chat pressed Start on a connect link. The first chat to present a live token owns the
 * attempt and receives a code; a different chat is told the link is spent. Never says whose link
 * it was: the reply is the same for an unknown, expired or taken token.
 */
async function receiveStart(driver: TelegramDriver, chatId: string, payload: string, now: Date): Promise<void> {
  const request = payload.startsWith(START_PREFIX)
    ? (
        await db()
          .select()
          .from(schema.telegramLinkRequest)
          .where(and(eq(schema.telegramLinkRequest.tokenHash, sha256(payload)), isNull(schema.telegramLinkRequest.closedAt), gt(schema.telegramLinkRequest.expiresAt, now)))
          .limit(1)
      )[0]
    : undefined;
  if (!request || (request.chatId !== null && request.chatId !== chatId)) {
    await reply(driver, chatId, botText("linkInvalid"), appUrl("/notifications"));
    return;
  }
  // Telegram may deliver an update twice, and people press twice: one code per half-minute.
  if (request.codeSentAt && now.getTime() - request.codeSentAt.getTime() < RESEND_AFTER_SECONDS * 1000) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // The chat is claimed in the same statement that checks nobody else has: two chats racing on
  // one link cannot both get a code.
  const [claimed] = await db()
    .update(schema.telegramLinkRequest)
    .set({ chatId, codeHash: codeHashOf(request.id, code), codeSentAt: now, attempts: 0, expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000) })
    .where(and(eq(schema.telegramLinkRequest.id, request.id), isNull(schema.telegramLinkRequest.closedAt), or(isNull(schema.telegramLinkRequest.chatId), eq(schema.telegramLinkRequest.chatId, chatId))))
    .returning({ id: schema.telegramLinkRequest.id });
  if (!claimed) {
    await reply(driver, chatId, botText("linkInvalid"), appUrl("/notifications"));
    return;
  }
  await invalidateTelegramStatus(request.personId);
  await reply(driver, chatId, botText("code", { code, minutes: CODE_TTL_MINUTES }), null);
}

// ── Step 2: the code ────────────────────────────────────────────────────────────────────────

/**
 * The caller types the code the bot sent. Only the caller's own open attempt is looked at, so a
 * code can never attach a chat to anybody but the person who started the attempt.
 */
export async function confirmTelegramLink(personId: string, code: string, now: Date = new Date(), driver: TelegramDriver = telegramDriverFor()): Promise<{ linkId: string }> {
  const [request] = await db()
    .select()
    .from(schema.telegramLinkRequest)
    .where(and(eq(schema.telegramLinkRequest.personId, personId), isNull(schema.telegramLinkRequest.closedAt), isNotNull(schema.telegramLinkRequest.chatId), gt(schema.telegramLinkRequest.expiresAt, now)))
    .orderBy(desc(schema.telegramLinkRequest.createdAt))
    .limit(1);
  if (!request?.chatId || !request.codeHash) throw new ActionError("telegram_no_pending");

  if (!sameHash(request.codeHash, codeHashOf(request.id, code))) {
    const attempts = request.attempts + 1;
    await db()
      .update(schema.telegramLinkRequest)
      .set({ attempts, closedAt: attempts >= MAX_ATTEMPTS ? now : null })
      .where(eq(schema.telegramLinkRequest.id, request.id));
    await invalidateTelegramStatus(personId);
    throw new ActionError(attempts >= MAX_ATTEMPTS ? "telegram_too_many_attempts" : "telegram_wrong_code");
  }

  const chatId = request.chatId;
  const { linkId, replaced } = await db().transaction(async (tx) => {
    // Spend the attempt first: of two submissions of the right code, one links and one finds nothing.
    const [spent] = await tx
      .update(schema.telegramLinkRequest)
      .set({ closedAt: now })
      .where(and(eq(schema.telegramLinkRequest.id, request.id), isNull(schema.telegramLinkRequest.closedAt)))
      .returning({ id: schema.telegramLinkRequest.id });
    if (!spent) throw new ActionError("telegram_no_pending");
    // One live link per person and per chat: this person's old chat, and this chat's old person,
    // stop receiving now.
    const old = await tx
      .update(schema.telegramLink)
      .set({ revokedAt: now, revokedReason: "replaced" })
      .where(and(isNull(schema.telegramLink.revokedAt), or(eq(schema.telegramLink.personId, personId), eq(schema.telegramLink.chatId, chatId))))
      .returning({ personId: schema.telegramLink.personId });
    const [link] = await tx.insert(schema.telegramLink).values({ personId, chatId, linkedAt: now }).returning({ id: schema.telegramLink.id });
    return { linkId: link.id, replaced: old.map((row) => row.personId) };
  });
  await invalidateTelegramStatus(personId, ...replaced);
  await reply(driver, chatId, botText("linked"), appUrl("/notifications"));
  // A security notice to every channel the person has, the new one included: if it was not them,
  // their email says so.
  await notify({ recipients: [personId], kind: "security.telegram_linked", params: {}, link: "/notifications" });
  return { linkId };
}

// ── Unlinking ───────────────────────────────────────────────────────────────────────────────

/** From the app: the caller's own link, and any attempt still open. */
export async function unlinkTelegram(personId: string, now: Date = new Date()): Promise<number> {
  const rows = await db()
    .update(schema.telegramLink)
    .set({ revokedAt: now, revokedReason: "unlinked" })
    .where(and(eq(schema.telegramLink.personId, personId), isNull(schema.telegramLink.revokedAt)))
    .returning({ id: schema.telegramLink.id });
  await db()
    .update(schema.telegramLinkRequest)
    .set({ closedAt: now })
    .where(and(eq(schema.telegramLinkRequest.personId, personId), isNull(schema.telegramLinkRequest.closedAt)));
  await invalidateTelegramStatus(personId);
  return rows.length;
}

// ── The webhook's events ────────────────────────────────────────────────────────────────────

async function reply(driver: TelegramDriver, chatId: string, text: string, link: string | null): Promise<void> {
  // A failure is only logged: Telegram retries the webhook on an error, and re-running a whole
  // update to resend a reply is worse.
  const result = await driver.send(chatId, { title: text, body: "", link });
  if (result.status !== "sent" && result.status !== "simulated") console.error(JSON.stringify({ level: "error", event: "telegram.reply_failed", status: result.status, error: result.error }));
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Handles one update, already authenticated as Telegram's and already limited to a private chat.
 * The bot holds no conversation: it links, it stops, and to anything else it says what it is for.
 * It never answers a question with data — whatever the person wants to read is behind the app's
 * sign-in.
 */
export async function handleTelegramEvent(event: InboundEvent, now: Date = new Date(), driver: TelegramDriver = telegramDriverFor()): Promise<void> {
  if (event.type === "start") return receiveStart(driver, event.chatId, event.payload, now);

  const [live] = await db()
    .select({ id: schema.telegramLink.id, personId: schema.telegramLink.personId })
    .from(schema.telegramLink)
    .where(and(eq(schema.telegramLink.chatId, event.chatId), isNull(schema.telegramLink.revokedAt)))
    .limit(1);
  if (event.type === "text" && STOP_WORDS.has(normalise(event.text))) {
    if (live) {
      await db().update(schema.telegramLink).set({ revokedAt: now, revokedReason: "stopped" }).where(eq(schema.telegramLink.id, live.id));
      await invalidateTelegramStatus(live.personId);
    }
    await reply(driver, event.chatId, botText(live ? "stopped" : "notLinked"), appUrl("/notifications"));
    return;
  }
  await reply(driver, event.chatId, botText(live ? "help" : "notLinked"), appUrl("/notifications"));
}
