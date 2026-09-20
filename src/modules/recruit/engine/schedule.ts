// The arithmetic of putting an interview in the diary (FR-REC-06). Pure: no clock of its own, no
// database, no configuration — every instant is an argument, which is what makes "does this clash"
// a thing that can be tested rather than a thing that is hoped for.

export const MIN_INTERVIEW_MINUTES = 10;
export const MAX_INTERVIEW_MINUTES = 8 * 60;
/** How far back an interview may be recorded. Somebody writing up yesterday's call is normal; last year is a typo. */
export const MAX_BACKDATE_DAYS = 14;
/** And how far ahead. A year out is a typo too. */
export const MAX_AHEAD_DAYS = 365;

export type SchedulingProblem =
  | "interview_ends_before_it_starts"
  | "interview_too_short"
  | "interview_too_long"
  | "interview_too_far_back"
  | "interview_too_far_ahead"
  | "interview_no_interviewer";

export type SchedulingDraft = { startAt: Date; endAt: Date; interviewerPersonIds: readonly string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything wrong with a draft, in the order a person would notice it. Empty means it can be booked. */
export function schedulingProblems(draft: SchedulingDraft, now: Date): SchedulingProblem[] {
  const problems: SchedulingProblem[] = [];
  const minutes = (draft.endAt.getTime() - draft.startAt.getTime()) / 60_000;
  if (minutes <= 0) problems.push("interview_ends_before_it_starts");
  else if (minutes < MIN_INTERVIEW_MINUTES) problems.push("interview_too_short");
  else if (minutes > MAX_INTERVIEW_MINUTES) problems.push("interview_too_long");

  const daysFromNow = (draft.startAt.getTime() - now.getTime()) / DAY_MS;
  if (daysFromNow < -MAX_BACKDATE_DAYS) problems.push("interview_too_far_back");
  if (daysFromNow > MAX_AHEAD_DAYS) problems.push("interview_too_far_ahead");

  if (new Set(draft.interviewerPersonIds).size === 0) problems.push("interview_no_interviewer");
  return problems;
}

export type Block = { startAt: Date; endAt: Date };

/**
 * Half-open overlap: a two-o'clock interview does not clash with one that ended at two. Getting
 * this wrong makes a back-to-back afternoon look impossible.
 */
export const overlaps = (left: Block, right: Block): boolean => left.startAt < right.endAt && right.startAt < left.endAt;

export type BusyBlock = Block & { interviewId: string; title: string };

/** Which of a person's existing interviews the proposed slot runs into. */
export function clashesWith(proposed: Block, busy: readonly BusyBlock[], exceptInterviewId?: string): BusyBlock[] {
  return busy.filter((block) => block.interviewId !== exceptInterviewId && overlaps(proposed, block));
}

/**
 * The calendar days an interview touches, in a given zone — what the availability panel asks the
 * leave module about. An interview never spans more than a day in practice, but a late slot and a
 * time-zone offset can still put its two ends on different dates.
 */
export function daysTouched(block: Block, timeZone: string): string[] {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const first = formatter.format(block.startAt);
  const last = formatter.format(block.endAt);
  return first === last ? [first] : [first, last];
}
