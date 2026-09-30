// One-time Messenger setup for the company Page (docs/MESSENGER.md): pnpm messenger:setup
//   1. subscribes the app to the Page's messages, postbacks and referrals (the webhook's input);
//   2. sets the Get Started button — a first conversation delivers the m.me `ref` only through
//      it. No greeting: the Page does not say what it is to whoever opens it (Graph v26 no longer
//      manages greetings; any left over is removed in Meta Business Suite → Inbox → Automations);
//   3. creates the utility template used outside Meta's 24-hour window, unless it exists.
// Safe to run again. Reads the same variables as the app (.env.local, or `vercel env pull`).
import { createHmac } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

const GRAPH = "https://graph.facebook.com/v26.0";
// The template's button URL is fixed to the origin it was created from, and Meta never lets an
// approved template change: `suzu_one_notification` was made from localhost, hence `_v2`.
const TEMPLATE = process.env.MESSENGER_UTILITY_TEMPLATE || "suzu_one_notification_v2";
const LANGUAGE = process.env.MESSENGER_TEMPLATE_LANGUAGE || "vi";

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
};
const pageId = need("MESSENGER_PAGE_ID");
const token = need("MESSENGER_PAGE_ACCESS_TOKEN");
const proof = createHmac("sha256", need("MESSENGER_APP_SECRET")).update(token).digest("hex");
const origin = new URL(need("BETTER_AUTH_URL")).origin;
const isLocal = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);

async function graph(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${GRAPH}/${path}${separator}appsecret_proof=${proof}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

async function main() {
  await graph("POST", `${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referrals,message_template_status_update`);
  console.log("✓ webhook fields subscribed");

  await graph("POST", `${pageId}/messenger_profile`, { get_started: { payload: "GET_STARTED" } });
  console.log("✓ Get Started button set");

  const existing = (await graph("GET", `${pageId}/message_templates?name=${TEMPLATE}`)) as { data?: { name: string; status?: string }[] };
  const found = existing.data?.find((row) => row.name === TEMPLATE);
  if (found) {
    console.log(`✓ template ${TEMPLATE} exists (${found.status ?? "status unknown"})`);
  } else if (isLocal) {
    throw new Error(`template ${TEMPLATE} not found, and BETTER_AUTH_URL is ${origin}: a template made from here would open localhost forever. Run with the production BETTER_AUTH_URL.`);
  } else {
    // `{{1}}` is the notification's title (or, for sensitive categories, only which area has news);
    // the button can only open a path of this app.
    const created = await graph("POST", `${pageId}/message_templates`, {
      name: TEMPLATE,
      language: LANGUAGE,
      category: "UTILITY",
      components: [
        { type: "BODY", text: "SuZu One có cập nhật cho tài khoản của bạn: {{1}}. Mở ứng dụng để xem chi tiết.", example: { body_text: [["Yêu cầu nghỉ phép đang chờ bạn duyệt"]] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Mở SuZu One", url: `${origin}/{{1}}`, example: { url_suffix_example: `${origin}/approvals` } }] },
      ],
    });
    console.log(`✓ template ${TEMPLATE} created: ${JSON.stringify(created)}`);
  }
  console.log(`\nSet MESSENGER_UTILITY_TEMPLATE=${TEMPLATE} once the template is APPROVED.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
