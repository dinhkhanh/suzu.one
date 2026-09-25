// The Messenger adapter's pure parts: Meta's signature, the handshake, what counts as input, and
// how a Graph answer is read.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({}) }));
import { classifyGraphResponse, parseWebhook, standardPayload, utilityPayload, verifySubscription, verifyWebhookSignature } from "./messenger";

const SECRET = "app-secret-0123456789";
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("the webhook signature", () => {
  const body = JSON.stringify({ object: "page", entry: [] });

  it("accepts Meta's HMAC over the exact bytes, and nothing else", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body, "another-secret-0123"), SECRET)).toBe(false);
    // Same JSON, different bytes: re-serialised bodies are not what Meta signed.
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 1), sign(body), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=zz", SECRET)).toBe(false);
  });

  it("echoes the handshake's challenge only for our verify token", () => {
    const params = (token: string, mode = "subscribe") => new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "42" });
    expect(verifySubscription(params("verify-token-0123456"), "verify-token-0123456")).toBe("42");
    expect(verifySubscription(params("verify-token-XXXXXXX"), "verify-token-0123456")).toBeNull();
    expect(verifySubscription(params("verify-token-0123456", "unsubscribe"), "verify-token-0123456")).toBeNull();
  });
});

describe("parsing a webhook call", () => {
  it("keeps this Page's input and drops echoes, receipts and other Pages", () => {
    const events = parseWebhook(
      {
        object: "page",
        entry: [
          {
            id: "100",
            messaging: [
              { sender: { id: "u1" }, referral: { ref: "link.abc" } },
              { sender: { id: "u2" }, postback: { payload: "GET_STARTED", referral: { ref: "link.def" } } },
              { sender: { id: "u3" }, message: { text: "dừng" } },
              { sender: { id: "u4" }, message: { attachments: [] } },
              { sender: { id: "100" }, message: { text: "our echo", is_echo: true } },
              { sender: { id: "u5" }, read: { watermark: 1 } },
            ],
          },
          { id: "999", messaging: [{ sender: { id: "u9" }, message: { text: "another page" } }] },
        ],
      },
      "100",
    );
    expect(events).toEqual([
      { type: "ref", psid: "u1", ref: "link.abc" },
      { type: "ref", psid: "u2", ref: "link.def" },
      { type: "text", psid: "u3", text: "dừng" },
      { type: "other", psid: "u4" },
    ]);
    expect(parseWebhook({ object: "instagram", entry: [] }, "100")).toEqual([]);
    expect(parseWebhook("nonsense", "100")).toEqual([]);
  });
});

describe("the Send API", () => {
  it("reads Graph errors: gone accounts, a closed window, everything else", () => {
    expect(classifyGraphResponse(200, undefined)).toEqual({ status: "sent" });
    expect(classifyGraphResponse(400, { code: 551, message: "This person isn't available right now." }).status).toBe("unreachable");
    expect(classifyGraphResponse(400, { code: 100, error_subcode: 2018001 }).status).toBe("unreachable");
    expect(classifyGraphResponse(400, { code: 10, error_subcode: 2018278 }).status).toBe("outside_window");
    expect(classifyGraphResponse(500, { code: 2, message: "Service temporarily unavailable" })).toMatchObject({ status: "failed" });
  });

  it("sends the words with one button, and a template that can only open this app", () => {
    expect(standardPayload({ title: "T", body: "B", link: null }, "Open")).toEqual({ text: "T\nB" });
    expect(standardPayload({ title: "T", body: "B", link: "https://suzu.one/approvals" }, "Open")).toMatchObject({
      attachment: { payload: { template_type: "button", text: "T\nB", buttons: [{ type: "web_url", url: "https://suzu.one/approvals", title: "Open" }] } },
    });
    const template = { name: "suzu_one_notification", language: "vi" };
    const suffixOf = (payload: Record<string, unknown>) => (payload as { template: { components: { parameters: { url?: string }[] }[] } }).template.components[1].parameters[0].url;
    expect(suffixOf(utilityPayload(template, { title: "T", body: "B", link: "https://suzu.one/work/tasks/1" }, "https://suzu.one"))).toBe("work/tasks/1");
    // A link anywhere else falls back to the notifications page.
    expect(suffixOf(utilityPayload(template, { title: "T", body: "B", link: "https://evil.example/x" }, "https://suzu.one"))).toBe("notifications");
  });
});
