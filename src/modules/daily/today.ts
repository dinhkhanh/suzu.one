// Today (FR-PJM-20): everything the person's day asks of them, on one phone-sized page — the plan,
// what is due, reviews and hand-offs waiting, blockers either way, this week's bookings, and where
// the plan and the report stand. Every list is the person's own; nothing here reads anyone else's.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cachedLive } from "@/lib/cache/live";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { type DayTask, type HandoffWaiting, listBlockersWaitingOn, listDayTasks, listHandoffsWaitingFor, listOpenBlockersRaisedBy, listOpenWorkOf, listReviewsWaitingFor, type OpenBlocker, type ReviewWaiting } from "@/modules/work/service";
import { dayOf, type PersonDay } from "./days";
import { weekStartOf } from "./engine/rules";
import { findPlan, type PlanRow } from "./plans";
import { findReport, type ReportRow } from "./reports";
import { billableProjects, getRunningTimer, listTimeOf, type RunningTimer, type TimeEntryView } from "./time";

export type BookingView = { id: string; projectId: string; projectName: string; minutes: number; status: string };

/** The person's bookings of the week (FR-PJM-13, read-only here). The project layer owns the rows. */
async function listBookingsOf(personId: string, weekStart: IsoDate): Promise<BookingView[]> {
  return db()
    .select({ id: schema.projectBooking.id, projectId: schema.projectBooking.projectId, projectName: schema.workProject.name, minutes: schema.projectBooking.minutes, status: schema.projectBooking.status })
    .from(schema.projectBooking)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBooking.projectId))
    .where(and(eq(schema.projectBooking.personId, personId), eq(schema.projectBooking.weekStart, weekStart)))
    .orderBy(asc(schema.workProject.name));
}

export type TodayView = {
  date: IsoDate;
  day: PersonDay | null;
  plan: PlanRow | null;
  /** The plan's tasks in the plan's order, as they stand now. */
  planned: (DayTask & { plannedMinutes: number | null })[];
  /** Open work due today or overdue that is not in the plan. */
  due: DayTask[];
  /** Everything open: what the quick "plan it" and "log time" pick from. */
  open: DayTask[];
  reviews: ReviewWaiting[];
  handoffs: HandoffWaiting[];
  blockersRaised: OpenBlocker[];
  blockersWaiting: OpenBlocker[];
  bookings: BookingView[];
  report: ReportRow | null;
  time: TimeEntryView[];
  /** The person's running timer, whatever day it started. */
  timer: RunningTimer | null;
  /** Of the projects on this page, the ones whose time is billed to the client by default (FR-PJM-24): what the quick log offers before anything is logged. */
  billableProjects: string[];
};

/**
 * Today's page comes from the shared cache's live tier (src/lib/cache/live.ts): dropped after the
 * person's every action and every notification to them, at most `TTL.live` seconds old otherwise.
 * Another day than today (a test, a report) is read as it stands.
 */
export function getToday(personId: string, date: IsoDate): Promise<TodayView> {
  return date === todayInVietnam() ? cachedLive(personId, "today", () => loadToday(personId, date)) : loadToday(personId, date);
}

async function loadToday(personId: string, date: IsoDate): Promise<TodayView> {
  const [day, plan, open, reviews, handoffs, raised, waiting, bookings, report, time, timer] = await Promise.all([
    dayOf([personId], date),
    findPlan(personId, date),
    listOpenWorkOf(personId, date),
    listReviewsWaitingFor(personId),
    listHandoffsWaitingFor(personId),
    listOpenBlockersRaisedBy([personId]),
    listBlockersWaitingOn(personId),
    listBookingsOf(personId, weekStartOf(date)),
    findReport(personId, date),
    listTimeOf([personId], date, date),
    getRunningTimer(personId),
  ]);
  const items = plan?.items ?? [];
  const closed = await listDayTasks(items.map((item) => item.taskId).filter((taskId) => !open.some((task) => task.taskId === taskId)));
  const billable = await billableProjects([...open, ...closed].map((task) => task.projectId));
  const known = new Map([...open, ...closed].map((task) => [task.taskId, task]));
  const planned = items.flatMap((item) => {
    const task = known.get(item.taskId);
    return task ? [{ ...task, plannedMinutes: item.minutes }] : [];
  });
  const inPlan = new Set(items.map((item) => item.taskId));
  return {
    date,
    day: day.get(personId) ?? null,
    plan,
    planned,
    due: open.filter((task) => !inPlan.has(task.taskId) && !!task.dueDate && task.dueDate <= date),
    open,
    reviews,
    handoffs,
    blockersRaised: raised,
    // A blocker the person raised on their own task and named themselves in is listed once.
    blockersWaiting: waiting
      .filter((blocker) => blocker.raisedByPersonId !== personId)
      .map((blocker) => ({ blockerId: blocker.id, taskId: blocker.taskId, key: blocker.key, title: blocker.title, reason: blocker.reason, raisedByPersonId: blocker.raisedByPersonId, raisedByName: blocker.raisedByName, neededPersonId: blocker.neededPersonId, neededName: blocker.neededName, raisedAt: blocker.raisedAt })),
    bookings,
    report,
    time,
    timer,
    billableProjects: [...billable],
  };
}
