// The Claude drivers, with the network replaced by a recorder. No request leaves this file: the
// key below is not a key and `fetch` is a stub — what is tested is the REQUEST the driver would
// send, which is where FR-AI-06 is either kept or broken:
//   1. a passage holding a phone and an email arrives at the model without them,
//   2. the hand-off draft's input holds no phone, no email, and asks for no contacts,
//   3. what the provider says the call cost comes back with the answer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ ANTHROPIC_API_KEY: "not-a-key-the-network-is-stubbed", ANTHROPIC_MODEL: "claude-opus-5" }) }));

import { REDACTED, threadText } from "./engine/drafts";
import { chatDriver, draftDriver } from "./model";

type Sent = { url: string; body: { model: string; system: string; messages: { role: string; content: string }[]; output_config?: { format?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } } };
const sent: Sent[] = [];
let reply: { status?: number; body: unknown } = { body: {} };

beforeEach(() => {
  sent.length = 0;
  reply = { body: { stop_reason: "end_turn", content: [{ type: "text", text: "Gọi phòng Nhân sự theo số trên trang [1]." }], usage: { input_tokens: 4321, output_tokens: 87 } } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) as Sent["body"] });
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const passage = {
  chunkId: "c1",
  pageId: "0f8a0d1e-0912-4a5b-8c7d-1234567890ab",
  pageTitle: "Liên hệ phòng Nhân sự",
  spaceKey: "so-tay",
  spaceName: "Sổ tay",
  headingPath: "Liên hệ phòng Nhân sự › Hotline",
  anchor: "h-1",
  content: "Liên hệ phòng Nhân sự: gọi chị Hà 0912 345 678 hoặc viết cho ha.nguyen@suzu.group, Zalo https://zalo.me/0912345678. Mức hỗ trợ điện thoại là 300.000 đ mỗi tháng.",
  vectorScore: 0.9,
  score: 0.9,
  lexical: 0.9,
};

describe("the chat driver's request", () => {
  it("is the real driver, and sends one request", async () => {
    const driver = chatDriver();
    expect(driver).toMatchObject({ name: "claude", isLocal: false, model: "claude-opus-5" });
    await driver.complete({ question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("carries a passage without its phone, its email, its chat link or its amounts", async () => {
    await chatDriver().complete({ question: "Liên hệ phòng Nhân sự thế nào? Máy tôi 0987654321", passages: [passage], locale: "vi" });
    const prompt = JSON.stringify(sent[0].body);
    for (const secret of ["0912 345 678", "0912345678", "ha.nguyen@suzu.group", "zalo.me", "300.000", "0987654321"]) expect(prompt, secret).not.toContain(secret);
    // The passage itself is there, with the holes marked, under the page's own href.
    const user = sent[0].body.messages[0].content;
    expect(user).toContain(`gọi chị Hà ${REDACTED}`);
    expect(user).toContain('href="/kb/pages/0f8a0d1e-0912-4a5b-8c7d-1234567890ab#h-1"');
  });

  it("still cites what was retrieved, and reports what the call cost", async () => {
    const answer = await chatDriver().complete({ question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(answer.body).toContain("[1]");
    // The citation — and the excerpt the reader may see on the page anyway — come from the passage as retrieved.
    expect(answer.extracted.passages[0].citation).toMatchObject({ pageId: passage.pageId, chunkId: "c1" });
    expect(answer.usage).toEqual({ inputTokens: 4321, outputTokens: 87 });
  });

  it("counts a refusal's tokens too: it was paid for", async () => {
    reply = { body: { stop_reason: "refusal", content: [], usage: { input_tokens: 4000, output_tokens: 3 } } };
    const answer = await chatDriver().complete({ question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(answer).toMatchObject({ body: "", usage: { inputTokens: 4000, outputTokens: 3 } });
  });
});

describe("the draft driver's request", () => {
  const thread = {
    title: "Banner Tết cho khách Minh Long",
    description: "Liên hệ khách: anh Long 0903 123 456, long@minhlong.vn.",
    stateName: "Đang làm",
    comments: [
      { author: "Lan", body: "Đã gửi bản 2. Khách nhắn qua https://zalo.me/0903123456 là cần sửa màu." },
      { author: "Huy", body: "Phí thiết kế 12.000.000 đ đã chốt." },
    ],
  };

  it("holds no phone, no email, no chat link and no amount, whatever the caller passed", async () => {
    // Raw on purpose — not even `threadText`: the driver is the choke point, not its callers.
    const raw = [thread.title, thread.description, ...thread.comments.map((comment) => `${comment.author}: ${comment.body}`)].join("\n");
    const answer = await draftDriver().draft({ instruction: "Summarise this task's thread into a hand-off note.", facts: raw, locale: "vi" });
    const prompt = JSON.stringify(sent[0].body);
    for (const secret of ["0903 123 456", "0903123456", "long@minhlong.vn", "zalo.me", "12.000.000"]) expect(prompt, secret).not.toContain(secret);
    expect(prompt).toContain("Đã gửi bản 2.");
    expect(answer.usage).toEqual({ inputTokens: 4321, outputTokens: 87 });
  });

  it("is the same when the caller did redact first", async () => {
    await draftDriver().draft({ instruction: "Summarise.", facts: threadText(thread), locale: "vi" });
    expect(JSON.stringify(sent[0].body)).not.toMatch(/0903|minhlong\.vn|zalo\.me/);
  });

  it("answers with no text and no cost when the call fails, so the extractive draft stands", async () => {
    reply = { status: 529, body: { type: "error" } };
    expect(await draftDriver().draft({ instruction: "Summarise.", facts: "x", locale: "vi" })).toEqual({ text: null, usage: { inputTokens: 0, outputTokens: 0 } });
  });
});
