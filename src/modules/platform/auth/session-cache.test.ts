import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: { session: {} } }));

import { sessionKey, tokenOfCookie } from "./session-cache";

describe("session cache entries", () => {
  it("are named by a hash of the token, never the token", () => {
    const key = sessionKey("abc123token");
    expect(key).toMatch(/^auth:session:[0-9a-f]{32}$/);
    expect(key).not.toContain("abc123token");
    expect(sessionKey("abc123token")).toBe(key);
    expect(sessionKey("other")).not.toBe(key);
  });

  it("take the token before the cookie's signature, and nothing from an empty cookie", () => {
    expect(tokenOfCookie("tok.sig=")).toBe("tok");
    expect(tokenOfCookie("tok")).toBe("tok");
    expect(tokenOfCookie(".sig")).toBeNull();
    expect(tokenOfCookie("")).toBeNull();
    expect(tokenOfCookie(null)).toBeNull();
    expect(tokenOfCookie(undefined)).toBeNull();
  });
});
