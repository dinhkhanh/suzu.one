// The fixed window behind the kiosk's and the clocks' rate limits.
import { describe, expect, it } from "vitest";
import { ENDPOINT_LIMITS, retryAfterSeconds, windowStartFor, withinLimit } from "./rate-limit";

describe("the endpoints' rate limit", () => {
  it("aligns every caller's window to the same grid", () => {
    expect(windowStartFor(new Date("2026-10-05T03:00:00.000Z"), 60)).toEqual(new Date("2026-10-05T03:00:00Z"));
    expect(windowStartFor(new Date("2026-10-05T03:00:59.999Z"), 60)).toEqual(new Date("2026-10-05T03:00:00Z"));
    expect(windowStartFor(new Date("2026-10-05T03:01:00.000Z"), 60)).toEqual(new Date("2026-10-05T03:01:00Z"));
  });

  it("asks a refused caller to wait until the window ends, and never zero seconds", () => {
    expect(retryAfterSeconds(new Date("2026-10-05T03:00:20Z"), 60)).toBe(40);
    expect(retryAfterSeconds(new Date("2026-10-05T03:00:59.900Z"), 60)).toBe(1);
    expect(retryAfterSeconds(new Date("2026-10-05T03:00:00Z"), 60)).toBe(60);
  });

  it("allows the limit itself and refuses the one after", () => {
    expect(withinLimit(30, ENDPOINT_LIMITS.kiosk_punch)).toBe(true);
    expect(withinLimit(31, ENDPOINT_LIMITS.kiosk_punch)).toBe(false);
  });

  it("leaves a working kiosk room: naming a face four times a second is under the limit", () => {
    // The screen asks at most every 250 ms while it is naming somebody (`kiosk-screen.tsx`).
    expect(ENDPOINT_LIMITS.kiosk_identify.max).toBeGreaterThanOrEqual((ENDPOINT_LIMITS.kiosk_identify.windowSeconds * 1000) / 250);
    // And a punch a minute per person is far under a session's punches.
    expect(ENDPOINT_LIMITS.kiosk_punch.max).toBeGreaterThan(1);
  });
});
