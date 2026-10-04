// Rate limiting for the endpoints nobody signs in to (NFR-SEC-03): a kiosk tablet's
// `/api/kiosk/*` and a clock's `/api/attendance/device/*`. Pure: the arithmetic of a fixed window,
// with no database and no clock of its own — the careers page's mechanism
// (`recruit/engine/rate-limit.ts`), in this module's own words because a module reaches another
// only through its service.
//
// **Fixed window, not sliding**: one row per (bucket, key, window) and one atomic upsert that
// returns the count. The price is the boundary — a caller may spend two allowances across the turn
// of a minute — and for limits that exist to stop a stolen cookie or token being worked by a
// script, not to meter anybody, that is the right trade.

export type RateLimit = { max: number; windowSeconds: number };

/**
 * What one kiosk session, or one clock, may ask in a minute. Set well above what the thing does
 * when it works — a refused kiosk shows "lost the connection" until the minute turns — and well
 * below what a script holding its credential would want.
 *
 * Configuration in the sense that matters — one place, named, commented — and not database
 * configuration: raising it from a screen would be a way to turn the protection off.
 */
export const ENDPOINT_LIMITS = {
  /** Naming a face. The screen asks at most four times a second while somebody stands in front of it. */
  kiosk_identify: { max: 300, windowSeconds: 60 },
  /** Punching. A person takes several seconds at the tablet (the head turn); thirty a minute is a queue nobody has. */
  kiosk_punch: { max: 30, windowSeconds: 60 },
  /** "Not me". */
  kiosk_undo: { max: 10, windowSeconds: 60 },
  /** The QR codes: half an hour of them per call, asked for twice an hour and every 30 seconds while offline. */
  kiosk_qr: { max: 20, windowSeconds: 60 },
  /** A clock's own punches (tools/face-kiosk): a post per punch at the door, a heartbeat otherwise. */
  device_punches: { max: 60, windowSeconds: 60 },
  /** A clock's roster: fetched now and then, and when HR presses "sync" on it. */
  device_roster: { max: 12, windowSeconds: 60 },
} as const satisfies Record<string, RateLimit>;

export type EndpointBucket = keyof typeof ENDPOINT_LIMITS;

/** How long a counted window is kept: a day on, a minute's count says nothing to anybody. */
export const ENDPOINT_HIT_RETENTION_DAYS = 1;

/** The start of the window `at` falls in, aligned to the epoch grid so two servers agree. */
export function windowStartFor(at: Date, windowSeconds: number): Date {
  const seconds = Math.floor(at.getTime() / 1000);
  return new Date(Math.floor(seconds / windowSeconds) * windowSeconds * 1000);
}

/** Seconds until the window holding `at` ends — what a refused caller is asked to wait. */
export function retryAfterSeconds(at: Date, windowSeconds: number): number {
  const start = windowStartFor(at, windowSeconds).getTime();
  return Math.max(1, Math.ceil((start + windowSeconds * 1000 - at.getTime()) / 1000));
}

/** The verdict, given the count the database returned **after** counting this one. */
export const withinLimit = (hitsIncludingThisOne: number, limit: RateLimit): boolean => hitsIncludingThisOne <= limit.max;
