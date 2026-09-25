// Facebook Messenger behind an adapter (docs/MESSENGER.md), the same shape as web push and Chat:
//  - "messenger": the Send API of the company's Page, when the Page, its token, the app secret
//    and the webhook verify token are all configured;
//  - "local": otherwise nothing leaves the machine; deliveries are recorded as "simulated".
//
// Meta's rules decide how a message may go out. For 24 hours after a person last wrote to the
// Page, it may send them anything ("standard"). Outside that window the old message tags
// (ACCOUNT_UPDATE and friends) are refused since 27 April 2026; the one way left is a utility
// template Meta has approved, filled with parameters ("utility").
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const GRAPH = "https://graph.facebook.com/v26.0";

/** Meta's limit for the text of a button template. */
const TEXT_LIMIT = 640;

export type MessengerMessage = { title: string; body: string; /** Absolute. */ link: string | null };
export type MessengerResult =
  | { status: "sent" }
  | { status: "simulated" }
  /** The person blocked the Page or deleted their account: the link is dead. */
  | { status: "unreachable"; error: string }
  /** Meta refused a free-form message: the 24-hour window closed earlier than we counted. */
  | { status: "outside_window"; error: string }
  | { status: "failed"; error: string };

export type MessengerDriver = {
  name: "messenger" | "local";
  /** Whether a template exists for use outside the 24-hour window. */
  hasUtilityTemplate: boolean;
  /** A free-form message: only inside the 24-hour window, or as a reply to what the person just sent. */
  sendStandard: (psid: string, message: MessengerMessage, messagingType: "RESPONSE" | "UPDATE") => Promise<MessengerResult>;
  /** The approved template, outside the window. */
  sendUtility: (psid: string, message: MessengerMessage) => Promise<MessengerResult>;
};

const localDriver: MessengerDriver = { name: "local", hasUtilityTemplate: true, sendStandard: async () => ({ status: "simulated" }), sendUtility: async () => ({ status: "simulated" }) };

const truncate = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

/** What goes in the Send API's `message` for a free-form notification: the words and one button. */
export function standardPayload(message: MessengerMessage, buttonTitle: string): Record<string, unknown> {
  const text = truncate([message.title, message.body].filter(Boolean).join("\n"), TEXT_LIMIT);
  if (!message.link) return { text };
  return { attachment: { type: "template", payload: { template_type: "button", text, buttons: [{ type: "web_url", url: message.link, title: buttonTitle }] } } };
}

/**
 * The utility template's parameters: `{{1}}` in the body is the title, and the URL button is the
 * app's origin with the notification's path as its suffix — so the template can only ever open a
 * page of this app, whatever a parameter says.
 */
export function utilityPayload(template: { name: string; language: string }, message: MessengerMessage, appOrigin: string): Record<string, unknown> {
  const suffix = message.link && message.link.startsWith(`${appOrigin}/`) ? message.link.slice(appOrigin.length + 1) : "notifications";
  return {
    template: {
      name: template.name,
      language: { code: template.language },
      components: [
        { type: "body", parameters: [{ type: "text", text: truncate(message.title, 200) }] },
        { type: "buttons", parameters: [{ type: "URL", url: suffix }] },
      ],
    },
  };
}

type GraphError = { code?: number; error_subcode?: number; message?: string };

/** Turns a Graph API answer into what the outbox records. */
export function classifyGraphResponse(status: number, error: GraphError | undefined): MessengerResult {
  if (status >= 200 && status < 300 && !error) return { status: "sent" };
  const text = `${status} ${error?.code ?? "?"}/${error?.error_subcode ?? "-"} ${(error?.message ?? "").slice(0, 300)}`.trim();
  // 551: "This person isn't available right now". 100/2018001: "No matching user found".
  if (error?.code === 551 || (error?.code === 100 && error.error_subcode === 2018001)) return { status: "unreachable", error: text };
  // 10/2018278: "Message sent outside of allowed window".
  if (error?.code === 10 && error.error_subcode === 2018278) return { status: "outside_window", error: text };
  return { status: "failed", error: text };
}

/** Proves to Meta that the call comes from the app that owns the token (Graph's appsecret_proof). */
export const appSecretProof = (accessToken: string, appSecret: string) => createHmac("sha256", appSecret).update(accessToken).digest("hex");

