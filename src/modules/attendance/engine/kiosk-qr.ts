// The kiosk's QR code (FR-ATT-06): for a face the kiosk does not know, or a camera that will not
// cooperate. The kiosk shows a code that changes every few seconds; the person scans it with their
// own phone, already signed in, and checks in there. The code proves they stood in front of the
// kiosk a moment ago — a photo of it sent to a colleague at home is stale within a minute.
//
// Pure: the signature is computed by the caller (`kiosk.ts`, with the session's own secret).

export const QR_WINDOW_MS = 20_000;
/** The current window and the two before it: a code is good for 40–60 seconds after it appeared. */
export const QR_ACCEPTED_WINDOWS = 3;

export const qrWindow = (nowMs: number): number => Math.floor(nowMs / QR_WINDOW_MS);

/** What the signature covers: the kiosk session and the window. */
export const qrPayload = (sessionId: string, window: number): string => `${sessionId}.${window}`;

export const qrToken = (sessionId: string, window: number, signature: string): string => `${qrPayload(sessionId, window)}.${signature}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseQrToken(token: string): { sessionId: string; window: number; signature: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [sessionId, window, signature] = parts;
  if (!UUID.test(sessionId) || !/^\d{1,12}$/.test(window) || !/^[A-Za-z0-9_-]{16,64}$/.test(signature)) return null;
  return { sessionId, window: Number(window), signature };
}

/** Whether a code from `window` is still good at `nowMs`. One from the future is not. */
export function isWindowAccepted(window: number, nowMs: number): boolean {
  const current = qrWindow(nowMs);
  return window <= current && window > current - QR_ACCEPTED_WINDOWS;
}
