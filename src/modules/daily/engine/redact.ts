// A person's day as somebody else reads it (SRS §4.6b, "private projects stay with their people").
// Reports, weeks and time entries name tasks and projects; a lead or a manager above the person may
// read the report but not necessarily every task in it — a private project's work is not theirs to
// see. So every label is resolved for the reader when it is shown: a task or project the reader may
// open keeps its name (as it is called now), anything else becomes "private work" with only its
// minutes. What the report stored at submission is never shown to another reader on its own word.
// Pure: the service decides what the reader may open (`Seen`) and these functions apply it.
import type { ActivityItem, DailyTaskLine } from "../schema";
import type { PersonWeek, ProjectHours, TeamWeek } from "./weekly";

/** What the reader may open, among the tasks and projects on the page: tasks with their label now. */
export type Seen = { tasks: ReadonlyMap<string, { title: string; key: string }>; projects: ReadonlySet<string> };

/** A line as shown: `hidden` = the reader may not open the task — no title, no key, no link. */
export type ShownLine = DailyTaskLine & { hidden?: true };
export type ShownActivity = ActivityItem & { hidden?: true };
export type ShownHours = ProjectHours & { hidden?: true };

/** Activity whose detail is only a number (minutes, a count of comments): kept when the task is hidden. */
const NUMERIC_DETAIL = new Set(["time_logged", "commented"]);

export function showLine(line: DailyTaskLine, seen: Seen): ShownLine {
  const task = seen.tasks.get(line.taskId);
  if (task) return { ...line, title: task.title, ref: task.key };
  return { taskId: line.taskId, title: "", ref: null, hidden: true };
}

export function showActivity(item: ActivityItem, seen: Seen): ShownActivity {
  // Time on a category (admin, training…) names no task: the category is the label.
  if (!item.taskId) return item;
  const task = seen.tasks.get(item.taskId);
  if (task) return { ...item, title: task.title, ref: task.key };
  // A state name, a blocker's reason, who a hand-off went to: all about the hidden task.
  return { kind: item.kind, taskId: item.taskId, title: "", ref: null, detail: NUMERIC_DETAIL.has(item.kind) ? item.detail : null, at: item.at, hidden: true };
}

export function showHours(group: ProjectHours, seen: Seen): ShownHours {
  if (!group.projectId || seen.projects.has(group.projectId)) return group;
  return { ...group, name: null, hidden: true };
}

export type ShownPersonWeek = Omit<PersonWeek, "done" | "slipped" | "hoursByProject"> & { done: ShownLine[]; slipped: ShownLine[]; hoursByProject: ShownHours[] };

/** A person's week: the tasks and the projects of the hours, each as the reader may see it. */
export function showPersonWeek(week: PersonWeek, seen: Seen): ShownPersonWeek {
  return { ...week, done: week.done.map((line) => showLine(line, seen)), slipped: week.slipped.map((line) => showLine(line, seen)), hoursByProject: week.hoursByProject.map((group) => showHours(group, seen)) };
}

export type ShownTeamWeek = Omit<TeamWeek, "hoursByProject"> & { hoursByProject: ShownHours[] };

/**
 * A team's week for someone who runs the team: the totals stay whole, but each person's line and
 * their blockers only for the people whose reports the reader may read (`mayRead`) — running a
 * team under `work:manage` is not a seat in everyone's reporting line.
 */
export function showTeamWeek(week: TeamWeek, seen: Seen, mayRead: (personId: string) => boolean): ShownTeamWeek {
  return { ...week, people: week.people.filter((person) => mayRead(person.personId)), blockers: week.blockers.filter((blocker) => mayRead(blocker.personId)), hoursByProject: week.hoursByProject.map((group) => showHours(group, seen)) };
}

/** A time entry's labels: the task's key and title, the project's name. */
export function showTimeLabels<Entry extends { taskId: string | null; key: string | null; title: string | null; projectId: string | null; projectName: string | null }>(entry: Entry, seen: Seen): Entry & { hidden?: true } {
  const task = entry.taskId ? seen.tasks.get(entry.taskId) : undefined;
  const projectName = entry.projectId && !seen.projects.has(entry.projectId) ? null : entry.projectName;
  if (!entry.taskId) return { ...entry, projectName };
  if (task) return { ...entry, key: task.key, title: task.title, projectName };
  return { ...entry, key: null, title: null, projectName, hidden: true };
}
