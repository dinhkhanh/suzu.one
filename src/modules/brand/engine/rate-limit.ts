// Rate limiting for the public brand pages' file route (FR-BRD-04, NFR-SEC-03). Pure: the
// arithmetic of a fixed window, with no database and no clock of its own.
//
// The careers page's mechanism (`recruit/engine/rate-limit.ts`) and the client review link's
// (`work/engine/preview.ts`), in this module's own table: one row per (bucket, visitor, window) and
// one atomic `insert … on conflict do update set hits = hits + 1 returning hits`. It needs no second
// round trip and cannot race; the price is the boundary — a visitor who spends a whole allowance at
// 10:59 and again at 11:00 gets twice the limit across that minute — which is the right trade for a
// limit that exists to stop a script, not to meter a partner.
import { createHash } from "node:crypto";

export type BrandFileLimit = { max: number; windowSeconds: number };

/**
 * What one visitor may ask of the file route in an hour. Every request it answers signs a link on
 * the storage, and a download writes a counter row besides — without a limit, an anonymous loop is
 * a free way to make the product work.
 *
 * Generous on purpose: an agency behind one office address takes a whole kit, and a kit's page
 * draws a picture per file and per rule (a kit holds up to 200 files; the browser keeps each for
 * four minutes). A person is nowhere near either figure; a script is past both in seconds.
 *
 * Configuration in the sense that matters — one place, named, commented — and not database
 * configuration: raising it from a screen would be a way to turn the protection off.
 */
export const BRAND_FILE_LIMITS = {
  /** Pressing Download: a signed link and a counted download each. */
  download: { max: 120, windowSeconds: 60 * 60 },
  /** A picture drawn on the page: a signed link each, never counted as a download. */
  preview: { max: 1500, windowSeconds: 60 * 60 },
} as const satisfies Record<string, BrandFileLimit>;

export type BrandFileBucket = keyof typeof BRAND_FILE_LIMITS;

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
export const withinLimit = (hitsIncludingThisOne: number, limit: BrandFileLimit): boolean => hitsIncludingThisOne <= limit.max;

/**
 * How long a counted row is kept. It is a hash with an hour's resolution, and a week on it is
 * noise; the downloads the keepers read are counted elsewhere, per file and day, with no visitor
 * in them at all (FR-BRD-05).
 */
export const BRAND_HIT_RETENTION_DAYS = 7;

/** How long the key a visitor is counted under stays the same (PDPL, NFR-PRV-02): a day. */
export const BRAND_VISITOR_KEY_SECONDS = 24 * 60 * 60;

/**
 * The daily, one-way key this surface counts a visitor under — never an address, and never the
 * public pipeline's own `ipHash`, which does not change and so could be joined to every other row
 * that keeps it. Yesterday's counted request and today's cannot be told to be the same connection.
 */
export function brandVisitorKey(ipHash: string, at: Date): string {
  const period = windowStartFor(at, BRAND_VISITOR_KEY_SECONDS).getTime();
  return createHash("sha256").update(`brand:${period}:${ipHash}`).digest("hex").slice(0, 16);
}
