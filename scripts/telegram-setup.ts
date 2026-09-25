// One-time Telegram setup for the company bot (docs/TELEGRAM.md): pnpm telegram:setup
//   1. checks the token belongs to the bot named in TELEGRAM_BOT_USERNAME;
//   2. registers the webhook at <BETTER_AUTH_URL>/api/telegram/webhook with the secret Telegram
//      must send back, for private-chat messages only;
//   3. sets the bot's description and its one command, /stop.
// Safe to run again. Reads the same variables as the app (.env.local, or `vercel env pull`).
import { config } from "dotenv";

config({ path: ".env.local" });

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
};

async function main() {
  const token = need("TELEGRAM_BOT_TOKEN");
  const username = need("TELEGRAM_BOT_USERNAME");
  const secret = need("TELEGRAM_WEBHOOK_SECRET");
  const webhook = new URL("/api/telegram/webhook", need("BETTER_AUTH_URL")).toString();
  if (!webhook.startsWith("https://")) throw new Error(`Telegram only calls https webhooks; BETTER_AUTH_URL gives ${webhook}`);

  const call = async (method: string, body: Record<string, unknown> = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const answer = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!answer.ok) throw new Error(`${method}: ${answer.description ?? response.status}`);
    return answer.result;
  };

  const me = (await call("getMe")) as { username?: string };
  if (me.username?.toLowerCase() !== username.toLowerCase()) throw new Error(`the token belongs to @${me.username}, not @${username}`);
  console.log(`✓ token belongs to @${me.username}`);

  await call("setWebhook", { url: webhook, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true, max_connections: 10 });
  console.log(`✓ webhook set: ${webhook}`);

  await call("setMyCommands", { commands: [{ command: "stop", description: "Ngừng nhận thông báo SuZu One" }] });
  await call("setMyShortDescription", { short_description: "Bot thông báo tự động của SuZu One." });
  await call("setMyDescription", { description: "Bot thông báo tự động của SuZu One. Kết nối trong SuZu One → Thông báo; bot chỉ gửi thông báo, không trả lời câu hỏi." });
  console.log("✓ commands and description set");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
