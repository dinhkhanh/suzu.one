// A ceiling on the assistant (FR-AI-06, NFR-SEC-03: "rate limiting on … AI endpoints"). Pure: the
// limits and the arithmetic of a fixed window, with no database and no clock of its own.
//
// The careers page's mechanism (`recruit/engine/rate-limit.ts`), counted per person instead of per
// visitor: one row per (bucket, person, window) in `ai_usage_hit` and one atomic upsert whose
// returned count already includes this call. The price of a fixed window is its boundary — a
// person who spends a whole allowance at 10:59:59 gets another at 11:00:00 — and for a limit that
// exists to stop a runaway script and a surprising bill, not to meter an API, that is the right
// trade.
//
// Two windows per kind of use, because they stop different things: the BURST window stops a loop
// (a stuck client, a script holding somebody's session), the DAY window is the ceiling on what one
// person can cost. A day is the Vietnamese day, so "today's limit" means what it says.

export type AiLimit = { max: number; windowSeconds: number; /** The grid's offset from the epoch: +7h puts a day window on Vietnam's midnight. */ offsetSeconds?: number };

const VIETNAM_OFFSET_SECONDS = 7 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * What one person may ask of the assistant. Company practice, so it is in one place, named and
 * commented — and not database configuration: a limit an administrator could raise from a screen
 * is a protection that can be switched off from a screen. Changing it is a deploy.
 *
 * The numbers are sized for people, with room: nobody types ten questions in a minute or a
 * hundred in a day; a draft is a button beside a form, pressed a few times while writing it.
 */
export const AI_LIMITS = {
  /** Questions to the assistant (`ai.ask`), per minute. */
  ask_burst: { max: 10, windowSeconds: 60 },
  /** Questions per Vietnamese day — the ceiling on what one person's chat can cost. */
  ask_day: { max: 100, windowSeconds: DAY_SECONDS, offsetSeconds: VIETNAM_OFFSET_SECONDS },
  /** Drafts (`ai.draft.*`, all three kinds together), per minute. */
  draft_burst: { max: 5, windowSeconds: 60 },
  /** Drafts per Vietnamese day. */
  draft_day: { max: 40, windowSeconds: DAY_SECONDS, offsetSeconds: VIETNAM_OFFSET_SECONDS },
} as const satisfies Record<string, AiLimit>;

export type AiBucket = keyof typeof AI_LIMITS;
/** The two things that are counted: a question, and a draft of any kind. */
export type AiUseKind = "ask" | "draft";
export type AiLimitScope = "burst" | "day";

export const bucketOf = (kind: AiUseKind, scope: AiLimitScope): AiBucket => `${kind}_${scope}`;

/** The start of the window `at` falls in, on a grid every server agrees on without talking. */
export function windowStartFor(at: Date, limit: AiLimit): Date {
  const offset = limit.offsetSeconds ?? 0;
  const seconds = Math.floor(at.getTime() / 1000) + offset;
  return new Date((Math.floor(seconds / limit.windowSeconds) * limit.windowSeconds - offset) * 1000);
}

/** Seconds until the window holding `at` ends — what a refused caller is asked to wait. */
export function retryAfterSeconds(at: Date, limit: AiLimit): number {
  const start = windowStartFor(at, limit).getTime();
  return Math.max(1, Math.ceil((start + limit.windowSeconds * 1000 - at.getTime()) / 1000));
}

/** The verdict, given the count the database returned **after** counting this one. */
export const withinLimit = (hitsIncludingThisOne: number, limit: AiLimit): boolean => hitsIncludingThisOne <= limit.max;

/**
 * Whether this is the call that crossed the line. The upsert hands every caller a different count,
 * so exactly one call per window sees `max + 1` — that one is audited, and the hundred after it
 * from the same stuck loop are not.
 */
export const isFirstRefusal = (hitsIncludingThisOne: number, limit: AiLimit): boolean => hitsIncludingThisOne === limit.max + 1;

/** How long a counted window is kept: a week on it says nothing a limiter needs. */
export const AI_HIT_RETENTION_DAYS = 7;

/** What a model call cost, as the driver reported it. The local driver sends nothing: zero. */
export type TokenUsage = { inputTokens: number; outputTokens: number };
export const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * A Messages API `usage` object, kept only as two non-negative integers. Input read from or
 * written to a prompt cache is reported beside `input_tokens`, not inside it; nothing here caches
 * a prompt today, and the day something does the total is still everything that was sent.
 */
export function usageOf(reported: { input_tokens?: unknown; output_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown } | null | undefined): TokenUsage {
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
  return { inputTokens: count(reported?.input_tokens) + count(reported?.cache_creation_input_tokens) + count(reported?.cache_read_input_tokens), outputTokens: count(reported?.output_tokens) };
}
