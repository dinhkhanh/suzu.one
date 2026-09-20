// When a recurring task comes round (FR-WRK-11). Pure: dates are ISO strings, no clock, no I/O.
import { addDays, type IsoDate } from "@/lib/dates";

export type RecurrenceRule =
  /** Every `interval` days from the start date. */
  | { freq: "daily"; interval: number }
  /** On these ISO weekdays (1 = Monday … 7 = Sunday), every `interval` weeks counted from the start date's week. */
  | { freq: "weekly"; interval: number; weekdays: number[] }
  /** On day `monthDay` — the month's last day when it is shorter, or always with "last" — every `interval` months from the start date's month. */
  | { freq: "monthly"; interval: number; monthDay: number | "last" };

export type RuleProblem = "bad_interval" | "no_weekdays" | "bad_weekday" | "bad_month_day";

export function ruleProblems(rule: RecurrenceRule): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 366) problems.push("bad_interval");
  if (rule.freq === "weekly") {
    if (rule.weekdays.length === 0) problems.push("no_weekdays");
    if (rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) problems.push("bad_weekday");
  }
  if (rule.freq === "monthly" && rule.monthDay !== "last" && (!Number.isInteger(rule.monthDay) || rule.monthDay < 1 || rule.monthDay > 31)) problems.push("bad_month_day");
  return problems;
}

const DAY = 86_400_000;
const time = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);
const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((time(to) - time(from)) / DAY);
const isoWeekday = (date: IsoDate) => new Date(time(date)).getUTCDay() || 7;
const mondayOf = (date: IsoDate) => addDays(date, 1 - isoWeekday(date));
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The rule's dates within [from, to], never before `startDate`, oldest first. `limit` bounds a
 * careless range (a daily rule over ten years), not a normal one.
 */
export function occurrencesBetween(rule: RecurrenceRule, startDate: IsoDate, from: IsoDate, to: IsoDate, limit = 500): IsoDate[] {
  if (ruleProblems(rule).length > 0) return [];
  const first = from > startDate ? from : startDate;
  if (first > to) return [];
  const dates: IsoDate[] = [];

  if (rule.freq === "daily") {
    const behind = daysBetween(startDate, first) % rule.interval;
    for (let date = behind === 0 ? first : addDays(first, rule.interval - behind); date <= to && dates.length < limit; date = addDays(date, rule.interval)) dates.push(date);
    return dates;
  }

  if (rule.freq === "weekly") {
    const weekdays = [...new Set(rule.weekdays)].sort((a, b) => a - b);
    const startWeek = mondayOf(startDate);
    for (let week = mondayOf(first); week <= to && dates.length < limit; week = addDays(week, 7)) {
      if ((daysBetween(startWeek, week) / 7) % rule.interval !== 0) continue;
      for (const weekday of weekdays) {
        const date = addDays(week, weekday - 1);
        if (date >= first && date <= to && dates.length < limit) dates.push(date);
      }
    }
    return dates;
  }

  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [firstYear, firstMonth] = first.split("-").map(Number);
  for (let index = (firstYear - startYear) * 12 + (firstMonth - startMonth); dates.length < limit; index++) {
    const year = startYear + Math.floor((startMonth - 1 + index) / 12);
    const month = ((startMonth - 1 + index) % 12) + 1;
    if (`${year}-${pad(month)}-01` > to) break;
    if (index % rule.interval !== 0) continue;
    const last = lastDayOfMonth(year, month);
    const date = `${year}-${pad(month)}-${pad(rule.monthDay === "last" ? last : Math.min(rule.monthDay, last))}`;
    if (date >= first && date <= to) dates.push(date);
  }
  return dates;
}

/** The first occurrence on or after `from`, if the rule ever comes round again before `until`. */
export function nextOccurrence(rule: RecurrenceRule, startDate: IsoDate, from: IsoDate, until: IsoDate | null = null): IsoDate | null {
  // Far enough for "every 366 days" and "every 12 months".
  const horizon = addDays(from, 366 * 2);
  const [next] = occurrencesBetween(rule, startDate, from, until && until < horizon ? until : horizon, 1);
  return next ?? null;
}
