// The morning plan (FR-PJM-21): the person picks today's tasks from their own open work, in the
// order they mean to do them, with an estimate each set against their hours today. Yesterday's
// report said what "tomorrow" would be: that is today's plan until the person changes it.
import "server-only";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { type DayTask, listDayTasks, listOpenWorkOf } from "@/modules/work/service";
import { dayOf, type PersonDay } from "./days";
import type { PlannedItem } from "./schema";

export type PlanRow = typeof schema.dailyPlan.$inferSelect;

export async function findPlan(personId: string, date: IsoDate): Promise<PlanRow | null> {
  const [row] = await db().select().from(schema.dailyPlan).where(and(eq(schema.dailyPlan.personId, personId), eq(schema.dailyPlan.date, date))).limit(1);
  return row ?? null;
}

/** What the last report before this date (within a week) planned for "tomorrow". */
export async function carriedOver(personId: string, date: IsoDate): Promise<PlannedItem[]> {
  const [row] = await db()
    .select({ tomorrow: schema.dailyReport.tomorrow })
    .from(schema.dailyReport)
    .where(and(eq(schema.dailyReport.personId, personId), lt(schema.dailyReport.date, date), gte(schema.dailyReport.date, addDays(date, -7)), eq(schema.dailyReport.status, "submitted")))
    .orderBy(desc(schema.dailyReport.date))
    .limit(1);
  return row?.tomorrow ?? [];
}

export type PlanPage = {
  plan: PlanRow | null;
  day: PersonDay | null;
  /** The person's open work, overdue first, plus any planned task that has moved on since. */
  candidates: DayTask[];
  /** In order: the saved plan, else what yesterday's report carried over. */
  selected: PlannedItem[];
  carried: boolean;
};

export async function getPlanPage(personId: string, date: IsoDate): Promise<PlanPage> {
  const [plan, day, open, carried] = await Promise.all([findPlan(personId, date), dayOf([personId], date), listOpenWorkOf(personId, date), carriedOver(personId, date)]);
  const selected = plan ? plan.items : carried.filter((item) => open.some((task) => task.taskId === item.taskId));
  const missing = selected.filter((item) => !open.some((task) => task.taskId === item.taskId)).map((item) => item.taskId);
  const candidates = [...open, ...(await listDayTasks(missing))];
  return { plan, day: day.get(personId) ?? null, candidates, selected, carried: !plan && selected.length > 0 };
}

/**
 * Saves the plan. Every task must be the person's own open work — or already in the plan, which
 * lets a task that was finished meanwhile stay where it was put.
 */
export async function savePlan(personId: string, date: IsoDate, items: readonly PlannedItem[], note: string | null): Promise<{ before: PlanRow | null; after: PlanRow }> {
  const before = await findPlan(personId, date);
  const open = await listOpenWorkOf(personId, date);
  const allowed = new Set([...open.map((task) => task.taskId), ...(before?.items ?? []).map((item) => item.taskId)]);
  const unique = [...new Map(items.map((item) => [item.taskId, item])).values()];
  if (unique.some((item) => !allowed.has(item.taskId))) throw new ActionError("plan_task_not_yours");
  const values = { items: unique.map((item) => ({ taskId: item.taskId, minutes: item.minutes ?? null })), note, submittedAt: new Date(), updatedAt: new Date() };
  const [after] = await db()
    .insert(schema.dailyPlan)
    .values({ personId, date, ...values })
    .onConflictDoUpdate({ target: [schema.dailyPlan.personId, schema.dailyPlan.date], set: values })
    .returning();
  return { before, after };
}

/** Quick-add and "plan it for today" from Today: appends one of the person's tasks to the day's plan. */
export async function addToPlan(personId: string, date: IsoDate, taskId: string): Promise<PlanRow> {
  const plan = await findPlan(personId, date);
  // Without a plan yet, the day starts from what yesterday carried over that is still open.
  const items = plan ? plan.items : await Promise.all([carriedOver(personId, date), listOpenWorkOf(personId, date)]).then(([carried, open]) => carried.filter((item) => open.some((task) => task.taskId === item.taskId)));
  if (items.some((item) => item.taskId === taskId)) return plan ?? (await savePlan(personId, date, items, null)).after;
  const [task] = await listDayTasks([taskId]);
  return (await savePlan(personId, date, [...items, { taskId, minutes: task?.estimateMinutes ?? null }], plan?.note ?? null)).after;
}
