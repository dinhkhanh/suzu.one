// The Telegram adapter's pure parts: the webhook secret, what counts as input (private chats only),
// how a Bot API answer is read, and what a message looks like on the wire.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({}) }));
import { classifyTelegramResponse, parseUpdate, sendMessageBody, verifyWebhookSecret } from "./telegram";

describe("the webhook secret", () => {
  it("accepts exactly the registered secret", () => {
    const secret = "a".repeat(64);
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
    expect(verifyWebhookSecret("b".repeat(64), secret)).toBe(false);
    expect(verifyWebhookSecret("a".repeat(63), secret)).toBe(false);
    expect(verifyWebhookSecret(null, secret)).toBe(false);
  });
});

describe("parsing an update", () => {
  const privateMessage = (text: string | undefined, extra: Record<string, unknown> = {}) => ({ update_id: 1, message: { chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, ...(text === undefined ? {} : { text }), ...extra } });

  it("reads Start with a payload, plain text and other input from a private chat", () => {
    expect(parseUpdate(privateMessage("/start link_abc-DEF_1"))).toEqual({ type: "start", chatId: "42", payload: "link_abc-DEF_1" });
    expect(parseUpdate(privateMessage("/start"))).toEqual({ type: "other", chatId: "42" });
    expect(parseUpdate(privateMessage("/stop"))).toEqual({ type: "text", chatId: "42", text: "/stop" });
    expect(parseUpdate(privateMessage(undefined, { sticker: {} }))).toEqual({ type: "other", chatId: "42" });
  });

  it("ignores groups, channels, bots, and a chat that is not the sender's own", () => {
    // A connect link pressed in a group would send one person's notices to the whole group.
    expect(parseUpdate({ message: { chat: { id: -100, type: "group" }, from: { id: 42 }, text: "/start link_abc" } })).toBeNull();
    expect(parseUpdate({ message: { chat: { id: -100, type: "supergroup" }, from: { id: 42 }, text: "/start link_abc" } })).toBeNull();
    expect(parseUpdate({ channel_post: { chat: { id: -100, type: "channel" }, text: "hi" } })).toBeNull();
    expect(parseUpdate({ message: { chat: { id: 7, type: "private" }, from: { id: 7, is_bot: true }, text: "/start link_abc" } })).toBeNull();
    expect(parseUpdate({ message: { chat: { id: 7, type: "private" }, from: { id: 8 }, text: "/start link_abc" } })).toBeNull();
    expect(parseUpdate({ edited_message: { chat: { id: 42, type: "private" } } })).toBeNull();
    expect(parseUpdate("nonsense")).toBeNull();
  });
});

describe("the Bot API", () => {
  it("reads blocked and missing chats as gone, everything else as a retryable failure", () => {
    expect(classifyTelegramResponse(200, { ok: true })).toEqual({ status: "sent" });
    expect(classifyTelegramResponse(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }).status).toBe("unreachable");
    expect(classifyTelegramResponse(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }).status).toBe("unreachable");
    expect(classifyTelegramResponse(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }).status).toBe("failed");
  });

  it("sends plain, protected text with one https button", () => {
    const body = sendMessageBody("42", { title: "T", body: "B", link: "https://suzu.one/approvals" }, "Open");
    expect(body).toEqual({
      chat_id: "42",
      text: "T\nB",
      protect_content: true,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Open", url: "https://suzu.one/approvals" }]] },
    });
    // No parse mode: a title can never be read as markup.
    expect(body).not.toHaveProperty("parse_mode");
    // Telegram refuses non-https buttons; the message goes without one.
    expect(sendMessageBody("42", { title: "T", body: "", link: "http://localhost:3000/x" }, "Open")).not.toHaveProperty("reply_markup");
  });
});
