// When an obligation falls due (FR-OPS-01). Pure: no I/O.
//
// A recurring template covers *periods* (a month, a quarter, a half-year, a year — fiscal year =
// calendar year). Its rule turns a period into a nominal due date; weekends and the days off of the
// working calendar then move it to a working day. Event-driven templates count days from the event.
import { addDays, type IsoDate } from "@/lib/dates";
import type { PeriodicRecurrence, Shift } from "../enums";

export type DayOfMonth = number | "last";

export type DueRule =
  /** Day `day` of the `monthsAfter`-th month after the period ends: "the 20th of the following month" = 1 / 20. */
  | { type: "after_period"; monthsAfter: number; day: DayOfMonth }
  /** Day `day` of the period's `month`-th month (1 = its first): "30 January" of a year = 1 / 30. */
  | { type: "in_period"; month: number; day: DayOfMonth }
  /** `days` after the HR event (negative = before it). */
  | { type: "after_event"; days: number };

export type Period = { key: string; start: IsoDate; end: IsoDate };

const MONTHS_IN: Record<PeriodicRecurrence, number> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };

const pad = (value: number) => String(value).padStart(2, "0");
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A calendar month counted from year 0, so adding months is plain arithmetic. */
const monthIndex = (date: IsoDate) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Day `day` of the month; a day the month does not have (30 February) becomes its last day. */
export function dateInMonth(index: number, day: DayOfMonth): IsoDate {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = lastDayOf(year, month);
  return `${year}-${pad(month)}-${pad(day === "last" ? last : Math.min(day, last))}`;
}

function periodStartingAt(recurrence: PeriodicRecurrence, startIndex: number): Period {
  const year = Math.floor(startIndex / 12);
  const month = (startIndex % 12) + 1;
  const length = MONTHS_IN[recurrence];
  const key = recurrence === "monthly" ? `${year}-${pad(month)}` : recurrence === "quarterly" ? `${year}-Q${(month - 1) / 3 + 1}` : recurrence === "semi_annual" ? `${year}-H${(month - 1) / 6 + 1}` : `${year}`;
  return { key, start: dateInMonth(startIndex, 1), end: dateInMonth(startIndex + length - 1, "last") };
}

/** The period a date lies in. */
export function periodOf(recurrence: PeriodicRecurrence, date: IsoDate): Period {
  const index = monthIndex(date);
  const length = MONTHS_IN[recurrence];
  // Periods are aligned to January: index - (month - 1) % length.
  return periodStartingAt(recurrence, index - ((index % 12) % length));
}

export function nextPeriod(recurrence: PeriodicRecurrence, period: Period): Period {
  return periodStartingAt(recurrence, monthIndex(period.start) + MONTHS_IN[recurrence]);
}

/** The due date the rule names, before weekends and holidays move it. */
export function nominalDueDate(rule: DueRule, anchor: Period | { eventDate: IsoDate }): IsoDate {
  if (rule.type === "after_event") {
    if (!("eventDate" in anchor)) throw new Error("after_event needs an event date");
    return addDays(anchor.eventDate, rule.days);
  }
  if ("eventDate" in anchor) throw new Error(`${rule.type} needs a period`);
  if (rule.type === "after_period") return dateInMonth(monthIndex(anchor.end) + rule.monthsAfter, rule.day);
  return dateInMonth(monthIndex(anchor.start) + rule.month - 1, rule.day);
}

const isWeekend = (date: IsoDate) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

/**
 * Authorities and banks are closed on Saturday, Sunday and public holidays: a deadline that lands
 * there moves to the next working day (the statutory default), or — for a pay day — the one before.
 */
export function shiftDueDate(date: IsoDate, shift: Shift, daysOff: ReadonlySet<IsoDate>): IsoDate {
  if (shift === "none") return date;
  const step = shift === "next_working_day" ? 1 : -1;
  let shifted = date;
  // A closed stretch is never longer than Tết plus its weekends; the bound only stops a bad calendar.
  for (let guard = 0; guard < 31 && (isWeekend(shifted) || daysOff.has(shifted)); guard++) shifted = addDays(shifted, step);
  return shifted;
}

export type DuePeriod = { period: Period; nominalDueDate: IsoDate };

/** Every period of the recurrence whose nominal due date lies in [from, to], oldest first. */
export function periodsDueBetween(recurrence: PeriodicRecurrence, rule: DueRule, from: IsoDate, to: IsoDate): DuePeriod[] {
  if (rule.type === "after_event" || from > to) return [];
  const result: DuePeriod[] = [];
  // Start far enough back for the longest rule (annual, due months after the year ends) and walk forward.
  let period = periodOf(recurrence, dateInMonth(monthIndex(from) - 36, 1));
  for (let guard = 0; guard < 600; guard++) {
    const due = nominalDueDate(rule, period);
    if (due >= from && due <= to) result.push({ period, nominalDueDate: due });
    // Due dates grow with the period, so nothing later can fall back into the window — except that an
    // in_period rule is due *inside* its period: stop only once the period itself starts after `to`.
    if (period.start > to && due > to) break;
    period = nextPeriod(recurrence, period);
  }
  return result;
}

export type RuleProblem = "rule_type" | "rule_day" | "rule_months_after" | "rule_month" | "rule_days" | "rule_recurrence";

/** What is wrong with a rule for this recurrence; empty = fine. */
export function ruleProblems(rule: unknown, recurrence: string): RuleProblem[] {
  if (!rule || typeof rule !== "object") return ["rule_type"];
  const candidate = rule as Record<string, unknown>;
  const dayOk = (day: unknown) => day === "last" || (Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31);
  if (candidate.type === "after_event") {
    return [...(recurrence === "event" ? [] : (["rule_recurrence"] as const)), ...(Number.isInteger(candidate.days) && Math.abs(candidate.days as number) <= 366 ? [] : (["rule_days"] as const))];
  }
  if (recurrence === "event" || !(recurrence in MONTHS_IN)) return ["rule_recurrence"];
  if (candidate.type === "after_period") {
    return [...(dayOk(candidate.day) ? [] : (["rule_day"] as const)), ...(Number.isInteger(candidate.monthsAfter) && (candidate.monthsAfter as number) >= 0 && (candidate.monthsAfter as number) <= 12 ? [] : (["rule_months_after"] as const))];
  }
  if (candidate.type === "in_period") {
    const months = MONTHS_IN[recurrence as PeriodicRecurrence];
    return [...(dayOk(candidate.day) ? [] : (["rule_day"] as const)), ...(Number.isInteger(candidate.month) && (candidate.month as number) >= 1 && (candidate.month as number) <= months ? [] : (["rule_month"] as const))];
  }
  return ["rule_type"];
}
