// Envelope encryption for `restricted` and `compensation` fields (ADR-05, DR-05). No I/O.
//
// Every value gets its own random data key (DEK). The DEK encrypts the value; a key-encryption key
// (KEK) from the platform secret store encrypts the DEK. Rotating the KEK therefore only re-wraps
// the small DEKs (`rewrap`), never the data. AES-256-GCM throughout.
//
// Stored form: v1.<kekId>.<wrapIv>.<wrappedDek+tag>.<iv>.<ciphertext+tag>   (base64url parts)
//
// `context` names where the value lives, e.g. "person_sensitive.national_id:<personId>". It is
// authenticated but not stored, so a ciphertext copied into another row or column fails to decrypt.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type KeyRing = { activeKeyId: string; keys: ReadonlyMap<string, Buffer> };

export class FieldCipherError extends Error {}

const VERSION = "v1";
const encode = (bytes: Buffer) => bytes.toString("base64url");
const decode = (text: string) => Buffer.from(text, "base64url");

function seal(key: Buffer, plaintext: Buffer, context: string): { iv: Buffer; sealed: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  return { iv, sealed: Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]) };
}

function open(key: Buffer, iv: Buffer, sealed: Buffer, context: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  } catch {
    throw new FieldCipherError("decryption_failed");
  }
}

/** Parses "k1:<base64 32 bytes>,k2:<base64 32 bytes>". The first key is the active one. */
export function parseKeyRing(spec: string): KeyRing {
  const keys = new Map<string, Buffer>();
  for (const entry of spec.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (separator < 1 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new FieldCipherError("bad_key_id");
    if (key.length !== 32) throw new FieldCipherError(`key_${id}_is_not_32_bytes`);
    if (keys.has(id)) throw new FieldCipherError(`duplicate_key_${id}`);
    keys.set(id, key);
  }
  const [activeKeyId] = keys.keys();
  if (!activeKeyId) throw new FieldCipherError("no_keys");
  return { activeKeyId, keys };
}

export function createFieldCipher(ring: KeyRing) {
  const kek = (id: string) => ring.keys.get(id) ?? fail(`unknown_key_${id}`);
  const fail = (message: string): never => {
    throw new FieldCipherError(message);
  };

  function parse(stored: string) {
    const [version, kekId, wrapIv, wrappedDek, iv, ciphertext, extra] = stored.split(".");
    if (version !== VERSION || !ciphertext || extra !== undefined) fail("bad_format");
    return { kekId, wrapIv: decode(wrapIv), wrappedDek: decode(wrappedDek), iv: decode(iv), ciphertext: decode(ciphertext) };
  }

  return {
    encrypt(plaintext: string, context: string): string {
      const dek = randomBytes(32);
      const value = seal(dek, Buffer.from(plaintext, "utf8"), context);
      const wrapped = seal(kek(ring.activeKeyId), dek, context);
      return [VERSION, ring.activeKeyId, encode(wrapped.iv), encode(wrapped.sealed), encode(value.iv), encode(value.sealed)].join(".");
    },

    decrypt(stored: string, context: string): string {
      const parts = parse(stored);
      const dek = open(kek(parts.kekId), parts.wrapIv, parts.wrappedDek, context);
      return open(dek, parts.iv, parts.ciphertext, context).toString("utf8");
    },

    /** True when the value is wrapped by an older key and `rewrap` would change it. */
    needsRewrap: (stored: string): boolean => parse(stored).kekId !== ring.activeKeyId,

    /** Moves a value to the active key without touching (or seeing) the data itself. */
    rewrap(stored: string, context: string): string {
      const parts = parse(stored);
      if (parts.kekId === ring.activeKeyId) return stored;
      const dek = open(kek(parts.kekId), parts.wrapIv, parts.wrappedDek, context);
      const wrapped = seal(kek(ring.activeKeyId), dek, context);
      return [VERSION, ring.activeKeyId, encode(wrapped.iv), encode(wrapped.sealed), encode(parts.iv), encode(parts.ciphertext)].join(".");
    },
  };
}

/**
 * A keyed fingerprint for finding or de-duplicating encrypted values (e.g. "is this national ID
 * already on file?") without decrypting anything. Normalise the value before calling.
 */
export function blindIndex(indexKey: Buffer, value: string, context: string): string {
  return createHmac("sha256", indexKey).update(context).update("\u0000").update(value).digest("base64url");
}
