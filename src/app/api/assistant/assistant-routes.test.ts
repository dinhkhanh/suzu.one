// The assistant sheet's two routes (Phase 13 R5): the turn and the words. The turn is the `ai.ask`
// action carried over HTTP, so what is tested here is the carrying: only the app's own pages may post,
// the body is handed over as it came, and the words are the sheet's namespaces for a signed-in person.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as unknown, asked: [] as unknown[] }));
vi.mock("@/modules/ai/actions", () => ({ askAssistantAction: async (input: unknown) => (state.asked.push(input), { ok: true, data: { echoed: input } }) }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => state.user }));

import { LAZY_NAMESPACES } from "@/i18n/route-namespaces.generated";
import { maxDuration, POST } from "./ask/route";
import { GET } from "./words/route";

const post = (headers: Record<string, string>, body: string) => POST(new Request("https://suzu.one/api/assistant/ask", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));

beforeEach(() => {
  state.asked = [];
  state.user = null;
});

describe("POST /api/assistant/ask", () => {
  it("has a time limit of its own that fits an agent turn (40 s) and the free path after it", () => {
    expect(maxDuration).toBe(60);
  });

  it("carries a question from the app's own page to the action, as it came", async () => {
    const response = await post({ origin: "https://suzu.one", host: "suzu.one" }, JSON.stringify({ question: "Việc này thế nào?", page: { kind: "task", id: "x" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { echoed: { question: "Việc này thế nào?", page: { kind: "task", id: "x" } } } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses another site, a missing origin and a body that is not JSON, before the action", async () => {
    expect((await post({ origin: "https://evil.example", host: "suzu.one" }, "{}")).status).toBe(403);
    expect((await post({ host: "suzu.one" }, "{}")).status).toBe(403);
    expect((await post({ origin: "https://suzu.one", host: "suzu.one" }, "not json")).status).toBe(400);
    expect(state.asked).toEqual([]);
  });
});

describe("GET /api/assistant/words", () => {
  it("hands a signed-in person the sheet's namespaces in the language asked, and nobody else anything", async () => {
    expect((await GET(new Request("https://suzu.one/api/assistant/words?locale=en"))).status).toBe(401);
    state.user = { person: { id: "p" } };
    const en = await (await GET(new Request("https://suzu.one/api/assistant/words?locale=en"))).json();
    expect(Object.keys(en)).toEqual([...LAZY_NAMESPACES.assistantSheet]);
    expect(en.assistant.feedback.right).toBe("Right");
    // Anything else is Vietnamese, the source language.
    const vi = await (await GET(new Request("https://suzu.one/api/assistant/words?locale=xx"))).json();
    expect(vi.assistant.feedback.right).toBe("Đúng");
  });
});
