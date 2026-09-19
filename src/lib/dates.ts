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
