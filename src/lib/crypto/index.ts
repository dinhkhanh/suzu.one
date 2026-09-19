import "server-only";
import { env } from "@/lib/env";
import { blindIndex, createFieldCipher, FieldCipherError, parseKeyRing } from "./field-cipher";

let cached: ReturnType<typeof createFieldCipher> | undefined;

/** The field cipher configured from DATA_ENCRYPTION_KEYS. Throws if the keys are not set. */
export function fieldCipher() {
  if (cached) return cached;
  const spec = env().DATA_ENCRYPTION_KEYS;
  if (!spec) throw new FieldCipherError("DATA_ENCRYPTION_KEYS is not set");
  return (cached = createFieldCipher(parseKeyRing(spec)));
}

export function fieldBlindIndex(value: string, context: string): string {
  const key = env().DATA_BLIND_INDEX_KEY;
  if (!key) throw new FieldCipherError("DATA_BLIND_INDEX_KEY is not set");
  return blindIndex(Buffer.from(key, "base64"), value, context);
}
