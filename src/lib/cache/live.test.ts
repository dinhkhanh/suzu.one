import { describe, expect, it, vi } from "vitest";

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn(async () => undefined) }));
vi.mock("./index", () => ({ TTL: { reference: 3600, personal: 300, live: 60 }, cached: vi.fn(), invalidate }));

import { invalidateLive, LIVE_SCREENS, liveKey } from "./live";

describe("live cache keys", () => {
  it("names one entry per person and screen, today's by its date", () => {
    expect(liveKey("p1", "shell")).toBe("live:p1:shell");
    expect(liveKey("p1", "today", "2026-09-25")).toBe("live:p1:today:2026-09-25");
  });

  it("drops every screen of every person named, once each", async () => {
    await invalidateLive("p1", "p2", "p1");
    expect(invalidate).toHaveBeenCalledTimes(1);
    const keys = invalidate.mock.calls[0] as unknown as string[];
    expect(keys).toHaveLength(2 * LIVE_SCREENS.length);
    expect(keys).toContain("live:p2:tasks");
    expect(keys.filter((key) => key.startsWith("live:p1:today:"))).toHaveLength(1);
  });
});
