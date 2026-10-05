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
  /**
   * Fetching the file behind a link, per visitor. Counted apart from the page, so looking at the
   * work never spends the allowance for opening it. A picture is fetched once by the page that
   * shows it and once more by the client who taps it; a **video** is asked for again and again —
   * a phone's player comes back to the page's own address for each stretch it seeks to, and every
   * one of those is a fresh signature here — so the allowance is sized for somebody scrubbing
   * through a cut, not for one tap.
   */
  file: { max: 300, windowSeconds: 60 * 60 },
  /** Fetching the file of **one** link, counted per token, for the same reason as `token_view`. */
  token_file: { max: 600, windowSeconds: 60 * 60 },
  /** Deciding, per visitor. Room for a mistyped name and a second try, and no room for a habit. */
  decide: { max: 6, windowSeconds: 60 * 60 },
  /** Deciding on one link. A link takes one decision; this is the floods, not the arithmetic. */
  token_decide: { max: 6, windowSeconds: 60 * 60 },
  /**
   * Not a limit on anybody: the marker that makes a view an **audit entry once an hour** per
   * visitor per link (R14). The same counter, keyed by `previewViewAuditKey`; the first hit of a
   * window is "within the limit" and is written to the audit log, every later one is only counted
   * on the link. A client who reloads the page ten times is one line in an append-only log.
   */
  view_audit: { max: 1, windowSeconds: 60 * 60 },
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

/**
 * The key the once-an-hour audit marker is counted under: one visitor on one link. Hashed like
 * every other key in `work_preview_hit`, so the table still says only that *somebody* asked
 * *something* — neither the link nor the visitor can be read back out of it.
 */
export function previewViewAuditKey(tokenHash: string, visitorKey: string): string {
  return createHash("sha256").update(`view:${tokenHash}:${visitorKey}`).digest("hex").slice(0, 32);
}

// ── Who is asking: a person, or a machine on a person's behalf ─────────────────────────────────

/**
 * A review link is sent through a chat app, and every chat app **fetches the address the moment it
 * is pasted** to draw its little card — before the client has seen anything. Counted as views,
 * those fetches tell the account manager "the client has opened it" when nobody has (R14 promises
 * the views are the client's). So a request is sorted before anything is read or written:
 *
 *   · `view` — a browser with a person behind it. Counted, audited, shown the work.
 *   · `probe` — a `HEAD`: somebody asking whether the address answers. Never a reading.
 *   · `prefetch` — a browser fetching ahead of a person who has not asked yet (`Sec-Purpose`,
 *     `Purpose`, Firefox's `X-Moz`). If they do ask, the browser comes back properly.
 *   · `fetcher` — a link-preview fetcher, a crawler or a script, by its user agent.
 *
 * None of the last three is ever given the work, and none of them touches the database: the link
 * is not looked up, so the answer is the same for every token and says nothing about any of them.
 *
 * The user agent is what the caller says it is, so this is bookkeeping and not a defence — a
 * hostile caller is what the rate limits and the token are for. It errs towards **letting a
 * person in**: a client who cannot open their own work is a worse failure than a view counted for
 * a fetcher nobody has heard of, so the list names what is known and is otherwise permissive.
 */
export type PreviewRequestKind = "view" | "probe" | "prefetch" | "fetcher";

/**
 * Fetchers that draw a link's card in a chat or a feed, and the crawlers of the two search
 * engines, by a substring of their user agent (lower case). iMessage is here too: it announces
 * itself as `facebookexternalhit` and `Twitterbot`. Messenger and Instagram use Meta's fetcher.
 */
const PREVIEW_FETCHERS = ["facebookexternalhit", "meta-externalagent", "telegrambot", "slackbot", "slack-imgproxy", "whatsapp/", "twitterbot", "linkedinbot", "discordbot", "googlebot", "bingbot", "skypeuripreview"] as const;
/** What the rest of them call themselves. `preview` covers BingPreview, Google's and Teams' fetchers. */
const GENERIC_FETCHERS = ["bot", "crawler", "spider", "preview", "headless"] as const;
/** HTTP libraries: a script or somebody's server, never a person reading. */
const HTTP_LIBRARIES = ["curl/", "wget/", "python-", "go-http-client", "okhttp", "axios/", "node-fetch", "undici", "java/", "libwww"] as const;
/** A phone's or tablet's browser — including the one inside a chat app, which is a person reading. */
const HANDHELD = ["mobile", "android", "iphone", "ipad"] as const;

const mentions = (userAgent: string, words: readonly string[]) => words.some((word) => userAgent.includes(word));

/**
 * Whether a user agent is a machine fetching on somebody's behalf. No user agent at all is one:
 * every browser sends it.
 *
 * Two names need care. **Zalo** is both things: the browser *inside* the Zalo app on a phone names
 * Zalo in its user agent and is exactly the client this page is for, so only a Zalo that is not a
 * handheld browser — the desktop app and Zalo's own servers drawing a card — is a fetcher. And
 * **Cubot** is a make of phone, not a bot.
 */
export function isPreviewFetcher(userAgent: string | null | undefined): boolean {
  const agent = (userAgent ?? "").trim().toLowerCase().replaceAll("cubot", "");
  if (agent === "") return true;
  if (mentions(agent, PREVIEW_FETCHERS) || mentions(agent, GENERIC_FETCHERS) || mentions(agent, HTTP_LIBRARIES)) return true;
  return agent.includes("zalo") && !mentions(agent, HANDHELD);
}

/**
 * What a request to the review surface is. `purpose` is whichever of `Sec-Purpose`, `Purpose` and
 * `X-Moz` the request carried: a browser fetching or rendering ahead says `prefetch` in it
 * (Chrome's prerender says `prefetch;prerender`). Only a `GET` is ever fetched ahead, so the
 * client's answer — a `POST` — cannot be turned away by a header somebody added to it.
 */
export function previewRequestKind(request: { method?: string | null; userAgent: string | null | undefined; purpose?: string | null }): PreviewRequestKind {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "HEAD") return "probe";
  if (method === "GET" && (request.purpose ?? "").toLowerCase().includes("prefetch")) return "prefetch";
  return isPreviewFetcher(request.userAgent) ? "fetcher" : "view";
}

// ── The file behind a link ──────────────────────────────────────────────────────────────────

/** How long a signed storage URL lives for a picture or a document: fetched at once, or not at all. */
export const PREVIEW_FILE_LINK_SECONDS = 60;
/**
 * …and for a video the page plays in place. A player keeps asking the same signed address for more
 * of the file as the client watches and seeks, so a minute would end the film a minute in. Half an
 * hour covers a cut watched through; a longer sitting gets a fresh signature the next time the
 * player asks the page's own address, for as long as the review link itself is open.
 */
export const PREVIEW_MEDIA_LINK_SECONDS = 30 * 60;

// ── Why a link is taken back without anybody pressing the button ─────────────────────────────

/**
 * A live link outlives its reason in two ways, and the nightly sweep revokes both (R14): the
 * project it belongs to is finished or archived — there is nothing left to review — or the person
 * who made it has left the company, and a capability nobody inside is answerable for must not stay
 * open. The reason is what the audit entry says.
 */
export const PREVIEW_SWEEP_REASONS = ["project_closed", "creator_offboarded"] as const;
export type PreviewSweepReason = (typeof PREVIEW_SWEEP_REASONS)[number];

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
