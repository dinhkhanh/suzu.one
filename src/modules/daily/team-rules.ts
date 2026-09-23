// Each work team's rules for the day (daily_team_policy) and what they add up to for a person.
// The rows are reference data read on every Today page: the whole table sits in the shared cache,
// and saving a team's rules drops it.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { DEFAULT_TEAM_RULES, mergeRules, type PersonRules, type TeamRules } from "./engine/rules";
import type { RuleMode } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type TeamPolicyRow = typeof schema.dailyTeamPolicy.$inferSelect;

const RULES_CACHE = "daily:team-policies";
const RULES_TTL = 60 * 60;

const listAllRows = (executor?: Executor): Promise<TeamPolicyRow[]> => (executor ? executor.select().from(schema.dailyTeamPolicy) : cached(RULES_CACHE, RULES_TTL, () => db().select().from(schema.dailyTeamPolicy)));

const rulesOfRow = (row: TeamPolicyRow | undefined): TeamRules =>
  row
    ? { planMode: row.planMode as RuleMode, reportMode: row.reportMode as RuleMode, reportDays: row.reportDays, planCutoff: row.planCutoff, reportDeadline: row.reportDeadline, timeMode: row.timeMode as RuleMode, timesheetApproval: row.timesheetApproval, coverMinDays: row.coverMinDays, cycleWeeks: row.cycleWeeks, cycleStart: row.cycleStart }
    : DEFAULT_TEAM_RULES;

/** A team's rules; a team that never set any follows the defaults (SRS A10, A11). */
export async function getTeamRules(teamId: string, executor?: Executor): Promise<TeamRules> {
  return rulesOfRow((await listAllRows(executor)).find((row) => row.teamId === teamId));
}

export async function saveTeamRules(teamId: string, rules: TeamRules): Promise<{ before: TeamRules; after: TeamRules }> {
  const saved = await db().transaction(async (tx) => {
    const before = await getTeamRules(teamId, tx);
    const values = { ...rules, reportDays: [...rules.reportDays].sort((a, b) => a - b), updatedAt: new Date() };
    const [row] = await tx.insert(schema.dailyTeamPolicy).values({ teamId, ...values }).onConflictDoUpdate({ target: schema.dailyTeamPolicy.teamId, set: values }).returning();
    return { before, after: rulesOfRow(row) };
  });
  await invalidate(RULES_CACHE);
  return saved;
}

/** Writers outside this file (seeds, tests): the rules changed. */
export const invalidateTeamRules = () => invalidate(RULES_CACHE);

export type PersonTeams = { rules: PersonRules; teamIds: string[]; ledTeamIds: string[] };

/**
 * What each person follows: the strictest rules of the active work teams they belong to (a person
 * in no team gets `NO_TEAM_RULES`). One membership query and the cached rules table.
 */
export async function rulesOfPeople(personIds: readonly string[], executor?: Executor): Promise<Map<string, PersonTeams>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, PersonTeams>();
  if (ids.length === 0) return result;
  const reader = executor ?? db();
  const [memberships, rows] = await Promise.all([
    reader
      .select({ personId: schema.workTeamMember.personId, teamId: schema.workTeamMember.teamId, role: schema.workTeamMember.role })
      .from(schema.workTeamMember)
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTeamMember.teamId))
      .where(and(inArray(schema.workTeamMember.personId, ids), eq(schema.workTeam.isActive, true))),
    listAllRows(executor),
  ]);
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));
  const of = Map.groupBy(memberships, (row) => row.personId);
  for (const personId of ids) {
    const own = of.get(personId) ?? [];
    result.set(personId, { rules: mergeRules(own.map((row) => rulesOfRow(byTeam.get(row.teamId)))), teamIds: own.map((row) => row.teamId), ledTeamIds: own.filter((row) => row.role === "lead").map((row) => row.teamId) });
  }
  return result;
}

/**
 * Everyone the daily loop may ask something of: every active person. Since Q18 (2026-09-23) the
 * plan and the report are asked of the person, not of their team, so someone in no work team is
 * reminded like everyone else; their rules are `NO_TEAM_RULES` and their approver is their line
 * manager. Who is actually due on a day is still `dayOf`'s answer, person by person.
 */
export async function listDailyPeople(executor: Executor = db()): Promise<string[]> {
  const rows = await executor.select({ personId: schema.person.id }).from(schema.person).where(eq(schema.person.status, "active"));
  return rows.map((row) => row.personId);
}
