// Retainers (FR-PJM-06): a monthly scope — a quota of register lines, an hours allowance and a fee
// — turned into one period per month, and what each month used of it. Pure: no I/O.
//
// A month is "YYYY-MM". Each period's lines are the retainer's line template, plus what the
// rollover rule carries in from the month before: under "rollover" the unused units of a line are
// added to next month's quota and units delivered beyond it are taken off (a negative carry); under
// "reset" every month starts from the template. Lines are matched month to month by title, so a
// line dropped from the template takes its carry with it.
//
// A retainer that starts or ends inside a month (the project's start or due date falls in its first
// or last month) gets that month's share of the quota, the hours and the fee, by calendar days.
import { addDays, type IsoDate } from "@/lib/dates";
import type { RetainerLineTemplate } from "../schema";

export type Month = string;
export const RETAINER_ROLLOVERS = ["reset", "rollover"] as const;
export type RetainerRollover = (typeof RETAINER_ROLLOVERS)[number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (value: string): boolean => MONTH.test(value);
export const monthOf = (date: IsoDate): Month => date.slice(0, 7);
export const firstDayOf = (month: Month): IsoDate => `${month}-01`;
export const lastDayOf = (month: Month): IsoDate => addDays(firstDayOf(addMonths(month, 1)), -1);
export const daysIn = (month: Month): number => Number(lastDayOf(month).slice(8, 10));

export function addMonths(month: Month, count: number): Month {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, both included; empty when `to` is before `from`. */
export function monthsBetween(from: Month, to: Month): Month[] {
  const months: Month[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

export type RetainerTerms = {
  startMonth: Month;
  endMonth: Month | null;
  lines: readonly RetainerLineTemplate[];
  minutesPerMonth: number | null;
  feePerMonthVnd: number | null;
  rollover: RetainerRollover;
  /** The project's own start and due dates: a first or last month they fall inside is a part month. */
  startDate?: IsoDate | null;
  endDate?: IsoDate | null;
};

/** The months that should have a period by `today`: from the start month to the end month or this month, whichever comes first. */
export function monthsDue(terms: Pick<RetainerTerms, "startMonth" | "endMonth">, today: IsoDate): Month[] {
  const current = monthOf(today);
  const last = terms.endMonth && terms.endMonth < current ? terms.endMonth : current;
  return monthsBetween(terms.startMonth, last);
}

/**
 * The share of a month the retainer covers, between 0 and 1: all of it, unless the project starts
 * or ends inside it. Counted in calendar days, both ends included.
 */
export function monthShare(month: Month, startDate?: IsoDate | null, endDate?: IsoDate | null): number {
  const first = firstDayOf(month);
  const last = lastDayOf(month);
  const from = startDate && startDate > first ? startDate : first;
  const to = endDate && endDate < last ? endDate : last;
  if (to < from) return 0;
  const covered = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return covered / daysIn(month);
}

/** A month's share of a whole-month figure; a full month is the figure itself. */
const shareOf = (value: number, share: number): number => (share >= 1 ? value : Math.round(value * share));

export type PreviousPeriod = { lines: readonly { title: string; quantity: number; consumed: number }[] };
export type PeriodLine = { title: string; quantity: number; format: string | null; channel: string | null };
export type PeriodPlan = {
  month: Month;
  share: number;
  /** Units carried in from last month by line title (negative = last month's over-delivery). */
  carried: Record<string, number>;
  lines: PeriodLine[];
  minutesAllowance: number | null;
  feeVnd: number | null;
};

/**
 * What last month leaves for this one, per line title. Under "rollover", a line's quota less what
 * was consumed — negative when more was delivered than promised. A quota that the carry took to
 * zero cannot go lower: an over-delivery bigger than a whole month is written off, not dragged on.
 */
export function carryFrom(rollover: RetainerRollover, previous: PreviousPeriod | null, titles: readonly string[]): Record<string, number> {
  if (rollover !== "rollover" || !previous) return {};
  const carried: Record<string, number> = {};
  for (const title of titles) {
    const lines = previous.lines.filter((line) => line.title === title);
    if (lines.length === 0) continue;
    const left = lines.reduce((sum, line) => sum + line.quantity - line.consumed, 0);
    if (left !== 0) carried[title] = left;
  }
  return carried;
}

/** One month of a retainer: its lines (quota plus carry, never below zero), hours and fee. */
export function planPeriod(terms: RetainerTerms, month: Month, previous: PreviousPeriod | null): PeriodPlan {
  const share = monthShare(month, terms.startDate, terms.endDate);
  const carried = carryFrom(terms.rollover, previous, terms.lines.map((line) => line.title));
  const lines = terms.lines.map((line) => ({ title: line.title, quantity: Math.max(0, shareOf(line.quantity, share) + (carried[line.title] ?? 0)), format: line.format, channel: line.channel }));
  return {
    month,
    share,
    carried,
    lines,
    minutesAllowance: terms.minutesPerMonth === null ? null : shareOf(terms.minutesPerMonth, share),
    feeVnd: terms.feePerMonthVnd === null ? null : shareOf(terms.feePerMonthVnd, share),
  };
}

/** Open periods whose month is over: closed by the midnight job, which bills their fee. */
export const monthsToClose = (periods: readonly { month: Month; status: string }[], today: IsoDate): Month[] => periods.filter((period) => period.status === "open" && period.month < monthOf(today)).map((period) => period.month);

// ── Consumption and overservicing ────────────────────────────────────────────────────────────

/** Quota alerts, in percent of a line's quota. Each is sent once per line and month. */
export const QUOTA_THRESHOLDS = [80, 100] as const;

export type UsageLevel = "ok" | "warning" | "full" | "over";
export type Usage = { contracted: number; consumed: number; remaining: number; /** consumed ÷ contracted, whole percent rounded down; null when nothing was promised or used. */ percent: number | null; level: UsageLevel };

/**
 * Overservicing of one line (or a whole month) = consumed ÷ contracted. A line with no quota left
 * that still gets work is at its limit already: 100%, and over.
 */
export function usage(contracted: number, consumed: number): Usage {
  const quota = Math.max(0, contracted);
  const used = Math.max(0, consumed);
  const percent = quota > 0 ? Math.floor((used / quota) * 100) : used > 0 ? 100 : null;
  const level: UsageLevel = percent === null ? "ok" : used > quota ? "over" : percent >= QUOTA_THRESHOLDS[1] ? "full" : percent >= QUOTA_THRESHOLDS[0] ? "warning" : "ok";
  return { contracted: quota, consumed: used, remaining: Math.max(0, quota - used), percent, level };
}

/** A month taken as a whole: every line's units added up. */
export const totalUsage = (lines: readonly { contracted: number; consumed: number }[]): Usage =>
  usage(
    lines.reduce((sum, line) => sum + Math.max(0, line.contracted), 0),
    lines.reduce((sum, line) => sum + Math.max(0, line.consumed), 0),
  );

/** The alert keys ("<lineId>:80") a line has crossed and not yet been warned about, lowest first. */
export function quotaAlertsDue(lineId: string, percent: number | null, alerted: readonly string[]): string[] {
  if (percent === null) return [];
  return QUOTA_THRESHOLDS.filter((threshold) => percent >= threshold && !alerted.includes(`${lineId}:${threshold}`)).map((threshold) => `${lineId}:${threshold}`);
}

/** The hours allowance against the minutes logged in the month. */
export const hoursUsage = (allowanceMinutes: number | null, loggedMinutes: number): Usage | null => (allowanceMinutes === null ? null : usage(allowanceMinutes, loggedMinutes));
