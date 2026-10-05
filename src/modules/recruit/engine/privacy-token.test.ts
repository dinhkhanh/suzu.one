import { describe, expect, it } from "vitest";
import { looksLikePrivacyToken, privacyToken, privacyTokenHash } from "./privacy-token";

const SECRET = "a-test-secret-long-enough-to-sign-with";
const id = "6f1c2c3e-8a4b-4c5d-9e0f-112233445566";

describe("privacyToken", () => {
  it("is the same for the same record and address, so every letter carries one link", () => {
    expect(privacyToken(SECRET, { id, emailKey: "mai@example.com" })).toBe(privacyToken(SECRET, { id, emailKey: "mai@example.com" }));
  });

  it("changes with the address, so a corrected address retires the old link", () => {
    expect(privacyToken(SECRET, { id, emailKey: "mai@example.com" })).not.toBe(privacyToken(SECRET, { id, emailKey: "mai.tran@example.com" }));
  });

  it("does not carry the record's id, and cannot be made without the secret", () => {
    const token = privacyToken(SECRET, { id, emailKey: "mai@example.com" });
    expect(token).not.toContain(id.slice(0, 8));
    expect(privacyToken("another-secret-entirely-of-some-length", { id, emailKey: "mai@example.com" })).not.toBe(token);
    expect(looksLikePrivacyToken(token)).toBe(true);
  });

  it("is stored only as a hash", () => {
    const token = privacyToken(SECRET, { id, emailKey: "mai@example.com" });
    expect(privacyTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(privacyTokenHash(token)).not.toContain(token);
  });

  it("refuses anything that could not be one before the database is asked", () => {
    expect(looksLikePrivacyToken("short")).toBe(false);
    expect(looksLikePrivacyToken(`${"a".repeat(42)}/`)).toBe(false);
  });
});
