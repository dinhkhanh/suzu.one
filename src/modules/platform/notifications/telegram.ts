// Telegram behind an adapter (docs/TELEGRAM.md), the same shape as web push and Chat:
//  - "telegram": the Bot API, when the bot's token, its username and the webhook secret are all
//    configured;
//  - "local": otherwise nothing leaves the machine; deliveries are recorded as "simulated".
//
// Every message is sent with `protect_content`: Telegram then refuses to let it be forwarded or
// saved, so a notice stays in the one chat it was addressed to.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Telegram's limit for a message's text. */
const TEXT_LIMIT = 4096;

export type TelegramMessage = { title: string; body: string; /** Absolute; becomes the message's one button. */ link: string | null };
export type TelegramResult =
  | { status: "sent" }
  | { status: "simulated" }
  /** The person blocked the bot, deleted their account, or the chat does not exist: the link is dead. */
  | { status: "unreachable"; error: string }
  | { status: "failed"; error: string };

export type TelegramDriver = { name: "telegram" | "local"; send: (chatId: string, message: TelegramMessage) => Promise<TelegramResult> };

const localDriver: TelegramDriver = { name: "local", send: async () => ({ status: "simulated" }) };

const truncate = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

/**
 * The body of `sendMessage`. Plain text (no parse mode), so nothing in a title can be read as
 * markup; no link previews; protected from forwarding and saving. The button only appears for an
 * https link — Telegram refuses anything else, and the app never needs anything else.
 */
export function sendMessageBody(chatId: string, message: TelegramMessage, buttonText: string): Record<string, unknown> {
  const text = truncate([message.title, message.body].filter(Boolean).join("\n"), TEXT_LIMIT);
  const button = message.link?.startsWith("https://") ? { reply_markup: { inline_keyboard: [[{ text: buttonText, url: message.link }]] } } : {};
  return { chat_id: chatId, text, protect_content: true, link_preview_options: { is_disabled: true }, ...button };
}

/** Turns a Bot API answer into what the outbox records. */
export function classifyTelegramResponse(status: number, answer: { ok?: boolean; error_code?: number; description?: string }): Exclude<TelegramResult, { status: "simulated" }> {
  if (answer.ok) return { status: "sent" };
  const error = `${answer.error_code ?? status} ${(answer.description ?? "").slice(0, 300)}`.trim();
  // 403: "bot was blocked by the user", "user is deactivated". 400 "chat not found": never started.
  if ((answer.error_code ?? status) === 403 || /chat not found/i.test(answer.description ?? "")) return { status: "unreachable", error };
  return { status: "failed", error };
}

/** The token sits in the Bot API's URL path: every error that could echo a URL is scrubbed of it. */
const scrub = (text: string, token: string) => text.replaceAll(token, "<token>");

function telegramDriver(token: string): TelegramDriver {
  return {
    name: "telegram",
    send: async (chatId, message) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sendMessageBody(chatId, message, "Mở SuZu One")),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        const result = classifyTelegramResponse(response.status, (await response.json().catch(() => ({}))) as { ok?: boolean; error_code?: number; description?: string });
        return result.status === "sent" ? result : { ...result, error: scrub(result.error, token) };
      } catch (error) {
        return { status: "failed", error: scrub(error instanceof Error ? error.message : String(error), token) };
      }
    },
  };
}

export type TelegramConfig = { token: string; username: string; webhookSecret: string };

/** Everything the real driver and the webhook need, or null when Telegram is not configured. */
export function telegramConfig(): TelegramConfig | null {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: username, TELEGRAM_WEBHOOK_SECRET: webhookSecret } = env();
  return token && username && webhookSecret ? { token, username, webhookSecret } : null;
}

export function telegramDriverFor(): TelegramDriver {
  const config = telegramConfig();
  return config ? telegramDriver(config.token) : localDriver;
}

/**
 * Where the "connect Telegram" button sends the person: the bot, with the one-time token as the
 * `start` parameter, which Telegram delivers to the webhook as "/start <token>" from the chat that
 * pressed Start. Without a configured bot the local development link points at nothing real.
 */
export function telegramConnectUrl(token: string): string {
  return `https://t.me/${telegramConfig()?.username ?? "SuZuOneBot"}?start=${token}`;
}

// ── The webhook ─────────────────────────────────────────────────────────────────────────────

/**
 * Telegram sends the secret given to setWebhook in `X-Telegram-Bot-Api-Secret-Token` on every
 * call. Anything without it — somebody who found the URL — is refused before it is parsed.
 */
export function verifyWebhookSecret(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the bot acts on; everything else in an update is ignored. */
export type InboundEvent =
  /** "/start <payload>": the person opened a t.me link with a start parameter. */
  | { type: "start"; chatId: string; payload: string }
  | { type: "text"; chatId: string; text: string }
  /** Any other message in a private chat (a sticker, a photo, /start without a payload). */
  | { type: "other"; chatId: string };

type RawUpdate = { message?: { chat?: { id?: number | string; type?: string }; from?: { id?: number | string; is_bot?: boolean }; text?: string } };

/**
 * The input of one update. **Private chats only**: anyone can add a bot to a group, and a link
 * pressed there would send one person's notifications to the whole group. In a private chat the
 * chat is the user (`chat.id === from.id`), which is checked too.
 */
export function parseUpdate(body: unknown): InboundEvent | null {
  const message = (body as RawUpdate | null)?.message;
  if (!message?.chat || message.chat.type !== "private" || !message.from || message.from.is_bot) return null;
  const chatId = String(message.chat.id);
  if (chatId !== String(message.from.id)) return null;
  const text = message.text;
  if (typeof text !== "string") return { type: "other", chatId };
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text);
  if (start) return start[1] ? { type: "start", chatId, payload: start[1] } : { type: "other", chatId };
  return { type: "text", chatId, text };
}
