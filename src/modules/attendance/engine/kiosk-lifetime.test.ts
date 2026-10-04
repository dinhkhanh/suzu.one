// How long a tablet stays a kiosk: two weeks without use, three months in all.
import { describe, expect, it } from "vitest";
import { KIOSK_IDLE_DAYS, KIOSK_MAX_DAYS, kioskExpiresAt, kioskLapse } from "./kiosk-lifetime";

const DAY = 86_400_000;
const openedAt = new Date("2026-10-01T02:00:00Z");
const after = (days: number, ms = 0) => new Date(openedAt.getTime() + days * DAY + ms);

describe("a kiosk's lifetime", () => {
  it("is two weeks without use and ninety days in all", () => {
    expect([KIOSK_IDLE_DAYS, KIOSK_MAX_DAYS]).toEqual([14, 90]);
  });

  it("runs from its opening for a kiosk that never called in", () => {
    const session = { openedAt, lastSeenAt: null };
    expect(kioskExpiresAt(session)).toEqual(after(14));
    expect(kioskLapse(session, after(14, -1))).toBeNull();
    expect(kioskLapse(session, after(14))).toBe("idle");
  });

  it("rolls: each use gives it two more weeks", () => {
    const session = { openedAt, lastSeenAt: after(20) };
    expect(kioskExpiresAt(session)).toEqual(after(34));
    expect(kioskLapse(session, after(33))).toBeNull();
    expect(kioskLapse(session, after(34))).toBe("idle");
  });

  it("never rolls past the hard maximum", () => {
    const session = { openedAt, lastSeenAt: after(89) };
    expect(kioskExpiresAt(session)).toEqual(after(90));
    expect(kioskLapse(session, after(90, -1))).toBeNull();
    expect(kioskLapse(session, after(90))).toBe("max");
    // Used that very minute, and still over.
    expect(kioskLapse({ openedAt, lastSeenAt: after(95) }, after(95))).toBe("max");
  });

  it("does not take a last-seen from before the opening for a use", () => {
    expect(kioskExpiresAt({ openedAt, lastSeenAt: after(-30) })).toEqual(after(14));
  });
});
