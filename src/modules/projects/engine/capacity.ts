// Capacity against bookings (FR-PJM-13). Pure: the service reads each person's day plans (their
// work schedule with the entity's holidays already applied), their approved leave and their
// bookings, and asks these functions.
//
// Available hours in a week = the hours the person's schedule expects on each day, minus approved
// leave. A part-time schedule simply expects fewer hours; a holiday expects none. Confirmed bookings
// are the load; tentative ones (a pitch, an unsigned deal) are shown beside it and never counted —
// a person is over-allocated only by what has been agreed.
import type { IsoDate } from "@/lib/dates";
import { isoWeekday } from "./schedule";

const DAY = 86_400_000;
const parse = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number): IsoDate => new Date(time).toISOString().slice(0, 10);

/** The fallback day of someone with no work schedule at all: 8 hours, Monday to Friday (as the workload view counts). */
export const DEFAULT_DAY_MINUTES = 8 * 60;

export type Week = { start: IsoDate; end: IsoDate };

/** The Monday of the date's week. */
export const mondayOf = (date: IsoDate): IsoDate => iso(parse(date) - (isoWeekday(date) - 1) * DAY);
export const isMonday = (date: IsoDate): boolean => isoWeekday(date) === 1;

/** `count` weeks from the Monday of `from`'s week. */
export function weeksFrom(from: IsoDate, count: number): Week[] {
  const monday = parse(mondayOf(from));
  return Array.from({ length: count }, (_, index) => ({ start: iso(monday + index * 7 * DAY), end: iso(monday + (index * 7 + 6) * DAY) }));
}

/** One day of a person's plan, as the attendance module answers it. */
export type PlannedDay = { date: IsoDate; kind: "working" | "untracked" | "rest" | "holiday" | "compensatory_off" | "company_off" | "unscheduled"; requiredMinutes: number };
/** Approved leave on a day: `days` is the portion (1, 0.5), `minutes` set for leave taken by the hour. Never the type. */
export type LeaveDay = { date: IsoDate; days: number; minutes: number | null };
export const BOOKING_STATUSES = ["tentative", "confirmed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type Booking = { weekStart: IsoDate; minutes: number; status: BookingStatus };

/**
 * The minutes a day offers. A day without any schedule falls back to the default working week,
 * with the entity's days off taken out; any other day is what the schedule says (0 on rest days
 * and holidays).
 */
export function dayMinutes(day: PlannedDay, daysOff: ReadonlySet<IsoDate>): number {
  if (day.kind !== "unscheduled") return Math.max(0, day.requiredMinutes);
  return isoWeekday(day.date) <= 5 && !daysOff.has(day.date) ? DEFAULT_DAY_MINUTES : 0;
}

/** What leave takes from a day: its hours, or its portion of the day — never more than the day offers. */
export function leaveMinutes(offered: number, leave: LeaveDay): number {
  const taken = leave.minutes ?? Math.round(Math.min(1, Math.max(0, leave.days)) * offered);
  return Math.min(offered, Math.max(0, taken));
}

export type CapacityCell = {
  week: Week;
  /** What the schedule expects in the week, holidays already out. */
  scheduledMinutes: number;
  /** Taken by approved leave — shown as "away", never why. */
  awayMinutes: number;
  awayDays: number;
  /** Weekdays the calendar gives off (holiday, company day off). */
  holidayDays: number;
  availableMinutes: number;
  confirmedMinutes: number;
  tentativeMinutes: number;
  /** available − confirmed; negative when over-allocated. */
  freeMinutes: number;
  /** Confirmed bookings exceed the available hours. */
  over: boolean;
  /** Not over yet, but would be if the tentative bookings were confirmed. */
  atRisk: boolean;
};

export function capacityWeek(input: { week: Week; days: readonly PlannedDay[]; leave: readonly LeaveDay[]; bookings: readonly Booking[]; daysOff: ReadonlySet<IsoDate> }): CapacityCell {
  const { week } = input;
  const inWeek = (date: IsoDate) => date >= week.start && date <= week.end;
  const leaveOn = Map.groupBy(input.leave.filter((day) => inWeek(day.date)), (day) => day.date);
  let scheduledMinutes = 0;
  let awayMinutes = 0;
  let awayDays = 0;
  let holidayDays = 0;
  for (const day of input.days) {
    if (!inWeek(day.date)) continue;
    const offered = dayMinutes(day, input.daysOff);
    scheduledMinutes += offered;
    if ((day.kind === "holiday" || day.kind === "company_off" || day.kind === "compensatory_off" || (day.kind === "unscheduled" && input.daysOff.has(day.date))) && isoWeekday(day.date) <= 5) holidayDays += 1;
    // Two half days on one date take the whole day, never more.
    let left = offered;
    for (const leave of leaveOn.get(day.date) ?? []) {
      const taken = Math.min(left, leaveMinutes(offered, leave));
      if (taken === 0) continue;
      left -= taken;
      awayMinutes += taken;
      awayDays += Math.min(1, leave.days);
    }
  }
  const availableMinutes = scheduledMinutes - awayMinutes;
  const own = input.bookings.filter((booking) => booking.weekStart === week.start);
  const confirmedMinutes = own.filter((booking) => booking.status === "confirmed").reduce((total, booking) => total + booking.minutes, 0);
  const tentativeMinutes = own.filter((booking) => booking.status === "tentative").reduce((total, booking) => total + booking.minutes, 0);
  const over = confirmedMinutes > availableMinutes;
  return { week, scheduledMinutes, awayMinutes, awayDays, holidayDays, availableMinutes, confirmedMinutes, tentativeMinutes, freeMinutes: availableMinutes - confirmedMinutes, over, atRisk: !over && tentativeMinutes > 0 && confirmedMinutes + tentativeMinutes > availableMinutes };
}

export type CapacityRow<Person> = { person: Person; cells: CapacityCell[]; overWeeks: number };

export function capacity<Person extends { id: string }>(input: { people: readonly Person[]; weeks: readonly Week[]; days: (person: Person) => readonly PlannedDay[]; leave: readonly (LeaveDay & { personId: string })[]; bookings: readonly (Booking & { personId: string })[]; daysOff: (person: Person) => ReadonlySet<IsoDate> }): CapacityRow<Person>[] {
  const leaveOf = Map.groupBy(input.leave, (day) => day.personId);
  const bookingsOf = Map.groupBy(input.bookings, (booking) => booking.personId);
  return input.people.map((person) => {
    const days = input.days(person);
    const daysOff = input.daysOff(person);
    const cells = input.weeks.map((week) => capacityWeek({ week, days, leave: leaveOf.get(person.id) ?? [], bookings: bookingsOf.get(person.id) ?? [], daysOff }));
    return { person, cells, overWeeks: cells.filter((cell) => cell.over).length };
  });
}
