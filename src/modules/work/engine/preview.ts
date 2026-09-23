// The client's review link (D24, FR-PJM-51a), in the parts that are pure: minting a token, hashing
// it, comparing it without leaking a timing difference, reading a link's state from its own row,
// and the arithmetic of the rate limiter that stands in front of the page.
//
// No I/O, no clock and no configuration of its own — the time is always an argument, which is what
// makes expiry, revocation and "already decided" testable without a database.
//
// Two decisions worth stating here rather than discovering later:
//
//   · **The token is a capability, so it is never stored.** 32 random bytes, base64url, shown to
//     the account manager once; the row keeps SHA-256 of it. Nobody — the account manager, an
//     administrator, anyone reading the database — can recover a live link. Re-sending means
//     minting a new one, which is what makes the old one stop working.
//   · **Every way a link can be unusable answers the same.** `linkState` distinguishes them for the
//     people inside the company, who need to know whether to send a new one; the public page turns
//     everything but "active" into one sentence. A page that said *why* would be a machine for
//     probing tokens.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isClientStage } from "./delivery";

/** 256 bits. It is the only thing standing between the internet and one client's work. */
export const newPreviewToken = (): string => randomBytes(32).toString("base64url");

export const hashPreviewToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** The lengths a base64url encoding of 32 bytes can have, with room for an older or padded one. */
export const isPreviewTokenShaped = (token: string): boolean => /^[A-Za-z0-9_-]{32,200}$/.test(token);

/**
 * Whether a token matches a stored hash. The hash lookup is the fast path; this comparison is what
 * stops a timing difference being read off a near-miss, and it is the only way the two are ever
 * compared.
 */
