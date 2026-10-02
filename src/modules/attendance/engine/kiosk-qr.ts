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

// ── Handing the kiosk its codes in batches ──────────────────────────────────────────────────
//
// The kiosk asks for the codes of the next few minutes at once and shows each in its window, so
// it calls the server twice an hour instead of every few seconds. A code it holds is no use
// before its window starts (`isWindowAccepted`), so knowing the next ones proves nothing early.

/** Windows handed out per request: half an hour of codes, so a kiosk asks about twice an hour. */
export const QR_BATCH_WINDOWS = 90;
/** Ask again when fewer than this many of the held windows are still to come. */
export const QR_REFILL_BELOW = 3;

export type QrCode = { window: number; url: string };

/** The code to show at `nowMs` (on the server's clock): the one of the current window, or null. */
export const currentQr = (codes: readonly QrCode[], nowMs: number): QrCode | null => codes.find((code) => code.window === qrWindow(nowMs)) ?? null;

/** Whether the kiosk should ask for the next batch: it is running out, or holds nothing for now. */
export function needsMoreQr(codes: readonly QrCode[], nowMs: number): boolean {
  const current = qrWindow(nowMs);
  return !codes.some((code) => code.window === current) || codes.filter((code) => code.window > current).length < QR_REFILL_BELOW;
}

// ── The nightly reload ─────────────────────────────────────────────────────────────────────
//
// A wall tablet keeps one page open for weeks, running whatever script it loaded first. It reloads
// itself once a night, while nobody is in front of it, so it picks up a new version on its own.

/** The hour (Vietnam time) the kiosk reloads itself. */
export const KIOSK_RELOAD_HOUR = 3;

/** Whether to reload now: the reload hour in Vietnam, the page loaded over an hour ago, and the screen idle. */
export function shouldReload(nowMs: number, loadedAtMs: number, idle: boolean): boolean {
  const vietnamHour = new Date(nowMs + 7 * 3_600_000).getUTCHours();
  return idle && vietnamHour === KIOSK_RELOAD_HOUR && nowMs - loadedAtMs > 3_600_000;
}