function messengerDriver(config: { pageId: string; accessToken: string; appSecret: string; template: { name: string; language: string } | null; appOrigin: string }): MessengerDriver {
  const post = async (body: Record<string, unknown>): Promise<MessengerResult> => {
    try {
      const url = `${GRAPH}/${config.pageId}/messages?appsecret_proof=${appSecretProof(config.accessToken, config.appSecret)}`;
      const response = await fetch(url, {
        method: "POST",
        // The token travels in a header, never in a URL that a proxy or a log could keep.
        headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const answer = (await response.json().catch(() => ({}))) as { error?: GraphError };
      return classifyGraphResponse(response.status, answer.error);
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    name: "messenger",
    hasUtilityTemplate: config.template !== null,
    sendStandard: (psid, message, messagingType) => post({ recipient: { id: psid }, messaging_type: messagingType, message: standardPayload(message, "Mở SuZu One") }),
    sendUtility: async (psid, message) => {
      if (!config.template) return { status: "failed", error: "outside the 24-hour window and no MESSENGER_UTILITY_TEMPLATE is configured" };
      return post({ recipient: { id: psid }, messaging_type: "UTILITY", message: utilityPayload(config.template, message, config.appOrigin) });
    },
  };
}

export type MessengerConfig = { pageId: string; accessToken: string; appSecret: string; verifyToken: string; pageUsername: string | null };

/** Everything the real driver and the webhook need, or null when Messenger is not configured. */
export function messengerConfig(): MessengerConfig | null {
  const { MESSENGER_PAGE_ID: pageId, MESSENGER_PAGE_ACCESS_TOKEN: accessToken, MESSENGER_APP_SECRET: appSecret, MESSENGER_VERIFY_TOKEN: verifyToken } = env();
  if (!pageId || !accessToken || !appSecret || !verifyToken) return null;
  return { pageId, accessToken, appSecret, verifyToken, pageUsername: env().MESSENGER_PAGE_USERNAME ?? null };
}

export function messengerDriverFor(): MessengerDriver {
  const config = messengerConfig();
  if (!config) return localDriver;
  const templateName = env().MESSENGER_UTILITY_TEMPLATE;
  return messengerDriver({
    ...config,
    template: templateName ? { name: templateName, language: env().MESSENGER_TEMPLATE_LANGUAGE } : null,
    appOrigin: new URL(env().BETTER_AUTH_URL).origin,
  });
}

/**
 * Where the "connect Messenger" button sends the person: the Page's conversation, carrying the
 * one-time token as `ref`, which Meta hands back to the webhook with the sender's PSID. Without a
 * configured Page username the local development link points at nothing real.
 */
export function messengerConnectUrl(token: string): string {
  const username = messengerConfig()?.pageUsername ?? "suzu.one";
  return `https://m.me/${username}?ref=${encodeURIComponent(token)}`;
}

// ── The webhook ─────────────────────────────────────────────────────────────────────────────

/**
 * Meta signs every webhook call with the app secret over the exact bytes of the body
 * (`X-Hub-Signature-256: sha256=<hex>`). Anything else — unsigned, signed with another secret,
 * re-serialised JSON — is not from Meta and is refused before it is parsed.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Meta's subscription handshake: echo the challenge only for our own verify token. */
export function verifySubscription(params: URLSearchParams, verifyToken: string): string | null {
  const given = Buffer.from(params.get("hub.verify_token") ?? "");
  const expected = Buffer.from(verifyToken);
  if (params.get("hub.mode") !== "subscribe" || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return params.get("hub.challenge");
}

/** What the bot acts on; everything else in a webhook call is ignored. */
export type InboundEvent =
  /** The person opened an m.me link with a ref (new conversation: via Get Started; existing: a referral). */
  | { type: "ref"; psid: string; ref: string }
  | { type: "text"; psid: string; text: string }
  /** Any other input that still deserves an answer (a button, a sticker, Get Started without a ref). */
  | { type: "other"; psid: string };

type RawMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
  postback?: { payload?: string; referral?: { ref?: string } };
  referral?: { ref?: string };
  read?: unknown;
  delivery?: unknown;
};

/**
 * The events of one webhook call, for this Page only. An entry for any other Page is skipped: the
 * app may one day be subscribed to more than one, and a PSID means nothing outside its own Page.
 */
export function parseWebhook(body: unknown, pageId: string): InboundEvent[] {
  if (!body || typeof body !== "object" || (body as { object?: unknown }).object !== "page") return [];
  const entries = (body as { entry?: { id?: string; messaging?: RawMessaging[] }[] }).entry ?? [];
  const events: InboundEvent[] = [];
  for (const entry of entries) {
    if (entry.id !== pageId) continue;
    for (const item of entry.messaging ?? []) {
      const psid = item.sender?.id;
      // Our own messages come back as echoes; receipts are not input.
      if (!psid || psid === pageId || item.message?.is_echo || item.read || item.delivery) continue;
      const ref = item.referral?.ref ?? item.postback?.referral?.ref;
      if (ref) events.push({ type: "ref", psid, ref });
      else if (typeof item.message?.text === "string" && !item.message.quick_reply) events.push({ type: "text", psid, text: item.message.text });
      else if (item.message || item.postback) events.push({ type: "other", psid });
    }
  }
  return events;
}
