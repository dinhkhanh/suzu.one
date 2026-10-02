import { describe, expect, it } from "vitest";
import { isWindowAccepted, parseQrToken, QR_WINDOW_MS, qrToken, qrWindow } from "./kiosk-qr";

const session = "0b6c1f7e-3c2a-4d5e-9f10-112233445566";

describe("the kiosk's QR code", () => {
  it("round-trips a token", () => {
    const token = qrToken(session, 88_000_123, "abcdefghijklmnopqrstuv");
    expect(parseQrToken(token)).toEqual({ sessionId: session, window: 88_000_123, signature: "abcdefghijklmnopqrstuv" });
  });

  it("refuses anything that is not one", () => {
    for (const token of ["", "a.b.c", `${session}.12`, `${session}.x1.abcdefghijklmnopqrstuv`, `${session}.12.short`, `${session}.12.abcdefghijklmnopqrstuv.extra`]) expect(parseQrToken(token)).toBeNull();
  });

  it("keeps a code good for the current window and the two before it, never one from the future", () => {
    const now = 1_000 * QR_WINDOW_MS + 5_000;
    const current = qrWindow(now);
    expect(current).toBe(1_000);
    expect([current + 1, current, current - 1, current - 2, current - 3].map((window) => isWindowAccepted(window, now))).toEqual([false, true, true, true, false]);
  });
});
