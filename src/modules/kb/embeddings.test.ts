import { afterEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, unknown> = {};
vi.mock("@/lib/env", () => ({ env: () => settings }));

import { embeddingDriver, embedTexts } from "./embeddings";

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(settings)) delete settings[key];
});

describe("embeddings driver", () => {
  it("is the local fake until both the account and the token are set", () => {
    Object.assign(settings, { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), EMBEDDINGS_MODEL: "@cf/baai/bge-m3" });
    expect(embeddingDriver()).toMatchObject({ isFake: true, model: "fake-hash-256" });
  });

  it("calls Workers AI's OpenAI-compatible endpoint in batches and keeps the answer's order", async () => {
    Object.assign(settings, { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_AI_API_TOKEN: "token", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" });
    const requests: { url: string; body: { model: string; input: string[] }; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { model: string; input: string[] };
      requests.push({ url, body, authorization: new Headers(init.headers).get("authorization") });
      // Answered out of order, as the API may.
      const data = body.input.map((text, index) => ({ index, embedding: [text.length, index] })).reverse();
      return Response.json({ object: "list", data, model: body.model });
    });
    const texts = Array.from({ length: 60 }, (_, index) => "x".repeat(index + 1));
    const { model, vectors } = await embedTexts(texts, "document");
    expect(model).toBe("@cf/baai/bge-m3");
    expect(requests.map((request) => request.body.input.length)).toEqual([50, 10]);
    expect(requests[0]).toMatchObject({ url: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/embeddings`, authorization: "Bearer token", body: { model: "@cf/baai/bge-m3" } });
    expect(vectors.map((vector) => vector[0])).toEqual(texts.map((text) => text.length));
  });

  it("sends no contact details to Cloudflare: passages and questions lose emails, phones and chat links", async () => {
    Object.assign(settings, { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_AI_API_TOKEN: "token", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" });
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      sent.push(...body.input);
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [index] })) });
    });
    await embedTexts(["Hỏi chị Lan (lan.nguyen@gmail.com, 0912 345 678, zalo.me/0912345678) về nghỉ phép", "Nghỉ phép năm: 12 ngày"], "document");
    await embedTexts(["số của anh Huy là 090.123.4567?"], "query");
    expect(sent.join(" ")).not.toMatch(/@gmail|0912|090\.123|zalo/);
    expect(sent[0]).toContain("về nghỉ phép");
    expect(sent[1]).toBe("Nghỉ phép năm: 12 ngày");
  });

  it("fails loudly on an error answer or a short one", async () => {
    Object.assign(settings, { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_AI_API_TOKEN: "token", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" });
    vi.stubGlobal("fetch", async () => new Response("rate limited", { status: 429 }));
    await expect(embedTexts(["a"], "query")).rejects.toThrow("embeddings: 429 rate limited");
    vi.stubGlobal("fetch", async () => Response.json({ data: [] }));
    await expect(embedTexts(["a"], "query")).rejects.toThrow("does not match");
  });
});
