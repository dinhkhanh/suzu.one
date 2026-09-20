// Counting and checking a leave request (FR-LVE-04). Pure: no I/O. The day plans come from the
// attendance module (the person's own calendar: schedule, roster, holidays), so a request costs
// exactly the working days it covers.
import type { IsoDate } from "./entitlement";

export type Portion = "full" | "am" | "pm" | "hours";

/** The part of attendance's DayPlan this engine needs. */
export type PlannedDay = { date: IsoDate; kind: string; requiredMinutes: number };

export type CountInput = {
  days: readonly PlannedDay[];
  startPortion: Portion;
  endPortion: Portion;
  /** Hourly leave: minutes off on the single date. */
  minutes: number | null;
  /** Whether "working, no punches" days (Saturday WFH) cost leave — a property of the leave type. */
  countsUntracked: boolean;
};

export type CountedDay = { date: IsoDate; portion: Portion; amountCenti: number; minutes: number | null };
export type CountResult = { days: CountedDay[]; totalCenti: number; problems: string[] };

const costsLeave = (day: PlannedDay, countsUntracked: boolean) => day.kind === "working" || (countsUntracked && day.kind === "untracked");

/**
 * The leave days of a request. One date: `startPortion` is the part taken (full, morning,
 * afternoon, some hours). Several dates: the first may start at noon ("pm"), the last may end at
 * noon ("am"). Holidays, rest days and company days off cost nothing.
 */
export function countLeaveDays(input: CountInput): CountResult {
  const problems: string[] = [];
  const dates = input.days;
  if (dates.length === 0) return { days: [], totalCenti: 0, problems: ["leave_dates_invalid"] };
  const single = dates.length === 1;
  if (!single && (input.startPortion === "am" || input.startPortion === "hours" || input.endPortion === "pm" || input.endPortion === "hours")) problems.push("leave_portion_invalid");
  if (input.startPortion === "hours" && (!input.minutes || input.minutes <= 0)) problems.push("leave_minutes_invalid");

  const counted: CountedDay[] = [];
  for (const [index, day] of dates.entries()) {
    if (!costsLeave(day, input.countsUntracked)) continue;
    const portion: Portion = single ? input.startPortion : index === 0 ? input.startPortion : index === dates.length - 1 ? input.endPortion : "full";
    if (portion === "hours") {
      const minutes = input.minutes ?? 0;
      if (day.requiredMinutes <= 0 || minutes >= day.requiredMinutes) {
        problems.push("leave_minutes_invalid");
        continue;
      }
      counted.push({ date: day.date, portion, amountCenti: Math.max(1, Math.round((minutes * 100) / day.requiredMinutes)), minutes });
    } else {
      counted.push({ date: day.date, portion, amountCenti: portion === "full" ? 100 : 50, minutes: null });
    }
  }
  if (counted.length === 0 && problems.length === 0) problems.push("leave_no_working_days");
  return { days: counted, totalCenti: counted.reduce((sum, day) => sum + day.amountCenti, 0), problems: [...new Set(problems)] };
}

/** Two takings of the same date clash unless they are the two different halves of it. */
export function portionsClash(a: Portion, b: Portion): boolean {
  return !((a === "am" && b === "pm") || (a === "pm" && b === "am"));
}

export type TypeRules = {
  isActive: boolean;
  tracksBalance: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
  requiresAttachment: boolean;
  noticeDays: number;
  allowBackdated: boolean;
  maxDaysPerRequestCenti: number | null;
  eligibleWorkforceTypes: readonly string[] | null;
  gender: "male" | "female" | null;
  minSeniorityMonths: number | null;
};

