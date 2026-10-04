// The arithmetic of the assistant's ceiling: windows on a grid, a Vietnamese day, the one call
// that crosses the line, and a provider's usage object reduced to two numbers.
import { describe, expect, it } from "vitest";
import { AI_LIMITS, bucketOf, isFirstRefusal, NO_USAGE, retryAfterSeconds, usageOf, windowStartFor, withinLimit } from "./limits";

describe("the windows", () => {
  it("puts a minute on the epoch grid, so every server agrees", () => {
    const limit = AI_LIMITS.ask_burst;
    expect(windowStartFor(new Date("2026-10-05T03:04:59.900Z"), limit).toISOString()).toBe("2026-10-05T03:04:00.000Z");
    expect(windowStartFor(new Date("2026-10-05T03:05:00.000Z"), limit).toISOString()).toBe("2026-10-05T03:05:00.000Z");
    expect(retryAfterSeconds(new Date("2026-10-05T03:04:45.000Z"), limit)).toBe(15);
  });

  it("starts a day at midnight in Vietnam, not at midnight UTC", () => {
    const limit = AI_LIMITS.ask_day;
    // 23:59 on the 5th and 00:01 on the 6th in Vietnam are 16:59 and 17:01 UTC on the 5th.
    expect(windowStartFor(new Date("2026-10-05T16:59:00Z"), limit).toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(windowStartFor(new Date("2026-10-05T17:01:00Z"), limit).toISOString()).toBe("2026-10-05T17:00:00.000Z");
    // An hour before Vietnamese midnight there is an hour left to wait.
    expect(retryAfterSeconds(new Date("2026-10-05T16:00:00Z"), limit)).toBe(3600);
  });

  it("allows the last one and refuses the next, and knows which call crossed the line", () => {
    const limit = { max: 3, windowSeconds: 60 };
    expect([1, 2, 3, 4, 5].map((hits) => withinLimit(hits, limit))).toEqual([true, true, true, false, false]);
    expect([3, 4, 5].map((hits) => isFirstRefusal(hits, limit))).toEqual([false, true, false]);
  });

  it("has a burst and a day window for a question and for a draft, the day the wider", () => {
    for (const kind of ["ask", "draft"] as const) {
      expect(AI_LIMITS[bucketOf(kind, "burst")].windowSeconds).toBeLessThan(AI_LIMITS[bucketOf(kind, "day")].windowSeconds);
      expect(AI_LIMITS[bucketOf(kind, "burst")].max).toBeLessThan(AI_LIMITS[bucketOf(kind, "day")].max);
    }
  });
});

describe("what a driver reported", () => {
  it("keeps the tokens in and out, counting what a prompt cache carried as sent", () => {
    expect(usageOf({ input_tokens: 5120, output_tokens: 340 })).toEqual({ inputTokens: 5120, outputTokens: 340 });
    expect(usageOf({ input_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100, output_tokens: 9 })).toEqual({ inputTokens: 5120, outputTokens: 9 });
  });

  it("is zero for anything that is not a count", () => {
    expect(usageOf(undefined)).toEqual(NO_USAGE);
    expect(usageOf({ input_tokens: "many", output_tokens: -4 })).toEqual(NO_USAGE);
  });
});
