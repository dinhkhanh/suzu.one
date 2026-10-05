import { describe, expect, it } from "vitest";
import { BRAND_FILE_LIMITS, brandVisitorKey, retryAfterSeconds, windowStartFor, withinLimit } from "./rate-limit";

describe("the file route's fixed window", () => {
  const at = new Date("2026-10-05T03:10:30Z");

  it("starts on the hour's grid, and asks a refused caller to wait until it ends", () => {
    expect(windowStartFor(at, 3600).toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(retryAfterSeconds(at, 3600)).toBe(49 * 60 + 30);
    expect(retryAfterSeconds(new Date("2026-10-05T03:59:59.900Z"), 3600)).toBe(1);
  });

  it("allows the limit itself and refuses the one after", () => {
    expect(withinLimit(BRAND_FILE_LIMITS.download.max, BRAND_FILE_LIMITS.download)).toBe(true);
    expect(withinLimit(BRAND_FILE_LIMITS.download.max + 1, BRAND_FILE_LIMITS.download)).toBe(false);
    // A page of pictures costs more requests than a person's downloads do.
    expect(BRAND_FILE_LIMITS.preview.max).toBeGreaterThan(BRAND_FILE_LIMITS.download.max);
  });

  it("counts a visitor under a key that is theirs for a day and nobody's the next", () => {
    const key = brandVisitorKey("0123456789abcdef", at);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toBe("0123456789abcdef");
    expect(brandVisitorKey("0123456789abcdef", new Date("2026-10-05T23:59:59Z"))).toBe(key);
    expect(brandVisitorKey("0123456789abcdef", new Date("2026-10-06T00:00:00Z"))).not.toBe(key);
    expect(brandVisitorKey("fedcba9876543210", at)).not.toBe(key);
  });
});
