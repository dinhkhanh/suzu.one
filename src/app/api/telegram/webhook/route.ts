import { parseUpdate, telegramConfig, verifyWebhookSecret } from "@/modules/platform/notifications/telegram";
import { handleTelegramEvent } from "@/modules/platform/notifications/telegram-links";

// Telegram's webhook for the company bot (docs/TELEGRAM.md). Nobody signs in here: every call
// carries the secret registered with setWebhook (`pnpm telegram:setup`) and is refused without it.
// The proxy lets this path through on the app's domain only (src/lib/site-routing.ts).
export async function POST(request: Request) {
  const config = telegramConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  // Groups, channels and anything that is not a private chat's message are ignored, not refused:
  // an error would only make Telegram deliver them again.
  const event = parseUpdate(body);
  // An error is a 500, so Telegram delivers the update again.
  if (event) await handleTelegramEvent(event);
  return new Response("ok");
}
