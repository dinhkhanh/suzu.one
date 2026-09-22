// Value lists of the person's day, shared by the server and the screens. A plain module on
// purpose: constants exported from a "use client" file are client references on the server.

/** A team rule is off, optional (the screens offer it) or required (reminders, the board counts it). */
export const RULE_MODES = ["off", "optional", "required"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** ISO weekdays, 1 = Monday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Time not spent on a task (FR-PJM-24). */
export const TIME_CATEGORIES = ["internal", "admin", "pitch", "training", "idle"] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

/** A lead's "seen" on a report, without words: one tap, one meaning. */
export const REPORT_REACTIONS = ["👍", "👀", "🎉", "💪"] as const;

/** Project kinds whose hours are billed to a client: their time is billable unless said otherwise. */
export const BILLABLE_PROJECT_KINDS = ["client", "retainer"] as const;

/** A person's hours on a day nobody scheduled (no work schedule applies). */
export const DEFAULT_DAY_MINUTES = 8 * 60;
