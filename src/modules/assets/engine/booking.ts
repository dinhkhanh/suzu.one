// The booking calendar's rules (FR-AST-03). Pure: no I/O, no clock of its own — every function
// takes the instant it should reason from.
//
// Conflict *prevention* is the database's job (the exclusion constraint of migration 0056). What
// lives here is everything around it: what makes a window valid at all, whether an overlap exists
// among rows already in hand (so a form can say "the camera is taken" before it tries), and how a
// week's bookings are laid into lanes so a calendar can draw them without overlapping boxes.

/** A window of time, half-open: `[start, end)`. Touching windows do not clash. */
export type Window = { startAt: Date; endAt: Date };

/** Vietnam keeps one offset all year (UTC+7), so a day boundary is arithmetic, not a timezone database. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WindowProblem = "booking_end_before_start" | "booking_in_the_past" | "booking_too_long" | "booking_too_far_ahead";

/** A booking may run for a fortnight at most, and be made a year ahead at most. */
export const MAX_BOOKING_DAYS = 14;
export const MAX_BOOKING_HORIZON_DAYS = 365;

/**
 * What makes a window unbookable. A window that starts in the past is refused rather than
 * silently moved: gear taken out yesterday is a check-out somebody forgot to record, and that is
 * a different act from reserving it.
 */
export function windowProblems(window: Window, now: Date): WindowProblem[] {
  const problems: WindowProblem[] = [];
  const length = window.endAt.getTime() - window.startAt.getTime();
  if (length <= 0) problems.push("booking_end_before_start");
  // A few minutes' grace, so a form submitted at the top of the hour for that hour is not refused.
  if (window.startAt.getTime() < now.getTime() - 5 * 60 * 1000) problems.push("booking_in_the_past");
  if (length > MAX_BOOKING_DAYS * DAY_MS) problems.push("booking_too_long");
  if (window.startAt.getTime() > now.getTime() + MAX_BOOKING_HORIZON_DAYS * DAY_MS) problems.push("booking_too_far_ahead");
  return problems;
}

/** Half-open overlap: `[aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅`. */
export function overlaps(a: Window, b: Window): boolean {
  return a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime();
}

/** The first of `existing` that the wanted window runs into, or null. Order is the caller's. */
export function firstClash<T extends Window>(wanted: Window, existing: readonly T[]): T | null {
  return existing.find((candidate) => overlaps(wanted, candidate)) ?? null;
}

// ── Drawing a week ──────────────────────────────────────────────────────────────────────────

/** The Monday of the Vietnam week that `instant` falls in, as the instant that day begins there. */
export function weekStart(instant: Date): Date {
  const local = instant.getTime() + VN_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  // getUTCDay on the shifted value gives the Vietnam weekday; Sunday (0) belongs to the week before.
  const weekday = new Date(dayStart).getUTCDay();
  const backToMonday = (weekday + 6) % 7;
  return new Date(dayStart - backToMonday * DAY_MS - VN_OFFSET_MS);
}

/** The seven day-starts of the week containing `instant`, Monday first. */
export function weekDays(instant: Date): Date[] {
  const start = weekStart(instant);
  return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS));
}

export function shiftWeeks(instant: Date, weeks: number): Date {
  return new Date(weekStart(instant).getTime() + weeks * 7 * DAY_MS);
}

/** Which of the seven columns a window covers, as `[firstDay, lastDay]` clipped to the week. */
export function daySpan(window: Window, weekBegins: Date): { from: number; to: number } | null {
  const weekEnds = weekBegins.getTime() + 7 * DAY_MS;
  if (window.endAt.getTime() <= weekBegins.getTime() || window.startAt.getTime() >= weekEnds) return null;
  const from = Math.max(0, Math.floor((window.startAt.getTime() - weekBegins.getTime()) / DAY_MS));
  // A booking ending exactly at a day boundary ends on the previous day's column.
  const endOffset = window.endAt.getTime() - weekBegins.getTime();
  const lastMs = endOffset - 1;
  const to = Math.min(6, Math.floor(lastMs / DAY_MS));
  return { from, to: Math.max(from, to) };
}

export type Laid<T> = { item: T; from: number; to: number; lane: number };

/**
 * Lays windows into as few lanes as fit, so a calendar row draws each booking once with nothing
 * on top of anything else. Greedy by start, which is optimal for interval graphs; ties are broken
 * by the longer booking first so the long one takes the top lane and reads as the backdrop.
 */
export function layoutWeek<T extends Window>(items: readonly T[], weekBegins: Date): Laid<T>[] {
  const spans = items
    .map((item) => ({ item, span: daySpan(item, weekBegins) }))
    .filter((entry): entry is { item: T; span: { from: number; to: number } } => entry.span !== null)
    .sort((left, right) => left.span.from - right.span.from || right.span.to - left.span.to || left.item.startAt.getTime() - right.item.startAt.getTime());

  const laneEnds: number[] = [];
  return spans.map(({ item, span }) => {
    let lane = laneEnds.findIndex((end) => end < span.from);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(span.to);
    } else laneEnds[lane] = span.to;
    return { item, from: span.from, to: span.to, lane };
  });
}
