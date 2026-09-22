// Utilisation (FR-PJM-61): hours logged ÷ hours available, per person and week, and how much of
// the logged time is billable. Pure: the service reads the work schedules and the calendar
// (attendance's day plans), approved leave and the time entries, and asks these functions.
//
// Available time is what the person's schedule asks of them, less approved leave and less the
// days the calendar gives off. A part-time schedule is its own hours, not a full day. An untracked
// Saturday asks for no hours: time logged on it counts, it adds nothing to the hours available.

type IsoDate = string;

/** A working day nobody scheduled (no schedule applies): the usual 8 hours, Monday to Friday. */
export const UNSCHEDULED_DAY_MINUTES = 8 * 60;

/** Attendance's day kinds (DayPlanKind), repeated so this engine stays free of other modules. */
export type PlanKind = "working" | "untracked" | "rest" | "holiday" | "compensatory_off" | "company_off" | "unscheduled";

export type ScheduledDay = {
  date: IsoDate;
  kind: PlanKind;
  /** The schedule's minutes for the day (0 on a day off). */
  requiredMinutes: number;
  /** Approved leave on the day, in hundredths of a day (100 = the whole day). */
  leaveCenti: number;
};

const isWeekday = (date: IsoDate) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/** The minutes one day makes available for work. */
export function availableMinutes(day: ScheduledDay): number {
  let scheduled = 0;
  if (day.kind === "working") scheduled = day.requiredMinutes > 0 ? day.requiredMinutes : UNSCHEDULED_DAY_MINUTES;
  else if (day.kind === "unscheduled" && isWeekday(day.date)) scheduled = UNSCHEDULED_DAY_MINUTES;
  const away = Math.min(100, Math.max(0, day.leaveCenti));
  return Math.round((scheduled * (100 - away)) / 100);
}

export type Logged = { minutes: number; billable: number };
export type Utilisation = {
  available: number;
  logged: number;
  billable: number;
  /** logged ÷ available; null when nothing was available (a week of leave or holidays). */
  ratio: number | null;
  /** billable ÷ logged; null when nothing was logged. */
  billableRatio: number | null;
};

export function utilisationOf(available: number, logged: Logged): Utilisation {
  return {
    available,
    logged: logged.minutes,
    billable: logged.billable,
    ratio: available > 0 ? logged.minutes / available : null,
    billableRatio: logged.minutes > 0 ? logged.billable / logged.minutes : null,
  };
}

/**
 * One person's weeks: the days of each week (Monday `weekStart` to Sunday) summed into hours
 * available, set against what was logged in that week. Days after `until` (today) are not yet
 * available: the week in progress is measured on the days behind it.
 */
export function personWeeks(weeks: readonly IsoDate[], days: readonly ScheduledDay[], logged: ReadonlyMap<IsoDate, Logged>, until?: IsoDate): Utilisation[] {
  return weeks.map((weekStart) => {
    const end = new Date(`${weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);
    const available = days.filter((day) => day.date >= weekStart && day.date <= weekEnd && (!until || day.date <= until)).reduce((sum, day) => sum + availableMinutes(day), 0);
    return utilisationOf(available, logged.get(weekStart) ?? { minutes: 0, billable: 0 });
  });
}

/** A team's week: the sums of its people's, never an average of their ratios. */
export function totalOf(rows: readonly Utilisation[]): Utilisation {
  const available = rows.reduce((sum, row) => sum + row.available, 0);
  return utilisationOf(available, { minutes: rows.reduce((sum, row) => sum + row.logged, 0), billable: rows.reduce((sum, row) => sum + row.billable, 0) });
}

/** The Mondays of the `count` weeks up to and including the week of `today`, oldest first. */
export function lastWeeks(today: IsoDate, count: number): IsoDate[] {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: count }, (_, index) => {
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - (count - 1 - index) * 7);
    return monday.toISOString().slice(0, 10);
  });
}
