// The month grid shared by the content calendar (FR-WRK-05) and the compliance calendar (FR-OPS-07). Pure: dates are ISO strings, weeks start on
// Monday, and a month is shown as whole weeks so the days around it give context.
const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export const isMonthKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export type MonthGrid = { month: string; from: string; to: string; weeks: { date: string; inMonth: boolean }[][] };

export function monthGrid(month: string): MonthGrid {
  const first = parse(`${month}-01`);
  const last = parse(`${shiftMonth(month, 1)}-01`) - DAY;
  const weekday = (time: number) => (new Date(time).getUTCDay() + 6) % 7; // Monday = 0
  const start = first - weekday(first) * DAY;
  const end = last + (6 - weekday(last)) * DAY;
  const weeks: MonthGrid["weeks"] = [];
  for (let time = start; time <= end; time += 7 * DAY) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => ({ date: iso(time + offset * DAY), inMonth: time + offset * DAY >= first && time + offset * DAY <= last })));
  }
  return { month, from: iso(start), to: iso(end), weeks };
}
