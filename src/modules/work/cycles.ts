// Cycles (FR-PJM-10): optional per team (the team's day rules set the length and the first day).
// The midnight job makes the current and the next cycle, closes the ones that ended with their
// review (planned / done / rolled) and moves unfinished work into the next one, counting how often
// each task rolled. Every step is guarded, so a second run the same night changes nothing.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { cycleNumbered, cycleProgress, cyclesToMake, cycleSummary, rolloverIds, validCycleWeeks } from "./engine/cycles";
import { listItems, logActivity, type TaskListItem } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
// The daily module keeps the team rules (cycle length and start) and builds on work: loaded when
// first needed, so the two never import each other at load time.
const dailyService = () => import("../daily/service");
export type CycleRow = typeof schema.workCycle.$inferSelect;

const live = isNull(schema.task.deletedAt);

/** A team's cycles, newest first. */
export async function listTeamCycles(teamId: string, executor: Executor = db()): Promise<CycleRow[]> {
  return executor.select().from(schema.workCycle).where(eq(schema.workCycle.teamId, teamId)).orderBy(desc(schema.workCycle.number));
}

/** The cycles tasks may still be planned into — for pickers, filters and bulk edit: open ones, oldest first. */
export async function listOpenCycles(teamIds: readonly string[]): Promise<CycleRow[]> {
  if (teamIds.length === 0) return [];
  return db()
    .select()
    .from(schema.workCycle)
    .where(and(inArray(schema.workCycle.teamId, [...teamIds]), isNull(schema.workCycle.closedAt)))
    .orderBy(asc(schema.workCycle.startDate));
}

export async function findCycle(cycleId: string): Promise<CycleRow | undefined> {
  const [row] = await db().select().from(schema.workCycle).where(eq(schema.workCycle.id, cycleId)).limit(1);
  return row;
}

/** Makes a team's cycles for today (idempotent: the team + number is unique). */
async function makeCycles(tx: Executor, teamId: string, start: IsoDate | null, weeks: number | null, today: IsoDate): Promise<number> {
  const windows = cyclesToMake(start, weeks, today);
  if (windows.length === 0) return 0;
  const rows = await tx
    .insert(schema.workCycle)
    .values(windows.map((window) => ({ teamId, ...window })))
    .onConflictDoNothing()
    .returning({ id: schema.workCycle.id });
  return rows.length;
}

/**
 * Closes one ended cycle: its review is written, open work moves to the next cycle (made here if
 * the job has not made it yet; with cycles switched off meanwhile, open work simply leaves the
 * cycle). The close is claimed first, so only one run does it.
 */
async function closeCycle(tx: Executor, cycle: CycleRow, rules: { cycleStart: IsoDate | null; cycleWeeks: number | null }): Promise<{ rolled: number }> {
  const [claimed] = await tx.update(schema.workCycle).set({ closedAt: new Date() }).where(and(eq(schema.workCycle.id, cycle.id), isNull(schema.workCycle.closedAt))).returning();
  if (!claimed) return { rolled: 0 };
  const tasks = await tx.select({ id: schema.task.id, status: schema.task.status }).from(schema.workTask).innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), live)).where(eq(schema.workTask.cycleId, cycle.id));
  const summary = cycleSummary(tasks);
  await tx.update(schema.workCycle).set({ summary }).where(eq(schema.workCycle.id, cycle.id));
  const rolling = rolloverIds(tasks);
  if (rolling.length === 0) return { rolled: 0 };

  let next: CycleRow | undefined;
  if (rules.cycleStart && validCycleWeeks(rules.cycleWeeks)) {
    const window = cycleNumbered(rules.cycleStart, rules.cycleWeeks, cycle.number + 1);
    await tx.insert(schema.workCycle).values({ teamId: cycle.teamId, ...window }).onConflictDoNothing();
    [next] = await tx.select().from(schema.workCycle).where(and(eq(schema.workCycle.teamId, cycle.teamId), eq(schema.workCycle.number, cycle.number + 1))).limit(1);
  }
  await tx
    .update(schema.workTask)
    .set({ cycleId: next?.id ?? null, cycleRollovers: sql`${schema.workTask.cycleRollovers} + 1` })
    .where(and(inArray(schema.workTask.taskId, rolling), eq(schema.workTask.cycleId, cycle.id)));
  for (const taskId of rolling) await logActivity(tx, taskId, null, [{ type: "cycle_rolled", from: { id: cycle.id, name: `#${cycle.number}` }, to: next ? { id: next.id, name: `#${next.number}` } : null }]);
  return { rolled: rolling.length };
}

