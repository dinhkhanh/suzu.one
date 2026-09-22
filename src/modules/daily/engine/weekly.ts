// The weekly report (FR-PJM-23): a person's week and a team's week, summarised from the week's daily
// reports, completed work and logged time. Pure; the lead adds their own words on top.
import type { DailyTaskLine } from "../schema";

type IsoDate = string;

export type WeekDayReport = { date: IsoDate; status: "draft" | "submitted"; late: boolean; done: readonly DailyTaskLine[]; notDone: readonly DailyTaskLine[]; blockers: string | null };
export type WeekTime = { projectId: string | null; projectName: string | null; category: string | null; minutes: number };
export type ProjectHours = { projectId: string | null; name: string | null; category: string | null; minutes: number };

export type PersonWeek = {
  done: DailyTaskLine[];
  /** Planned on some day and still not done by the end of the week. */
  slipped: DailyTaskLine[];
  blockers: { date: IsoDate; text: string }[];
  hoursByProject: ProjectHours[];
  totalMinutes: number;
  submitted: number;
  required: number;
  late: number;
};

const byMinutes = (a: ProjectHours, b: ProjectHours) => b.minutes - a.minutes || (a.name ?? a.category ?? "").localeCompare(b.name ?? b.category ?? "", "vi");

function hoursOf(time: readonly WeekTime[]): ProjectHours[] {
  const groups = new Map<string, ProjectHours>();
  for (const entry of time) {
    const key = entry.projectId ?? `category:${entry.category ?? "none"}`;
    const group = groups.get(key) ?? { projectId: entry.projectId, name: entry.projectName, category: entry.projectId ? null : entry.category, minutes: 0 };
    group.minutes += entry.minutes;
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.minutes > 0).sort(byMinutes);
}

/**
 * One person's week. Done = what the reports said was done plus what the activity shows was
 * completed (a day without a report still did its work). Slipped = what a day's report left
 * undone and no later day finished. `requiredDays` is how many days asked for a report.
 */
export function summarisePersonWeek(input: { reports: readonly WeekDayReport[]; completed: readonly DailyTaskLine[]; time: readonly WeekTime[]; requiredDays: number }): PersonWeek {
  const reports = [...input.reports].sort((a, b) => a.date.localeCompare(b.date));
  const submitted = reports.filter((report) => report.status === "submitted");
  const done = new Map<string, DailyTaskLine>();
  for (const report of submitted) for (const task of report.done) if (!done.has(task.taskId)) done.set(task.taskId, { taskId: task.taskId, title: task.title, ref: task.ref });
  for (const task of input.completed) if (!done.has(task.taskId)) done.set(task.taskId, { taskId: task.taskId, title: task.title, ref: task.ref });

  const slipped = new Map<string, DailyTaskLine>();
  for (const report of submitted) for (const task of report.notDone) if (!done.has(task.taskId) && !slipped.has(task.taskId)) slipped.set(task.taskId, { taskId: task.taskId, title: task.title, ref: task.ref });

  const hoursByProject = hoursOf(input.time);
  return {
    done: [...done.values()],
    slipped: [...slipped.values()],
    blockers: submitted.filter((report) => report.blockers?.trim()).map((report) => ({ date: report.date, text: report.blockers!.trim() })),
    hoursByProject,
    totalMinutes: hoursByProject.reduce((total, group) => total + group.minutes, 0),
    submitted: submitted.length,
    required: input.requiredDays,
    late: submitted.filter((report) => report.late).length,
  };
}

export type TeamWeekPerson = { personId: string; name: string; done: number; slipped: number; blockers: number; minutes: number; submitted: number; required: number; late: number };
export type TeamWeek = {
  people: TeamWeekPerson[];
  done: number;
  slipped: number;
  blockers: { personId: string; name: string; date: IsoDate; text: string }[];
  hoursByProject: ProjectHours[];
  totalMinutes: number;
  submitted: number;
  required: number;
  late: number;
};

/** A team's week from its people's weeks: whoever had blockers first, then by name. */
export function summariseTeamWeek(people: readonly { personId: string; name: string; week: PersonWeek }[]): TeamWeek {
  const rows: TeamWeekPerson[] = people.map(({ personId, name, week }) => ({ personId, name, done: week.done.length, slipped: week.slipped.length, blockers: week.blockers.length, minutes: week.totalMinutes, submitted: week.submitted, required: week.required, late: week.late }));
  rows.sort((a, b) => b.blockers - a.blockers || a.name.localeCompare(b.name, "vi"));
  const hours = new Map<string, ProjectHours>();
  for (const { week } of people)
    for (const group of week.hoursByProject) {
      const key = group.projectId ?? `category:${group.category ?? "none"}`;
      const total = hours.get(key) ?? { ...group, minutes: 0 };
      total.minutes += group.minutes;
      hours.set(key, total);
    }
  const sum = (pick: (row: TeamWeekPerson) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    people: rows,
    done: sum((row) => row.done),
    slipped: sum((row) => row.slipped),
    blockers: people.flatMap(({ personId, name, week }) => week.blockers.map((blocker) => ({ personId, name, ...blocker }))).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "vi")),
    hoursByProject: [...hours.values()].sort(byMinutes),
    totalMinutes: sum((row) => row.minutes),
    submitted: sum((row) => row.submitted),
    required: sum((row) => row.required),
    late: sum((row) => row.late),
  };
}
