import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blindIndex, createFieldCipher, FieldCipherError, parseKeyRing } from "./field-cipher";

const key = () => randomBytes(32).toString("base64");
const k1 = key();
const k2 = key();
const context = "person_sensitive.national_id:person-1";

describe("field cipher", () => {
  const cipher = createFieldCipher(parseKeyRing(`k1:${k1}`));

  it("round-trips Vietnamese text and never produces the same ciphertext twice", () => {
    const first = cipher.encrypt("079123456789 — Nguyễn Văn Đạt", context);
    const second = cipher.encrypt("079123456789 — Nguyễn Văn Đạt", context);
    expect(first).not.toBe(second);
    expect(first).not.toContain("079123456789");
    expect(cipher.decrypt(first, context)).toBe("079123456789 — Nguyễn Văn Đạt");
    expect(cipher.decrypt(cipher.encrypt("", context), context)).toBe("");
  });

  it("refuses a value moved to another row or column, or tampered with", () => {
    const stored = cipher.encrypt("1234567890", context);
    expect(() => cipher.decrypt(stored, "person_sensitive.national_id:person-2")).toThrow(FieldCipherError);
    expect(() => cipher.decrypt(stored, "person_sensitive.bank_account:person-1")).toThrow(FieldCipherError);
    const parts = stored.split(".");
    // Replace the second-to-last character (all six of its bits are data) with a *different* one.
    // Choosing by the last character instead left the ciphertext unchanged once in 64 runs.
    parts[5] = parts[5].slice(0, -2) + (parts[5].at(-2) === "A" ? "B" : "A") + parts[5].slice(-1);
    expect(() => cipher.decrypt(parts.join("."), context)).toThrow(FieldCipherError);
    expect(() => cipher.decrypt("not-a-ciphertext", context)).toThrow("bad_format");
  });

  it("rotates keys by re-wrapping: old values stay readable, and move to the new key without changing the data part", () => {
    const stored = cipher.encrypt("secret", context);
    const rotated = createFieldCipher(parseKeyRing(`k2:${k2},k1:${k1}`));
    expect(rotated.decrypt(stored, context)).toBe("secret");
    expect(rotated.needsRewrap(stored)).toBe(true);

    const rewrapped = rotated.rewrap(stored, context);
    expect(rotated.needsRewrap(rewrapped)).toBe(false);
    expect(rewrapped.split(".").slice(4)).toEqual(stored.split(".").slice(4));
    // Once every value is re-wrapped, the old key can be retired.
    expect(createFieldCipher(parseKeyRing(`k2:${k2}`)).decrypt(rewrapped, context)).toBe("secret");
    expect(() => createFieldCipher(parseKeyRing(`k2:${k2}`)).decrypt(stored, context)).toThrow("unknown_key_k1");
  });
});

describe("parseKeyRing", () => {
  it("rejects short keys, duplicates and empty rings", () => {
    expect(() => parseKeyRing(`k1:${Buffer.from("short").toString("base64")}`)).toThrow("key_k1_is_not_32_bytes");
    expect(() => parseKeyRing(`k1:${k1},k1:${k2}`)).toThrow("duplicate_key_k1");
    expect(() => parseKeyRing("")).toThrow("no_keys");
    expect(parseKeyRing(`k2:${k2}, k1:${k1}`).activeKeyId).toBe("k2");
  });
});

describe("blindIndex", () => {
  it("is stable for the same value and differs across values, columns and keys", () => {
    const indexKey = randomBytes(32);
    expect(blindIndex(indexKey, "079123456789", "national_id")).toBe(blindIndex(indexKey, "079123456789", "national_id"));
    expect(blindIndex(indexKey, "079123456789", "national_id")).not.toBe(blindIndex(indexKey, "079123456780", "national_id"));
    expect(blindIndex(indexKey, "079123456789", "national_id")).not.toBe(blindIndex(indexKey, "079123456789", "tax_code"));
    expect(blindIndex(randomBytes(32), "079123456789", "national_id")).not.toBe(blindIndex(indexKey, "079123456789", "national_id"));
  });
});