/** Midnight (FR-PJM-10): for every active team with cycles on, make, close and roll over. */
export async function runCycles(today: IsoDate): Promise<{ teams: number; made: number; closed: number; rolled: number }> {
  const teams = await db().select({ id: schema.workTeam.id }).from(schema.workTeam).where(eq(schema.workTeam.isActive, true));
  const { getTeamRules } = await dailyService();
  const result = { teams: 0, made: 0, closed: 0, rolled: 0 };
  for (const team of teams) {
    const rules = await getTeamRules(team.id);
    const ended = await db().select().from(schema.workCycle).where(and(eq(schema.workCycle.teamId, team.id), isNull(schema.workCycle.closedAt), lt(schema.workCycle.endDate, today))).orderBy(asc(schema.workCycle.number));
    const on = !!rules.cycleStart && validCycleWeeks(rules.cycleWeeks);
    if (!on && ended.length === 0) continue;
    result.teams += 1;
    await db().transaction(async (tx) => {
      // Close first, oldest first: a task rolls through each ended cycle to the one after it.
      for (const cycle of ended) {
        const { rolled } = await closeCycle(tx, cycle, rules);
        result.closed += 1;
        result.rolled += rolled;
      }
      if (on) result.made += await makeCycles(tx, team.id, rules.cycleStart, rules.cycleWeeks, today);
    });
  }
  return result;
}

// ── The cycle page ──────────────────────────────────────────────────────────────────────────

export type CyclePage = {
  current: (CycleRow & { progress: ReturnType<typeof cycleProgress>; tasks: TaskListItem[]; rolledIn: number }) | null;
  upcoming: (CycleRow & { planned: number }) | null;
  past: CycleRow[];
};

/** The running cycle with its tasks and progress, the next one's size, and the reviews of past ones. The caller checked the team is visible. */
export async function getCyclePage(teamId: string, today: IsoDate, visibleTasks: (items: TaskListItem[]) => TaskListItem[]): Promise<CyclePage> {
  const cycles = await listTeamCycles(teamId);
  const current = cycles.find((cycle) => cycle.startDate <= today && cycle.endDate >= today && !cycle.closedAt) ?? null;
  const upcoming = cycles.filter((cycle) => cycle.startDate > today).at(-1) ?? null;
  const past = cycles.filter((cycle) => cycle.closedAt);
  const [tasks, counts] = await Promise.all([
    current ? listItems(eq(schema.workTask.cycleId, current.id), db(), 1000) : Promise.resolve([] as TaskListItem[]),
    upcoming ? db().select({ count: sql<number>`count(*)::int` }).from(schema.workTask).innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), live)).where(eq(schema.workTask.cycleId, upcoming.id)) : Promise.resolve([{ count: 0 }]),
  ]);
  const rolledIn = current ? await db().select({ count: sql<number>`count(*)::int` }).from(schema.workTask).where(and(eq(schema.workTask.cycleId, current.id), sql`${schema.workTask.cycleRollovers} > 0`)) : [{ count: 0 }];
  return {
    current: current ? { ...current, progress: cycleProgress(tasks), tasks: visibleTasks(tasks), rolledIn: Number(rolledIn[0]?.count ?? 0) } : null,
    upcoming: upcoming ? { ...upcoming, planned: Number(counts[0]?.count ?? 0) } : null,
    past,
  };
}
