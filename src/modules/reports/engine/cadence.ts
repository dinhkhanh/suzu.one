// When a scheduled report next falls due (FR-RPT-05). Pure: dates in, dates out, no clock.
//
// Everything is in Vietnam's calendar day — the caller converts; there are no times of day here.
// The job runs each morning and takes whatever is due on or before today, so a missed day (a
// failed run, a server asleep) does not lose a report: it is sent late, once, and the next date is
// computed from the day it was sent, never from the day it was supposed to be sent. That keeps a
// schedule that has fallen behind from firing a burst of catch-up reports.

export type Cadence = "daily" | "weekly" | "monthly";

export type Schedule = {
  cadence: Cadence;
  /** weekly: 1 = Monday … 7 = Sunday. Ignored otherwise. */
  dayOfWeek: number | null;
  /** monthly: 1–31; a day past the end of a short month becomes its last day. Ignored otherwise. */
  dayOfMonth: number | null;
};

const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
/** 1 = Monday … 7 = Sunday, the way people say it and ISO-8601 numbers it. */
export const isoDayOfWeek = (date: string): number => new Date(parse(date)).getUTCDay() || 7;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function clampDayOfWeek(day: number | null | undefined): number {
  return Number.isInteger(day) && day! >= 1 && day! <= 7 ? day! : 1;
}

export function clampDayOfMonth(day: number | null | undefined): number {
  return Number.isInteger(day) && day! >= 1 && day! <= 31 ? day! : 1;
}

/** The date in `year`-`month` a "day 31" schedule means: the last day when the month is shorter. */
function dayIn(year: number, month: number, wanted: number): string {
  const day = Math.min(wanted, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The first date on or after `from` that the schedule falls on.
 * `from` itself qualifies — a schedule created on its own day runs that morning.
 */
export function nextRunOnOrAfter(schedule: Schedule, from: string): string {
  switch (schedule.cadence) {
    case "daily":
      return from;
    case "weekly": {
      const wanted = clampDayOfWeek(schedule.dayOfWeek);
      const ahead = (wanted - isoDayOfWeek(from) + 7) % 7;
      return iso(parse(from) + ahead * DAY);
    }
    case "monthly": {
      const wanted = clampDayOfMonth(schedule.dayOfMonth);
      const year = Number(from.slice(0, 4));
      const month = Number(from.slice(5, 7));
      const thisMonth = dayIn(year, month, wanted);
      if (thisMonth >= from) return thisMonth;
      return dayIn(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, wanted);
    }
  }
}

/**
 * The date after a run on `ran`: strictly later, so a report is never sent twice for one date.
 * A monthly schedule set to the 31st keeps asking for the 31st — it is clamped per month, not
 * walked back permanently.
 */
export function nextRunAfter(schedule: Schedule, ran: string): string {
  return nextRunOnOrAfter(schedule, iso(parse(ran) + DAY));
}

export type Period = { from: string; to: string };

/**
 * What period a run covers: the stretch of days ending yesterday that the cadence names. A daily
 * report is about yesterday; a weekly one about the last seven days; a monthly one about the whole
 * previous calendar month, whichever day of the month it is sent on — which is what "the monthly
 * report" means to anybody reading it.
 */
export function periodFor(cadence: Cadence, runOn: string): Period {
  const yesterday = iso(parse(runOn) - DAY);
  switch (cadence) {
    case "daily":
      return { from: yesterday, to: yesterday };
    case "weekly":
      return { from: iso(parse(runOn) - 7 * DAY), to: yesterday };
    case "monthly": {
      const year = Number(runOn.slice(0, 4));
      const month = Number(runOn.slice(5, 7));
      const previousYear = month === 1 ? year - 1 : year;
      const previousMonth = month === 1 ? 12 : month - 1;
      const first = `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
      return { from: first, to: dayIn(previousYear, previousMonth, 31) };
    }
  }
}
