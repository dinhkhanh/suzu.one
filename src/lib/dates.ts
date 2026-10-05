// Calendar dates are "YYYY-MM-DD" strings. Timestamps are UTC; business dates are Vietnam-local (SRS DR-04).
export type IsoDate = string;

const VIETNAM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });

export function todayInVietnam(now: Date = new Date()): IsoDate {
  return VIETNAM.format(now);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** The instant a Vietnam-local day begins: midnight in Hà Nội, 17:00 UTC the day before. */
export function vietnamDayStart(date: IsoDate): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

/** A Vietnam-local calendar year as instants, both ends inclusive — for cutting timestamps (`created_at`) by year. */
export function vietnamYearInstants(year: number): { from: Date; to: Date } {
  return { from: vietnamDayStart(`${year}-01-01`), to: new Date(vietnamDayStart(`${year + 1}-01-01`).getTime() - 1) };
}
