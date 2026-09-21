// Google Chat behind an adapter (FR-PLT-31). Two drivers, chosen by configuration — exactly the
// shape web push uses:
//  - "google_chat": posts a card to an incoming webhook when GOOGLE_CHAT_WEBHOOK_URL is set;
//  - "local": no webhook → nothing leaves the machine; the delivery is recorded as "simulated" so
//    the demo and the tests can see the card that would have been sent.
//
// The real driver is written against Google's documented incoming-webhook payload and has never
// been run against a real space: the company has no webhook yet.
import "server-only";
import { env } from "@/lib/env";

export type ChatMessage = {
  title: string;
  body: string;
  /** Where the card's "Open" button goes. Absolute. */
  link: string | null;
  /** The one-shot approve deep link (FR-PLT-24), when the card offers one. Absolute. */
  actionLink?: string | null;
  actionLabel?: string | null;
};
export type ChatResult = { status: "sent" } | { status: "simulated" } | { status: "failed"; error: string };
export type ChatDriver = { name: "google_chat" | "local"; space: string | null; send: (message: ChatMessage) => Promise<ChatResult> };

const localDriver: ChatDriver = { name: "local", space: null, send: async () => ({ status: "simulated" }) };

/**
 * One card. Google Chat renders `cardsV2`; the plain `text` is what a client that cannot render a
 * card falls back to, and what a notification preview shows. Nothing sensitive goes in either —
 * a Chat space is read over shoulders, so a card carries a title, a line and a link, never a figure.
 */
export function chatCard(message: ChatMessage): Record<string, unknown> {
  const buttons = [
    ...(message.actionLink && message.actionLabel ? [{ text: message.actionLabel, onClick: { openLink: { url: message.actionLink } } }] : []),
    ...(message.link ? [{ text: "Mở SuZu One", onClick: { openLink: { url: message.link } } }] : []),
  ];
  return {
    text: `${message.title}\n${message.body}${message.link ? `\n${message.link}` : ""}`,
    cardsV2: [
      {
        cardId: "suzu-one",
        card: {
          header: { title: message.title, subtitle: "SuZu One" },
          sections: [{ widgets: [{ textParagraph: { text: message.body } }, ...(buttons.length ? [{ buttonList: { buttons } }] : [])] }],
        },
      },
    ],
  };
}

function googleChatDriver(webhookUrl: string): ChatDriver {
  return {
    name: "google_chat",
    // The webhook URL carries its key; only the space part is ever recorded.
    space: (() => {
      try {
        return new URL(webhookUrl).pathname;
      } catch {
        return null;
      }
    })(),
    send: async (message) => {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify(chatCard(message)),
          // Never follow a redirect with the message in hand.
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return { status: "sent" };
        return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export function chatDriver(): ChatDriver {
  const url = env().GOOGLE_CHAT_WEBHOOK_URL;
  return url ? googleChatDriver(url) : localDriver;
}
