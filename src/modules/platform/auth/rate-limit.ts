// Rate limiting for the way in (NFR-SEC-03): Better Auth's endpoints under `/api/auth/*`, counted
// per address, and the step-up round trip (`/api/step-up/*`), counted per session. Pure: the
// arithmetic of a fixed window, with no database and no clock of its own — the careers page's
// mechanism (`recruit/engine/rate-limit.ts`), in this module's own words.
//
// **Fixed window, not sliding**: one row per (bucket, key, window) and one atomic upsert that
// returns the count. A caller may spend two allowances across the turn of a window; for limits that
// exist to stop a script working the sign-in flow, not to meter anybody, that is the right trade.
//
// **Per address, and the office is one address.** Everybody at a SuZu office reaches the app from
// the same public IP, so the sign-in allowance is sized for a Monday morning of the whole office
// signing in, not for one person.

export type RateLimit = { max: number; windowSeconds: number };

/**
 * Configuration in the sense that matters — one place, named, commented — and not database
 * configuration: raising it from a screen would be a way to turn the protection off.
 */
export const AUTH_LIMITS = {
  /**
   * Starting a Google sign-in and Google's callback: two calls per sign-in. Sixty a minute is thirty
   * people of one office signing in within the same minute — more than a Monday at 08:00 brings —
   * and a slow crawl for a script trying codes or states on the callback.
   */
  sign_in: { max: 60, windowSeconds: 60 },
  /** Everything else Better Auth answers (reading the session, signing out). The app reads the session on the server, so a browser rarely calls these. */
  session: { max: 300, windowSeconds: 60 },
  /** The step-up round trip (FR-PLT-06), per session: a person proves who they are a few times a day, not ten times in ten minutes. */
  step_up: { max: 10, windowSeconds: 600 },
} as const satisfies Record<string, RateLimit>;

export type AuthBucket = keyof typeof AUTH_LIMITS;

/** How long a counted window is kept: a day on, a minute's count says nothing to anybody. */
export const AUTH_HIT_RETENTION_DAYS = 1;

/** Which allowance a request to Better Auth's handler spends, from its path under `/api/auth`. */
export function authBucketOf(pathname: string): AuthBucket {
  const path = pathname.replace(/^\/api\/auth/, "");
  return /^\/(sign-in|callback|oauth2)(\/|$)/.test(path) ? "sign_in" : "session";
}

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
