import { messengerConfig, parseWebhook, verifySubscription, verifyWebhookSignature } from "@/modules/platform/notifications/messenger";
import { handleMessengerEvents } from "@/modules/platform/notifications/messenger-links";

// Meta's webhook for the company Page (docs/MESSENGER.md). Nobody signs in here: every call proves
// itself with Meta's signature over the body, made with the app secret, and is refused otherwise.
// The proxy lets this path through on the app's domain only (src/lib/site-routing.ts).

/** Meta's subscription handshake, once, when the webhook URL is saved in the app dashboard. */
export async function GET(request: Request) {
  const config = messengerConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  const challenge = verifySubscription(new URL(request.url).searchParams, config.verifyToken);
  return challenge ? new Response(challenge, { headers: { "content-type": "text/plain" } }) : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const config = messengerConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  // The signature is over the exact bytes Meta sent, so the body is read as text, checked, and
  // only then parsed.
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) return new Response("Invalid signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  // Answered within Meta's time limit; an error is a 500, so Meta delivers the call again.
  await handleMessengerEvents(parseWebhook(body, config.pageId));
  return new Response("EVENT_RECEIVED");
}
