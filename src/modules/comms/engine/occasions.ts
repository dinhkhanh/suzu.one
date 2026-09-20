// Birthdays, work anniversaries and new joiners for the home feed (FR-COM-02). Pure: no I/O, no
// clock — the caller says what day it is. A birthday is a day and a month and nothing else: the
// year of birth never reaches this code, so no age can be derived from what it returns.
//
// 29 February is celebrated on 28 February in a year that has none.

type IsoDate = string;

const parse = (date: IsoDate) => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const utc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day);
const DAY = 86_400_000;

/** Days from `today` to the next time the day comes round (0 = today). */
export function daysUntil(month: number, day: number, today: IsoDate): number {
  const now = parse(today);
  const occurrence = (year: number) => (month === 2 && day === 29 && !isLeap(year) ? utc(year, 2, 28) : utc(year, month, day));
  const start = utc(now.year, now.month, now.day);
  const thisYear = occurrence(now.year);
  return Math.round(((thisYear >= start ? thisYear : occurrence(now.year + 1)) - start) / DAY);
}

export type BirthdayInput = { personId: string; birthMonth: number | null; birthDay: number | null };
export type UpcomingBirthday = { personId: string; month: number; day: number; inDays: number };

export function upcomingBirthdays(people: readonly BirthdayInput[], today: IsoDate, windowDays: number): UpcomingBirthday[] {
  return people
    .flatMap((person) => {
      if (!person.birthMonth || !person.birthDay) return [];
      const inDays = daysUntil(person.birthMonth, person.birthDay, today);
      return inDays <= windowDays ? [{ personId: person.personId, month: person.birthMonth, day: person.birthDay, inDays }] : [];
    })
    .sort((a, b) => a.inDays - b.inDays || a.personId.localeCompare(b.personId));
}

export type ServiceInput = { personId: string; seniorityDate: IsoDate };
export type UpcomingAnniversary = { personId: string; month: number; day: number; inDays: number; years: number };

/** Whole years of service completed on the coming anniversary; the first day itself (0 years) is not one. */
export function upcomingAnniversaries(people: readonly ServiceInput[], today: IsoDate, windowDays: number): UpcomingAnniversary[] {
  const now = parse(today);
  return people
    .flatMap((person) => {
      const since = parse(person.seniorityDate);
      const inDays = daysUntil(since.month, since.day, today);
      if (inDays > windowDays) return [];
      // The occurrence falls in this year unless the window wrapped into January.
      const occurrenceYear = new Date(utc(now.year, now.month, now.day) + inDays * DAY).getUTCFullYear();
      const years = occurrenceYear - since.year;
      return years >= 1 ? [{ personId: person.personId, month: since.month, day: since.day, inDays, years }] : [];
    })
    .sort((a, b) => a.inDays - b.inDays || b.years - a.years || a.personId.localeCompare(b.personId));
}

export type JoinerInput = { personId: string; startDate: IsoDate };

/** Started within the last `days` days (today included), newest first. */
export function recentJoiners<T extends JoinerInput>(people: readonly T[], today: IsoDate, days: number): T[] {
  const now = parse(today);
  const end = utc(now.year, now.month, now.day);
  return people
    .filter((person) => {
      const start = parse(person.startDate);
      const age = (end - utc(start.year, start.month, start.day)) / DAY;
      return age >= 0 && age <= days;
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.personId.localeCompare(b.personId));
}