export type CheckInput = {
  type: TypeRules;
  /** null when the type keeps no balance or no policy is in force. */
  policy: { probationRule: "accrue_and_use" | "accrue_no_use" | "no_accrual"; allowNegativeCenti: number } | null;
  person: { workforceType: string; gender: string | null; seniorityDate: IsoDate | null; employmentStart: IsoDate | null; employmentEnd: IsoDate | null; onProbationAtStart: boolean };
  filedOn: IsoDate;
  /** HR files on someone's behalf: notice and back-dating are HR's call. */
  filedByHr: boolean;
  startDate: IsoDate;
  endDate: IsoDate;
  counted: CountResult;
  hasAttachment: boolean;
  /** Per leave year: balance minus what other pending requests already ask for. */
  availableByYear: Readonly<Record<number, number>>;
  /** Days the person already has pending or approved leave on. */
  existingDays: readonly { date: IsoDate; portion: Portion }[];
};

const dayNumber = (date: IsoDate) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

function monthsBetween(from: IsoDate, to: IsoDate): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return to.slice(8) >= from.slice(8) ? months : months - 1;
}

/** Everything that stops a request, as message keys (`leave.errors.<code>`). Empty = it may be filed. */
export function checkLeaveRequest(input: CheckInput): string[] {
  const { type, person, counted } = input;
  const problems = [...counted.problems];
  if (!type.isActive) problems.push("leave_type_inactive");
  if (input.endDate < input.startDate) problems.push("leave_dates_invalid");

  if (type.eligibleWorkforceTypes && !type.eligibleWorkforceTypes.includes(person.workforceType)) problems.push("leave_not_eligible_workforce");
  if (type.gender && person.gender !== type.gender) problems.push("leave_not_eligible_gender");
  if (type.minSeniorityMonths && (!person.seniorityDate || monthsBetween(person.seniorityDate, input.startDate) < type.minSeniorityMonths)) problems.push("leave_not_eligible_seniority");
  if (!person.employmentStart || input.startDate < person.employmentStart || (person.employmentEnd && input.endDate > person.employmentEnd)) problems.push("leave_outside_employment");

  if (counted.days.some((day) => day.portion === "am" || day.portion === "pm") && !type.allowHalfDay) problems.push("leave_half_day_not_allowed");
  if (counted.days.some((day) => day.portion === "hours") && !type.allowHourly) problems.push("leave_hourly_not_allowed");
  if (type.maxDaysPerRequestCenti !== null && counted.totalCenti > type.maxDaysPerRequestCenti) problems.push("leave_too_long");
  if (type.requiresAttachment && !input.hasAttachment) problems.push("leave_attachment_required");

  if (!input.filedByHr) {
    if (input.startDate < input.filedOn && !type.allowBackdated) problems.push("leave_backdated");
    else if (dayNumber(input.startDate) - dayNumber(input.filedOn) < type.noticeDays && input.startDate >= input.filedOn) problems.push("leave_notice_too_short");
  }

  if (counted.days.some((day) => input.existingDays.some((existing) => existing.date === day.date && portionsClash(existing.portion, day.portion)))) problems.push("leave_overlaps");

  if (type.tracksBalance) {
    if (input.policy && input.policy.probationRule !== "accrue_and_use" && person.onProbationAtStart) problems.push("leave_on_probation");
    const askedByYear = new Map<number, number>();
    for (const day of counted.days) askedByYear.set(Number(day.date.slice(0, 4)), (askedByYear.get(Number(day.date.slice(0, 4))) ?? 0) + day.amountCenti);
    for (const [year, asked] of askedByYear) if ((input.availableByYear[year] ?? 0) + (input.policy?.allowNegativeCenti ?? 0) < asked) problems.push("leave_balance_insufficient");
  }
  return [...new Set(problems)];
}

/** Minimum staffing (FR-LVE-05): the dates on which fewer than `minPresent` of the group would be at work. */
export function staffingShortfalls(input: { dates: readonly IsoDate[]; headcount: number; minPresent: number; awayByDate: Readonly<Record<IsoDate, number>> }): { date: IsoDate; present: number }[] {
  return input.dates.map((date) => ({ date, present: input.headcount - (input.awayByDate[date] ?? 0) - 1 })).filter((row) => row.present < input.minPresent);
}
