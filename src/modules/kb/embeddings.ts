// The embeddings adapter (FR-KB-11, for the Phase 9 assistant). One function, two drivers:
//  - `EMBEDDINGS_API_KEY` set → Voyage AI's REST API (Anthropic has no embeddings endpoint of its
//    own and recommends Voyage). WRITTEN BUT NEVER RUN: no key exists yet.
//  - unset → the deterministic local fake (`engine/fake-embedding.ts`); nothing leaves the machine.
// Every stored vector carries its model's name, so switching driver or model re-embeds everything
// (the `kb-embeddings` job picks up chunks whose model is not the current one).
import "server-only";
import { env } from "@/lib/env";
import { FAKE_EMBEDDING_MODEL, fakeEmbedding } from "./engine/fake-embedding";

export type EmbeddingKind = "document" | "query";
export type EmbeddingDriver = { model: string; isFake: boolean; /** Texts per request. */ batchSize: number; embed: (texts: readonly string[], kind: EmbeddingKind) => Promise<number[][]> };

const fakeDriver: EmbeddingDriver = { model: FAKE_EMBEDDING_MODEL, isFake: true, batchSize: 200, embed: async (texts) => texts.map(fakeEmbedding) };

function voyageDriver(apiKey: string, model: string): EmbeddingDriver {
  return {
    model,
    isFake: false,
    batchSize: 64,
    embed: async (texts, kind) => {
      const response = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts, input_type: kind }),
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
  const { EMBEDDINGS_API_KEY: apiKey, EMBEDDINGS_MODEL: model } = env();
  return apiKey ? voyageDriver(apiKey, model) : fakeDriver;
}

export async function embedTexts(texts: readonly string[], kind: EmbeddingKind): Promise<{ model: string; vectors: number[][] }> {
  const driver = embeddingDriver();
  const vectors: number[][] = [];
  for (let at = 0; at < texts.length; at += driver.batchSize) vectors.push(...(await driver.embed(texts.slice(at, at + driver.batchSize), kind)));
  return { model: driver.model, vectors };
}
