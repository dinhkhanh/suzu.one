import { describe, expect, it } from "vitest";
import { CAREERS_LIMITS, hitExpiresAt, retryAfterSeconds, windowStartFor, withinLimit } from "./rate-limit";

const at = (iso: string) => new Date(iso);

describe("windowStartFor", () => {
  it("aligns to the epoch grid, so every server agrees without talking", () => {
    expect(windowStartFor(at("2026-09-20T10:37:42.500Z"), 3600).toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(windowStartFor(at("2026-09-20T10:00:00.000Z"), 3600).toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(windowStartFor(at("2026-09-20T10:59:59.999Z"), 3600).toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(windowStartFor(at("2026-09-20T11:00:00.000Z"), 3600).toISOString()).toBe("2026-09-20T11:00:00.000Z");
  });

  it("works for windows that are not an hour", () => {
    expect(windowStartFor(at("2026-09-20T10:37:42Z"), 60).toISOString()).toBe("2026-09-20T10:37:00.000Z");
    expect(windowStartFor(at("2026-09-20T10:37:42Z"), 15 * 60).toISOString()).toBe("2026-09-20T10:30:00.000Z");
  });
});

describe("withinLimit", () => {
  it("counts the call being decided: the max-th submission is allowed, the next is not", () => {
    const limit = { max: 3, windowSeconds: 3600 };
    expect(withinLimit(1, limit)).toBe(true);
    expect(withinLimit(3, limit)).toBe(true);
    expect(withinLimit(4, limit)).toBe(false);
    expect(withinLimit(400, limit)).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("is the time left in the window, never zero", () => {
    expect(retryAfterSeconds(at("2026-09-20T10:00:00Z"), 3600)).toBe(3600);
    expect(retryAfterSeconds(at("2026-09-20T10:30:00Z"), 3600)).toBe(1800);
    // The last instant of a window still asks for at least a second.
    expect(retryAfterSeconds(at("2026-09-20T10:59:59.999Z"), 3600)).toBe(1);
  });
});

describe("the configured limits", () => {
  it("lets a person apply to several jobs in a sitting and stops a flood", () => {
    expect(CAREERS_LIMITS.apply.max).toBeGreaterThanOrEqual(3);
    expect(CAREERS_LIMITS.apply.max).toBeLessThanOrEqual(10);
    // Reading is cheaper than writing, so more of it is allowed.
    expect(CAREERS_LIMITS.form.max).toBeGreaterThan(CAREERS_LIMITS.apply.max);
  });
});

describe("hitExpiresAt", () => {
  it("keeps a counted row for two windows, so a sweep never removes a live one", () => {
    const start = at("2026-09-20T10:00:00Z");
    expect(hitExpiresAt(start, 3600).toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });
});
