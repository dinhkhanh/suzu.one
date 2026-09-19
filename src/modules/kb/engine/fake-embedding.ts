// The local stand-in for an embeddings API: deterministic feature hashing. Words (accent-stripped)
// and word pairs are hashed into 256 buckets with a sign, then the vector is L2-normalised — so
// texts that share words are close, which is enough to exercise chunking, storage, retrieval and
// ranking end to end without a key. Pure. NOT semantic: "nghỉ phép" and "ngày nghỉ" only meet on
// "nghi".
import { toSearchKey } from "@/lib/text";

export const FAKE_EMBEDDING_MODEL = "fake-hash-256";
export const FAKE_EMBEDDING_DIMS = 256;

// FNV-1a, 32 bit.
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(FAKE_EMBEDDING_DIMS).fill(0);
  const tokens = toSearchKey(text).split(/[^a-z0-9]+/).filter((token) => token.length > 1);
  const add = (feature: string, weight: number) => {
    const h = hash(feature);
    vector[h % FAKE_EMBEDDING_DIMS] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  tokens.forEach((token, index) => {
    add(token, 1);
    if (index > 0) add(`${tokens[index - 1]} ${token}`, 0.5);
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // Six decimals: what a `real` keeps, so a stored vector equals a recomputed one.
  return norm === 0 ? vector : vector.map((value) => Math.round((value / norm) * 1e6) / 1e6);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