export function previewTokenMatches(storedHash: string, token: string): boolean {
  if (!isPreviewTokenShaped(token)) return false;
  const left = Buffer.from(storedHash);
  const right = Buffer.from(hashPreviewToken(token));
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── How long a link lives ───────────────────────────────────────────────────────────────────

/** What the account manager gets if they say nothing: two weeks, a round of review and a reminder. */
export const PREVIEW_DEFAULT_DAYS = 14;
/** The longest anybody may make one. A link that outlives the project is a link nobody revokes. */
export const PREVIEW_MAX_DAYS = 60;
export const PREVIEW_MIN_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export function previewExpiresAt(from: Date, days: number): Date {
  const clamped = Math.min(PREVIEW_MAX_DAYS, Math.max(PREVIEW_MIN_DAYS, Math.round(days)));
  return new Date(from.getTime() + clamped * DAY_MS);
}

// ── What state a link is in ─────────────────────────────────────────────────────────────────

export type PreviewState = "active" | "viewed" | "decided" | "expired" | "revoked";

export type PreviewLinkFacts = { expiresAt: Date; revokedAt: Date | null; decidedAt: Date | null; viewCount: number };

/**
 * The state the people inside the company see. The order matters: a revoked link is revoked even
 * after it has expired, and a link that was decided is decided however long ago it was — what
 * happened to it is more useful than what the calendar says about it.
 */
export function linkState(link: PreviewLinkFacts, at: Date): PreviewState {
  if (link.revokedAt) return "revoked";
  if (link.decidedAt) return "decided";
  if (link.expiresAt.getTime() <= at.getTime()) return "expired";
  return link.viewCount > 0 ? "viewed" : "active";
}

/** The only question the public page asks. Everything else is one closed page with one sentence. */
export const linkIsOpen = (link: PreviewLinkFacts, at: Date): boolean => {
  const state = linkState(link, at);
  return state === "active" || state === "viewed";
};

// ── Rate limiting (NFR-SEC-03) ──────────────────────────────────────────────────────────────

export type PreviewLimit = { max: number; windowSeconds: number };

/**
 * What one visitor, and one link, may do in an hour. A fixed window, counted in
 * `work_preview_hit`: one row per (bucket, key, window) and one atomic upsert, with the boundary
 * softness that buys — the same trade, and the same reasoning, as the careers page's limiter.
 *
 * Deliberately generous for looking and tight for deciding. A client opens the work on their phone,
 * shows it to two colleagues and opens it again tomorrow; nobody decides five times.
 *
 * Configuration in the sense that matters — one place, named, commented — and not database
 * configuration: raising it from a screen would be a way to turn the protection off.
 */
export const PREVIEW_LIMITS = {
  /** Opening any preview page, counted per visitor — what stops a script walking the token space. */
  view: { max: 60, windowSeconds: 60 * 60 },
  /** Opening **one** link, counted per token: a leaked link cannot be hammered from everywhere. */
  token_view: { max: 120, windowSeconds: 60 * 60 },
  /** Deciding, per visitor. Room for a mistyped name and a second try, and no room for a habit. */
  decide: { max: 6, windowSeconds: 60 * 60 },
  /** Deciding on one link. A link takes one decision; this is the floods, not the arithmetic. */
  token_decide: { max: 6, windowSeconds: 60 * 60 },
} as const satisfies Record<string, PreviewLimit>;

export type PreviewBucket = keyof typeof PREVIEW_LIMITS;

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

/**
 * How long a counted row is kept. They are hashes with an hour's resolution and a week on they are
 * noise; keeping them longer would be keeping something about a client's browsing for no reason
 * (PDPL storage limitation).
 */
export const PREVIEW_HIT_RETENTION_DAYS = 7;

/** The verdict, given the count the database returned **after** counting this one. */
export const withinLimit = (hitsIncludingThisOne: number, limit: PreviewLimit): boolean => hitsIncludingThisOne <= limit.max;

/**
 * How long the key a visitor is counted under stays the same. The public pipeline's `ipHash` is
 * HMAC of the address under the application secret and never changes, so a row keeping it could be
 * joined to any other row keeping it, years apart — which is what makes a keyed hash of an address
 * pseudonymous rather than anonymous (PDPL, NFR-PRV-02). This surface re-keys it once a day, so
 * yesterday's counted request and today's cannot be told to be the same connection, and the
 * fingerprint on a decision the audit log keeps for years stops meaning anything the next morning.
 */
export const PREVIEW_VISITOR_KEY_SECONDS = 24 * 60 * 60;

/** The daily, one-way key this surface counts and audits a visitor under. Never an address. */
export function previewVisitorKey(ipHash: string, at: Date): string {
  const period = windowStartFor(at, PREVIEW_VISITOR_KEY_SECONDS).getTime();
  return createHash("sha256").update(`preview:${period}:${ipHash}`).digest("hex").slice(0, 16);
}

// ── What a client may be shown ──────────────────────────────────────────────────────────────

/**
 * Whether the company has finished with a version internally, so a client may look at it and say
 * something about it (FR-PJM-51a: a link is *to one deliverable version*).
 *
 * `stage` is the chain stage the version waits at, or null when no chain applies:
 *
 *   · **Approved** — the internal review passed, or the client already approved it. Always shown.
 *   · **Changes required, or superseded** — the company itself sent it back. Never shown: the
 *     client would be reviewing work we have already rejected.
 *   · **Pending with no chain** — the single-step review, where the account manager handing the
 *     link out *is* the company's decision to show it. Shown.
 *   · **Pending inside a chain** — the chain is an explicit statement that named internal stages
 *     come first (FR-PJM-50), so only the client's own stage may be shown.
 */
export function clientMayReview(deliverable: { decision: string }, stage: { reviewer: string } | null): boolean {
  if (deliverable.decision === "approved") return true;
  if (deliverable.decision !== "pending") return false;
  return stage === null || isClientStage(stage);
}

// ── What the client may say ─────────────────────────────────────────────────────────────────

/**
 * The three answers the page offers, in the client's words. They are the stage decisions of
 * FR-PJM-50 under different names: a link writes the same `work_deliverable_decision` the account
 * manager's own recording writes, so the review chain, the rounds and the frozen version behave
 * identically whichever way the decision arrived.
 */
export const PREVIEW_DECISIONS = ["approved", "approved_with_changes", "changes_required"] as const;
export type PreviewDecision = (typeof PREVIEW_DECISIONS)[number];

/** Anything but a plain approval needs the client to say what they want changed. */
export const previewCommentRequired = (decision: PreviewDecision): boolean => decision !== "approved";

export const PREVIEW_NAME_MAX = 120;
export const PREVIEW_COMMENT_MAX = 4000;
export const PREVIEW_MESSAGE_MAX = 2000;
export const PREVIEW_LABEL_MAX = 200;
