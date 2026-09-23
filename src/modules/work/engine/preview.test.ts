// Golden tests for the client review link's pure half (D24, FR-PJM-51a): the token, the states a
// link passes through, and the limiter's arithmetic.
import { describe, expect, it } from "vitest";
import {
  hashPreviewToken,
  isPreviewTokenShaped,
  linkIsOpen,
  linkState,
  newPreviewToken,
  PREVIEW_DECISIONS,
  PREVIEW_LIMITS,
  PREVIEW_MAX_DAYS,
  previewCommentRequired,
  previewExpiresAt,
  previewTokenMatches,
  retryAfterSeconds,
  windowStartFor,
  withinLimit,
} from "./preview";

const at = (iso: string) => new Date(iso);
const facts = (over: Partial<Parameters<typeof linkState>[0]> = {}) => ({ expiresAt: at("2026-10-01T00:00:00Z"), revokedAt: null, decidedAt: null, viewCount: 0, ...over });

describe("the token", () => {
  it("is 32 random bytes, base64url, and never the same twice", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newPreviewToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 bytes in base64url, unpadded.
      expect(token).toHaveLength(43);
      expect(isPreviewTokenShaped(token)).toBe(true);
    }
  });

  it("is stored as SHA-256 of itself and matches only itself", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(previewTokenMatches(hash, token)).toBe(true);
    expect(previewTokenMatches(hash, newPreviewToken())).toBe(false);
  });

  it("refuses anything that is not shaped like one, before it is hashed or compared", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    for (const wrong of ["", "short", `${token}!`, `${token} `, "a".repeat(201), "../../etc/passwd", "%2e%2e"]) {
      expect(isPreviewTokenShaped(wrong)).toBe(false);
      expect(previewTokenMatches(hash, wrong)).toBe(false);
    }
  });

  it("compares a near-miss without ever returning true", () => {
    const token = newPreviewToken();
    const hash = hashPreviewToken(token);
    // One character different, and the same length: the case a non-constant-time compare leaks.
    const near = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(near).toHaveLength(token.length);
    expect(previewTokenMatches(hash, near)).toBe(false);
    // A hash of the wrong length is refused rather than throwing.
    expect(previewTokenMatches(hash.slice(0, 40), token)).toBe(false);
  });
});

describe("how long a link lives", () => {
  it("counts whole days forward and clamps what it is given", () => {
    const from = at("2026-09-23T10:00:00Z");
    expect(previewExpiresAt(from, 14).toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(previewExpiresAt(from, 1).toISOString()).toBe("2026-09-24T10:00:00.000Z");
    // Nobody makes a link that outlives the project, and nobody makes one that has already expired.
    expect(previewExpiresAt(from, 1000).toISOString()).toBe(previewExpiresAt(from, PREVIEW_MAX_DAYS).toISOString());
    expect(previewExpiresAt(from, 0).toISOString()).toBe(previewExpiresAt(from, 1).toISOString());
    expect(previewExpiresAt(from, -5).toISOString()).toBe(previewExpiresAt(from, 1).toISOString());
  });
});

describe("the state of a link", () => {
  const now = at("2026-09-24T00:00:00Z");

  it("is active until somebody opens it, and viewed after", () => {
    expect(linkState(facts(), now)).toBe("active");
    expect(linkState(facts({ viewCount: 3 }), now)).toBe("viewed");
    expect(linkIsOpen(facts({ viewCount: 3 }), now)).toBe(true);
  });

  it("expires on the second it says it does", () => {
    const expiring = facts({ expiresAt: now });
    expect(linkState(expiring, now)).toBe("expired");
    expect(linkState(expiring, new Date(now.getTime() - 1))).toBe("active");
    expect(linkIsOpen(expiring, now)).toBe(false);
  });

  it("is revoked whatever else is true of it, and decided before it is expired", () => {
    expect(linkState(facts({ revokedAt: now, decidedAt: now, viewCount: 9 }), now)).toBe("revoked");
    // A link that took its decision and then ran out is still the link that was answered.
    expect(linkState(facts({ decidedAt: at("2026-09-23T00:00:00Z"), expiresAt: at("2026-09-23T12:00:00Z") }), now)).toBe("decided");
    expect(linkIsOpen(facts({ decidedAt: now }), now)).toBe(false);
    expect(linkIsOpen(facts({ revokedAt: now }), now)).toBe(false);
  });
});

describe("what the client may say", () => {
  it("asks for a comment on anything but a plain approval", () => {
    expect(PREVIEW_DECISIONS).toEqual(["approved", "approved_with_changes", "changes_required"]);
    expect(previewCommentRequired("approved")).toBe(false);
    expect(previewCommentRequired("approved_with_changes")).toBe(true);
    expect(previewCommentRequired("changes_required")).toBe(true);
  });
});

describe("the rate limiter's arithmetic", () => {
  it("aligns every window to the same grid", () => {
    expect(windowStartFor(at("2026-09-23T10:37:41Z"), 3600).toISOString()).toBe("2026-09-23T10:00:00.000Z");
    expect(windowStartFor(at("2026-09-23T10:00:00Z"), 3600).toISOString()).toBe("2026-09-23T10:00:00.000Z");
  });

  it("allows exactly the limit and refuses the one after it", () => {
    const limit = PREVIEW_LIMITS.decide;
    expect(withinLimit(limit.max, limit)).toBe(true);
    expect(withinLimit(limit.max + 1, limit)).toBe(false);
  });

  it("asks a refused caller to wait until the window ends", () => {
    expect(retryAfterSeconds(at("2026-09-23T10:59:30Z"), 3600)).toBe(30);
    // Never zero: "try again in no time at all" is an invitation to a loop.
    expect(retryAfterSeconds(at("2026-09-23T10:59:59.999Z"), 3600)).toBe(1);
  });
});
