// The embeddings adapter (FR-KB-11, for the Phase 9 assistant). One function, two drivers:
//  - `CLOUDFLARE_AI_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set → Cloudflare Workers AI through its
//    OpenAI-compatible `/v1/embeddings` endpoint, `EMBEDDINGS_MODEL` (default `@cf/baai/bge-m3`:
//    multilingual, Vietnamese included, 1024 dimensions, no instruction prefixes — a question and a
//    passage are embedded alike).
//  - unset → the deterministic local fake (`engine/fake-embedding.ts`); nothing leaves the machine.
// Every stored vector carries its model's name, so switching driver or model re-embeds everything
// (the `kb-embeddings` job picks up chunks whose model is not the current one).
import "server-only";
import { env } from "@/lib/env";
import { FAKE_EMBEDDING_MODEL, fakeEmbedding } from "./engine/fake-embedding";

export type EmbeddingKind = "document" | "query";
export type EmbeddingDriver = { model: string; isFake: boolean; /** Texts per request. */ batchSize: number; embed: (texts: readonly string[], kind: EmbeddingKind) => Promise<number[][]> };

const fakeDriver: EmbeddingDriver = { model: FAKE_EMBEDDING_MODEL, isFake: true, batchSize: 200, embed: async (texts) => texts.map(fakeEmbedding) };

function workersAiDriver(accountId: string, apiToken: string, model: string): EmbeddingDriver {
  return {
    model,
    isFake: false,
    // bge-m3 takes up to 100 texts a call; half that keeps one call well inside its time budget.
    batchSize: 50,
    embed: async (texts) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`embeddings: ${response.status} ${(await response.text()).slice(0, 200)}`);
      const body = (await response.json()) as { data: { index: number; embedding: number[] }[] };
      const vectors = [...body.data].sort((a, b) => a.index - b.index).map((row) => row.embedding);
      if (vectors.length !== texts.length) throw new Error("embeddings: the answer does not match the request");
      return vectors;
    },
  };
}

export function embeddingDriver(): EmbeddingDriver {
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AI_API_TOKEN: apiToken, EMBEDDINGS_MODEL: model } = env();
  return accountId && apiToken ? workersAiDriver(accountId, apiToken, model) : fakeDriver;
}

export async function embedTexts(texts: readonly string[], kind: EmbeddingKind): Promise<{ model: string; vectors: number[][] }> {
  const driver = embeddingDriver();
  const vectors: number[][] = [];
  for (let at = 0; at < texts.length; at += driver.batchSize) vectors.push(...(await driver.embed(texts.slice(at, at + driver.batchSize), kind)));
  return { model: driver.model, vectors };
}
