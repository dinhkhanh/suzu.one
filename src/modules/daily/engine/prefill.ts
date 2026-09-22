// The end-of-day report, prefilled (FR-PJM-22, design rule "write once"): what the person did today,
// read from the day's recorded activity and time, set against what they planned in the morning.
// The person only adds judgement — blockers, notes, tomorrow's plan. Pure.
import type { ActivityItem, DailyTaskLine } from "../schema";

type IsoDate = string;

export type PrefillEventKind = "created" | "moved" | "completed" | "submitted" | "reviewed" | "commented" | "handoff_sent" | "handoff_received" | "blocker_raised" | "blocker_resolved";
export type PrefillEvent = { kind: PrefillEventKind; taskId: string; key: string; title: string; at: Date | string; detail: string | null };
/** A planned task as it stands now. */
export type PlannedTask = { taskId: string; key: string; title: string; status: "todo" | "in_progress" | "done" | "cancelled"; completedOn: IsoDate | null };
/** Time logged today: on a task, or on a category (internal, admin…) with no task. */
export type LoggedTime = { taskId: string | null; key: string | null; title: string; minutes: number; at: Date | string };

export type ReportDraft = { done: DailyTaskLine[]; notDone: DailyTaskLine[]; activity: ActivityItem[]; minutesLogged: number };

const iso = (at: Date | string) => (typeof at === "string" ? at : at.toISOString());
const line = (task: { taskId: string; title: string; key: string | null }): DailyTaskLine => ({ taskId: task.taskId, title: task.title, ref: task.key });

/**
 * - **Done**: every task whose last state move today took it to a done state, and every planned
 *   task completed today (someone else may have closed it — an approval moves it on).
 * - **Not done**: the plan's other tasks, in the plan's order; a cancelled task is not "not done".
 * - **Activity**: the day in order, one line per thing — several moves of one task show as the
 *   last, several comments on one task as one line with the count, time as one line per task or
 *   category with the minutes.
 */
export function prefillReport(input: { date: IsoDate; planned: readonly PlannedTask[]; events: readonly PrefillEvent[]; time: readonly LoggedTime[] }): ReportDraft {
  const events = [...input.events].sort((a, b) => iso(a.at).localeCompare(iso(b.at)));

  // The last state move of each task decides whether it ended the day done.
  const lastMove = new Map<string, PrefillEvent>();
  for (const event of events) if (event.kind === "moved" || event.kind === "completed") lastMove.set(event.taskId, event);

  const done: DailyTaskLine[] = [];
  const doneIds = new Set<string>();
  const addDone = (task: { taskId: string; title: string; key: string | null }) => {
    if (doneIds.has(task.taskId)) return;
    doneIds.add(task.taskId);
    done.push(line(task));
  };
  for (const event of events) if (event.kind === "completed" && lastMove.get(event.taskId) === event) addDone(event);
  for (const task of input.planned) if (task.status === "done" && task.completedOn === input.date) addDone(task);

  const notDone = input.planned.filter((task) => !doneIds.has(task.taskId) && task.status !== "cancelled" && task.status !== "done").map(line);

  const activity: ActivityItem[] = [];
  const comments = new Map<string, { item: ActivityItem; count: number }>();
  for (const event of events) {
    if ((event.kind === "moved" || event.kind === "completed") && lastMove.get(event.taskId) !== event) continue;
    if (event.kind === "commented") {
      const seen = comments.get(event.taskId);
      if (seen) {
        seen.count += 1;
        seen.item.detail = String(seen.count);
        continue;
      }
      const item: ActivityItem = { kind: "commented", taskId: event.taskId, title: event.title, ref: event.key, detail: "1", at: iso(event.at) };
      comments.set(event.taskId, { item, count: 1 });
      activity.push(item);
      continue;
    }
    activity.push({ kind: event.kind, taskId: event.taskId, title: event.title, ref: event.key, detail: event.detail, at: iso(event.at) });
  }

  const logged = new Map<string, ActivityItem & { minutes: number }>();
  for (const entry of input.time) {
    const key = entry.taskId ?? `category:${entry.title}`;
    const seen = logged.get(key);
    if (seen) {
      seen.minutes += entry.minutes;
      seen.detail = String(seen.minutes);
      if (iso(entry.at) > seen.at) seen.at = iso(entry.at);
      continue;
    }
    logged.set(key, { kind: "time_logged", taskId: entry.taskId, title: entry.title, ref: entry.key, detail: String(entry.minutes), at: iso(entry.at), minutes: entry.minutes });
  }
  activity.push(...[...logged.values()].map((item) => ({ kind: item.kind, taskId: item.taskId, title: item.title, ref: item.ref, detail: item.detail, at: item.at })));
  activity.sort((a, b) => a.at.localeCompare(b.at));

  return { done, notDone, activity, minutesLogged: input.time.reduce((total, entry) => total + entry.minutes, 0) };
}
