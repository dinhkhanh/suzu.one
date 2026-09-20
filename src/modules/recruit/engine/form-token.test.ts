import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, MIN_FILL_MS, signFormToken, verifyFormToken } from "./form-token";

const SECRET = "a-test-secret-that-is-long-enough-to-be-real";
const SLUG = "kQ8rT3nZ_1a2b3c4d5e6f";
const issued = new Date("2026-09-20T10:00:00Z");
const after = (ms: number) => new Date(issued.getTime() + ms);

const token = signFormToken(SECRET, { slug: SLUG, issuedAt: issued });

describe("a token a person filled in at a human speed", () => {
  it("is accepted", () => {
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(45_000) })).toBe("ok");
  });

  it("is accepted right on the minimum, and refused a millisecond before it", () => {
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(MIN_FILL_MS) })).toBe("ok");
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(MIN_FILL_MS - 1) })).toBe("token_too_fast");
  });
});

describe("what it refuses", () => {
  it("a submission that arrived faster than anyone can type", () => {
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(200) })).toBe("token_too_fast");
  });

  it("a token that has gone stale", () => {
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(MAX_AGE_MS + 1) })).toBe("token_expired");
    expect(verifyFormToken(SECRET, token, { slug: SLUG, now: after(MAX_AGE_MS) })).toBe("ok");
  });

  it("a token minted for another opening — one form cannot be replayed across every job", () => {
    expect(verifyFormToken(SECRET, token, { slug: "another-opening-slug", now: after(45_000) })).toBe("token_invalid");
  });

  it("a token signed with another secret", () => {
    const forged = signFormToken("some-other-secret-entirely-different", { slug: SLUG, issuedAt: issued });
    expect(verifyFormToken(SECRET, forged, { slug: SLUG, now: after(45_000) })).toBe("token_invalid");
  });

  it("a timestamp edited to make an old token look fresh (the signature covers it)", () => {
    const [, signature] = token.split(".");
    expect(verifyFormToken(SECRET, `${after(-1000).getTime()}.${signature}`, { slug: SLUG, now: after(45_000) })).toBe("token_invalid");
  });

  it("a token from the future", () => {
    const later = signFormToken(SECRET, { slug: SLUG, issuedAt: after(60_000) });
    expect(verifyFormToken(SECRET, later, { slug: SLUG, now: issued })).toBe("token_invalid");
  });

  it("junk, in every shape a probe sends it", () => {
    for (const junk of ["", ".", "abc", "abc.def", `${issued.getTime()}`, `${issued.getTime()}.`, ".signature", "-1.x", `${Number.MAX_VALUE}.x`]) {
      expect(verifyFormToken(SECRET, junk, { slug: SLUG, now: after(45_000) })).toBe("token_invalid");
    }
  });

  it("a signature of the right shape but the wrong length (no timing leak, no crash)", () => {
    const [issuedAt, signature] = token.split(".");
    expect(verifyFormToken(SECRET, `${issuedAt}.${signature.slice(0, -2)}`, { slug: SLUG, now: after(45_000) })).toBe("token_invalid");
    expect(verifyFormToken(SECRET, `${issuedAt}.${signature}XX`, { slug: SLUG, now: after(45_000) })).toBe("token_invalid");
  });
});

describe("the token itself", () => {
  it("is deterministic for the same inputs and different for different ones", () => {
    expect(signFormToken(SECRET, { slug: SLUG, issuedAt: issued })).toBe(token);
    expect(signFormToken(SECRET, { slug: SLUG, issuedAt: after(1) })).not.toBe(token);
  });

  it("carries no secret: only a time and a signature", () => {
    expect(token.split(".")).toHaveLength(2);
    expect(Number(token.split(".")[0])).toBe(issued.getTime());
  });
});
