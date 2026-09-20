// The workload view (FR-WRK-13). Pure: open tasks and estimated hours per person per week, against
// a capacity that shrinks with approved leave and public holidays.
//
// A task's hours are spread evenly over the working days (Mon–Fri) between its start and due date;
// without a start date they all land on the due date. Work that is already late still has to be
// done: it counts in the current week. Undated tasks are shown apart, in no week.
const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const isWeekday = (time: number) => ![0, 6].includes(new Date(time).getUTCDay());

export const HOURS_PER_DAY = 8;
export const DAYS_PER_WEEK = 5;

export type Week = { start: string; end: string };

/** `count` weeks from the Monday of `today`'s week. */
export function weeksFrom(today: string, count: number): Week[] {
  const time = parse(today);
  const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: count }, (_, index) => ({ start: iso(monday + index * 7 * DAY), end: iso(monday + index * 7 * DAY + 6 * DAY) }));
}

export type WorkloadTask = { assigneePersonId: string; startDate: string | null; dueDate: string | null; estimateMinutes: number | null };
/** `days`: 1 = a whole day away, 0.5 = half a day. Only the fact of being away — never why. */
export type AwayDay = { personId: string; date: string; days: number };

export type WorkloadCell = { week: Week; tasks: number; minutes: number; unestimated: number; awayDays: number; holidayDays: number; capacityMinutes: number; over: boolean };
export type WorkloadRow<Person> = { person: Person; cells: WorkloadCell[]; unscheduled: { tasks: number; minutes: number }; later: { tasks: number; minutes: number } };

/** The working days a task occupies, clamped so that late work starts today. */
function workingDaysOf(task: WorkloadTask, today: string): string[] {
  const due = Math.max(parse(task.dueDate!), parse(today));
  const start = Math.min(Math.max(parse(task.startDate ?? task.dueDate!), parse(today)), due);
  const days: string[] = [];
  for (let time = start; time <= due; time += DAY) if (isWeekday(time)) days.push(iso(time));
  // Due on a weekend with no weekday in the span: the due date itself carries the work.
  return days.length > 0 ? days : [iso(due)];
}

export function workload<Person extends { id: string }>(input: { people: readonly Person[]; tasks: readonly WorkloadTask[]; away: readonly AwayDay[]; /** Days off per person (their entity's calendar). */ daysOff: (person: Person) => ReadonlySet<string>; weeks: readonly Week[]; today: string }): WorkloadRow<Person>[] {
  const { weeks, today } = input;
  const weekOf = (date: string) => weeks.findIndex((week) => date >= week.start && date <= week.end);
  return input.people.map((person) => {
    const off = input.daysOff(person);
    const cells: WorkloadCell[] = weeks.map((week) => {
      let holidayDays = 0;
      for (let time = parse(week.start); time <= parse(week.end); time += DAY) if (isWeekday(time) && off.has(iso(time))) holidayDays += 1;
      return { week, tasks: 0, minutes: 0, unestimated: 0, awayDays: 0, holidayDays, capacityMinutes: 0, over: false };
    });
    for (const day of input.away) {
      if (day.personId !== person.id || !isWeekday(parse(day.date)) || off.has(day.date)) continue;
      const index = weekOf(day.date);
      if (index >= 0) cells[index].awayDays += day.days;
    }
    const unscheduled = { tasks: 0, minutes: 0 };
    const later = { tasks: 0, minutes: 0 };
    for (const task of input.tasks) {
      if (task.assigneePersonId !== person.id) continue;
      const minutes = task.estimateMinutes ?? 0;
      if (!task.dueDate) {
        unscheduled.tasks += 1;
        unscheduled.minutes += minutes;
        continue;
      }
      const days = workingDaysOf(task, today);
      const touched = new Set<number>();
      let beyond = 0;
      for (const day of days) {
        const index = weekOf(day);
        if (index < 0) {
          beyond += 1;
          continue;
        }
        touched.add(index);
        cells[index].minutes += minutes / days.length;
      }
      for (const index of touched) {
        cells[index].tasks += 1;
        if (task.estimateMinutes === null) cells[index].unestimated += 1;
      }
      if (beyond > 0) {
        later.minutes += (minutes * beyond) / days.length;
        if (touched.size === 0) later.tasks += 1;
      }
    }
    for (const cell of cells) {
      cell.minutes = Math.round(cell.minutes);
      cell.capacityMinutes = Math.max(0, Math.round((DAYS_PER_WEEK - cell.holidayDays - cell.awayDays) * HOURS_PER_DAY * 60));
      cell.over = cell.minutes > cell.capacityMinutes;
    }
    later.minutes = Math.round(later.minutes);
    return { person, cells, unscheduled, later };
  });
}
