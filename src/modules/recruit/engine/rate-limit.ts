// Rate limiting for the public careers page (FR-REC-03). Pure: the arithmetic of a fixed window,
// with no database and no clock of its own.
//
// **Fixed window, not sliding.** One row per (bucket, visitor, window) and one atomic
// `insert … on conflict do update set hits = hits + 1 returning hits` is the whole mechanism: it
// needs no background sweep, no sorted set and no second round trip, and it cannot race. The price
// is the boundary — a visitor who submits their whole allowance at 10:59 and again at 11:00 gets
// twice the limit across that minute. For an application form whose limit exists to stop floods
// and scripted spam, not to meter an API, that is the right trade, and it is written down here so
// nobody has to rediscover it.
//
// The window start is computed from epoch seconds, so every visitor's window aligns to the same
// grid and two servers agree without talking to each other.

export type RateLimit = { max: number; windowSeconds: number };

/**
 * What the careers page allows one visitor. Deliberately generous for reading and tight for
 * writing: a person comparing three openings and applying to two is normal; twenty applications
 * from one address in an hour is not a person.
 *
 * Configuration in the sense that matters — one place, named, commented — rather than a number
 * buried in a handler. Not database configuration: changing it is a deploy, and an administrator
 * who could raise it from a screen would be a way to turn the protection off.
 */
export const CAREERS_LIMITS = {
  /** A finished application, CV and all. */
  apply: { max: 6, windowSeconds: 60 * 60 },
  /** Opening the form (which mints a signed token): stops a script harvesting tokens to spend later. */
  form: { max: 60, windowSeconds: 60 * 60 },
  /**
   * Sending back a take-home (FR-REC-07). Tighter than an application, because a candidate sends
   * one piece of work back once — the allowance is for the person who uploads the wrong file twice
   * and then the right one, not for anybody with a habit.
   */
  assignment: { max: 4, windowSeconds: 60 * 60 },
  /** Opening a take-home brief. Generous: rereading the brief before starting is what people do. */
  assignment_view: { max: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimit>;

export type CareersBucket = keyof typeof CAREERS_LIMITS;

/** The start of the window `at` falls in, aligned to the epoch grid. */
export function windowStartFor(at: Date, windowSeconds: number): Date {
  const seconds = Math.floor(at.getTime() / 1000);
  return new Date(Math.floor(seconds / windowSeconds) * windowSeconds * 1000);
}

/** Seconds until the window holding `at` ends — what a refused caller is asked to wait. */
export function retryAfterSeconds(at: Date, windowSeconds: number): number {
  const start = windowStartFor(at, windowSeconds).getTime();
  return Math.max(1, Math.ceil((start + windowSeconds * 1000 - at.getTime()) / 1000));
}

/**
 * The verdict, given the hit count the database returned **after** counting this one. `hits === max`
 * is still allowed: the limit is how many are permitted, not how many precede the refusal.
 */
export function withinLimit(hitsIncludingThisOne: number, limit: RateLimit): boolean {
  return hitsIncludingThisOne <= limit.max;
}

/** How long a counted row is worth keeping: two windows, so the retention job never removes a live one. */
export function hitExpiresAt(windowStart: Date, windowSeconds: number): Date {
  return new Date(windowStart.getTime() + 2 * windowSeconds * 1000);
}
