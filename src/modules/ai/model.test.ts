// The Claude drivers, with the network replaced by a recorder. No request leaves this file: the
// key below is not a key and `fetch` is a stub — what is tested is the REQUEST the driver would
// send, which is where FR-AI-06 is either kept or broken:
//   1. a passage holding a phone and an email arrives at the model without them,
//   2. the hand-off draft's input holds no phone, no email, and asks for no contacts,
//   3. what the provider says the call cost comes back with the answer, and is recorded,
//   4. the request goes out on the simple tier's model with what that model accepts (D38),
//   5. a refusal at the door — switched off, budget spent — or a failing provider sends nothing, or
//      nothing more, and answers the free way with a notice (D35, NFR-AGT-03).
// The budget's door (`spend.ts`) is stubbed: its own sums are tested against Postgres in `spend.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  values: {
    ANTHROPIC_API_KEY: "not-a-key-the-network-is-stubbed",
    ANTHROPIC_MODEL_SIMPLE: "claude-haiku-4-5",
    ANTHROPIC_MODEL: "claude-sonnet-5-5",
    ANTHROPIC_MODEL_COMPLEX: "claude-opus-5-5",
    ANTHROPIC_WORKSPACE_ID: undefined as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: () => settings.values }));
vi.mock("@/lib/observability/report", () => ({ logError: vi.fn() }));
const door = vi.hoisted(() => ({ admission: { ok: true } as { ok: true } | { ok: false; notice: string }, recorded: [] as unknown[] }));
vi.mock("./spend", () => ({
  admitModelCall: vi.fn(async () => door.admission),
  recordModelCall: vi.fn(async (record: unknown) => {
    door.recorded.push(record);
    return 0;
  }),
}));

import { REDACTED, threadText } from "./engine/drafts";
import { chatDriver, draftDriver } from "./model";

const asker = { person: { id: "00000000-0000-4000-8000-000000000001", primaryEntityId: null }, principal: { personId: "00000000-0000-4000-8000-000000000001", workforceType: "employee" as const, grants: [] } };

type Sent = {
  url: string;
  headers: Headers;
  body: { model: string; system: string; messages: { role: string; content: string }[]; output_config?: { effort?: string; format?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } };
};
const sent: Sent[] = [];
let reply: { status?: number; body: unknown } = { body: {} };

beforeEach(() => {
  sent.length = 0;
  door.admission = { ok: true };
  door.recorded.length = 0;
  settings.values.ANTHROPIC_WORKSPACE_ID = undefined;
  reply = {
    body: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Gọi phòng Nhân sự theo số trên trang [1]." }],
      usage: { input_tokens: 4321, output_tokens: 87 },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init: { body: string; headers?: HeadersInit }) => {
      sent.push({ url: String(url instanceof Request ? url.url : url), headers: new Headers(init.headers), body: JSON.parse(init.body) as Sent["body"] });
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
    expect(driver).toMatchObject({ name: "claude", isLocal: false, model: "claude-haiku-4-5" });
    await driver.complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("goes out on the simple tier's model, without the effort Haiku 4.5 rejects (D38)", async () => {
    await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent[0].body.model).toBe("claude-haiku-4-5");
    expect(sent[0].body.output_config?.effort).toBeUndefined();
  });

  it("names the workspace when the key is not scoped to one, and only then", async () => {
    await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent[0].headers.get("anthropic-workspace-id")).toBeNull();
    settings.values.ANTHROPIC_WORKSPACE_ID = "wrkspc_test";
    await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent[1].headers.get("anthropic-workspace-id")).toBe("wrkspc_test");
  });

  it("is written down with every kind of token the provider reported", async () => {
    reply = { body: { ...(reply.body as object), usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 300, cache_creation_input_tokens: 200 } } };
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(door.recorded).toEqual([
      { personId: asker.person.id, turnId: null, purpose: "ask", tier: "simple", model: "claude-haiku-4-5", usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 200 }, stopReason: "end_turn" },
    ]);
    expect(answer.usage).toEqual({ inputTokens: 1500, outputTokens: 50 });
  });

  it("sends nothing when the door refuses, and quotes the passage with the reason", async () => {
    door.admission = { ok: false, notice: "day" };
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(sent).toHaveLength(0);
    expect(door.recorded).toHaveLength(0);
    expect(answer).toMatchObject({ driver: "local-extractive", notice: "day", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(answer.body).toContain("Liên hệ phòng Nhân sự");
  });

  it("answers the free way when the provider fails, and records nothing it was not billed for", async () => {
    reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } };
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(answer).toMatchObject({ driver: "local-extractive", notice: "provider_error" });
    expect(door.recorded).toHaveLength(0);
  });

  it("sends nothing at all when nothing was retrieved", async () => {
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [], locale: "vi" });
    expect(sent).toHaveLength(0);
    expect(answer.body).toBe("");
  });

  it("carries a passage without its phone, its email, its chat link or its amounts", async () => {
    await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào? Máy tôi 0987654321", passages: [passage], locale: "vi" });
    const prompt = JSON.stringify(sent[0].body);
    for (const secret of ["0912 345 678", "0912345678", "ha.nguyen@suzu.group", "zalo.me", "300.000", "0987654321"]) expect(prompt, secret).not.toContain(secret);
    // The passage itself is there, with the holes marked, under the page's own href.
    const user = sent[0].body.messages[0].content;
    expect(user).toContain(`gọi chị Hà ${REDACTED}`);
    expect(user).toContain('href="/kb/pages/0f8a0d1e-0912-4a5b-8c7d-1234567890ab#h-1"');
  });

  it("still cites what was retrieved, and reports what the call cost", async () => {
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
    expect(answer.body).toContain("[1]");
    // The citation — and the excerpt the reader may see on the page anyway — come from the passage as retrieved.
    expect(answer.extracted.passages[0].citation).toMatchObject({ pageId: passage.pageId, chunkId: "c1" });
    expect(answer.usage).toEqual({ inputTokens: 4321, outputTokens: 87 });
  });

  it("counts a refusal's tokens too: it was paid for", async () => {
    reply = { body: { ...(reply.body as object), stop_reason: "refusal", content: [], usage: { input_tokens: 4000, output_tokens: 3 } } };
    const answer = await chatDriver().complete({ asker, question: "Liên hệ phòng Nhân sự thế nào?", passages: [passage], locale: "vi" });
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
    const answer = await draftDriver().draft({ asker, purpose: "draft.handoff", instruction: "Summarise this task's thread into a hand-off note.", facts: raw, locale: "vi" });
    const prompt = JSON.stringify(sent[0].body);
    for (const secret of ["0903 123 456", "0903123456", "long@minhlong.vn", "zalo.me", "12.000.000"]) expect(prompt, secret).not.toContain(secret);
    expect(prompt).toContain("Đã gửi bản 2.");
    expect(answer.usage).toEqual({ inputTokens: 4321, outputTokens: 87 });
  });

  it("is the same when the caller did redact first", async () => {
    await draftDriver().draft({ asker, purpose: "draft.handoff", instruction: "Summarise.", facts: threadText(thread), locale: "vi" });
    expect(JSON.stringify(sent[0].body)).not.toMatch(/0903|minhlong\.vn|zalo\.me/);
  });

  it("answers with no text and no cost when the call fails, so the extractive draft stands", async () => {
    reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } };
    expect(await draftDriver().draft({ asker, purpose: "draft.handoff", instruction: "Summarise.", facts: "x", locale: "vi" })).toEqual({ text: null, usage: { inputTokens: 0, outputTokens: 0 }, notice: "provider_error" });
  });
});
