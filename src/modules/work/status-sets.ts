// The status library (FR-WRK-03, FR-PJM): task workflows a new team starts from, and project
// status sets a team's projects move through. Both are made and kept by people — the app ships
// none. A workflow is copied into the team (`work_state`) and edited there; a project status set
// is linked: a team names its set, a project names its status, and the `work_project` trigger
// keeps the status's category in `work_project.status`, which is what every rule reads.
//
// All three tables are small reference data read by the team, project and library screens: each
// sits whole under one cache key and callers filter it here. Every writer below drops its keys once
// committed; inside a transaction pass the executor, and the rows come from there, not the cache.
import "server-only";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { invalidateWorkDirectory } from "./directory";
import { MAX_SET_PROJECT_STATUSES, MAX_SET_STATES, PROJECT_STATUSES, type ProjectStatus, STATE_CATEGORIES, type StateCategory, workflowHasStartAndDone } from "./enums";
import type { StateSetItem } from "./schema";

type Executor = Tx | ReturnType<typeof db>;
export type StateSetRow = typeof schema.workStateSet.$inferSelect;
export type ProjectStatusSetRow = typeof schema.workProjectStatusSet.$inferSelect;
export type ProjectStatusRow = typeof schema.workProjectStatus.$inferSelect;

const KEYS = { stateSets: "work:state-sets", projectStatusSets: "work:project-status-sets", projectStatuses: "work:project-statuses" } as const;

/** After a write to `work_state_set` has committed. */
export const invalidateStateSets = () => invalidate(KEYS.stateSets);
/** After a write to `work_project_status_set` or `work_project_status` has committed. */
export const invalidateProjectStatusSets = () => Promise.all([invalidate(KEYS.projectStatusSets), invalidate(KEYS.projectStatuses)]);

/** A set may be used by a team when it is shared (no owner) or the team's own. */
export const usableByTeam = (set: { ownerTeamId: string | null }, teamId: string | null): boolean => set.ownerTeamId === null || set.ownerTeamId === teamId;

// ── Reads ───────────────────────────────────────────────────────────────────────────────────

/** The workflow library, by name. */
export async function listStateSets(executor?: Executor): Promise<StateSetRow[]> {
  const load = (from: Executor) => from.select().from(schema.workStateSet).orderBy(asc(schema.workStateSet.name), asc(schema.workStateSet.id));
  return executor ? load(executor) : cached(KEYS.stateSets, TTL.reference, () => load(db()));
}

export async function findStateSet(setId: string, executor?: Executor): Promise<StateSetRow | undefined> {
  return (await listStateSets(executor)).find((set) => set.id === setId);
}

/** The project status sets, by name. */
export async function listProjectStatusSets(executor?: Executor): Promise<ProjectStatusSetRow[]> {
  const load = (from: Executor) => from.select().from(schema.workProjectStatusSet).orderBy(asc(schema.workProjectStatusSet.name), asc(schema.workProjectStatusSet.id));
  return executor ? load(executor) : cached(KEYS.projectStatusSets, TTL.reference, () => load(db()));
}

export async function findProjectStatusSet(setId: string, executor?: Executor): Promise<ProjectStatusSetRow | undefined> {
  return (await listProjectStatusSets(executor)).find((set) => set.id === setId);
}

/** Every project status of every set, each set's in its order. */
export async function listProjectStatuses(executor?: Executor): Promise<ProjectStatusRow[]> {
  const load = (from: Executor) => from.select().from(schema.workProjectStatus).orderBy(asc(schema.workProjectStatus.setId), asc(schema.workProjectStatus.sortOrder), asc(schema.workProjectStatus.id));
  return executor ? load(executor) : cached(KEYS.projectStatuses, TTL.reference, () => load(db()));
}

/** The statuses of one set, in order; `activeOnly` leaves out the retired ones. */
export async function statusesOfSet(setId: string | null, options: { activeOnly?: boolean; executor?: Executor } = {}): Promise<ProjectStatusRow[]> {
  if (!setId) return [];
  return (await listProjectStatuses(options.executor)).filter((status) => status.setId === setId && (!options.activeOnly || status.isActive));
}

/** The project status sets a team may name (active, shared or its own), and the one it has. `teamId` null = a new team. */
export async function projectStatusSetChoices(teamId: string | null, currentSetId: string | null = null): Promise<{ id: string; name: string }[]> {
  return (await listProjectStatusSets()).filter((set) => set.id === currentSetId || (set.isActive && usableByTeam(set, teamId))).map(({ id, name }) => ({ id, name }));
}

/** The workflows a new team may start from: active, shared or owned by one of `teamIds` (the creator's teams). */
export async function workflowChoices(teamIds: ReadonlySet<string>): Promise<{ id: string; name: string; states: StateSetItem[] }[]> {
  return (await listStateSets()).filter((set) => set.isActive && (!set.ownerTeamId || teamIds.has(set.ownerTeamId))).map(({ id, name, states }) => ({ id, name, states }));
}

/** Status id → its name, for the screens that show a project's status. */
export async function projectStatusNames(): Promise<Map<string, string>> {
  return new Map((await listProjectStatuses()).map((status) => [status.id, status.name]));
}

/** What a project form offers: the team's set's active statuses, plus the project's own if since retired. */
export async function projectStatusChoices(teamSetId: string | null, currentStatusId: string | null = null): Promise<{ id: string; name: string; category: ProjectStatus }[]> {
  return (await statusesOfSet(teamSetId)).filter((status) => status.isActive || status.id === currentStatusId).map(({ id, name, category }) => ({ id, name, category: category as ProjectStatus }));
}

/**
 * What a project write stores for a posted status — a category, or a status id from the team's
 * set. A category leaves `status_id` to the trigger (the set's first status of it); an id must be
 * one of the team's set, active unless the project already has it.
 */
export async function resolveProjectStatus(executor: Executor, teamId: string, value: string, currentStatusId: string | null = null): Promise<{ status: ProjectStatus; statusId: string | null }> {
  if ((PROJECT_STATUSES as readonly string[]).includes(value)) return { status: value as ProjectStatus, statusId: null };
  const [row] = await executor
    .select({ id: schema.workProjectStatus.id, category: schema.workProjectStatus.category, isActive: schema.workProjectStatus.isActive })
    .from(schema.workProjectStatus)
    .innerJoin(schema.workTeam, eq(schema.workTeam.projectStatusSetId, schema.workProjectStatus.setId))
    .where(and(eq(schema.workTeam.id, teamId), eq(schema.workProjectStatus.id, value)))
    .limit(1);
  if (!row || (!row.isActive && row.id !== currentStatusId)) throw new ActionError("project_status_not_found");
  return { status: row.category as ProjectStatus, statusId: row.id };
}

/** How many teams use each project status set, and how many projects sit in each status. */
export async function projectStatusUsage(): Promise<{ teamsBySet: Map<string, number>; projectsByStatus: Map<string, number> }> {
  const [teams, projects] = await Promise.all([
    db().select({ setId: schema.workTeam.projectStatusSetId, value: count() }).from(schema.workTeam).where(sql`${schema.workTeam.projectStatusSetId} IS NOT NULL`).groupBy(schema.workTeam.projectStatusSetId),
    db().select({ statusId: schema.workProject.statusId, value: count() }).from(schema.workProject).where(sql`${schema.workProject.statusId} IS NOT NULL`).groupBy(schema.workProject.statusId),
  ]);
  return { teamsBySet: new Map(teams.map((row) => [row.setId!, row.value])), projectsByStatus: new Map(projects.map((row) => [row.statusId!, row.value])) };
}

// ── Workflows ───────────────────────────────────────────────────────────────────────────────

export type StateSetInput = { name: string; description: string | null; ownerTeamId: string | null; states: StateSetItem[]; isActive: boolean };

function checkStates(states: readonly StateSetItem[]): StateSetItem[] {
  const cleaned = states.map((state) => ({ name: state.name.trim(), category: state.category })).filter((state) => state.name);
  if (cleaned.length === 0 || cleaned.length > MAX_SET_STATES) throw new ActionError("state_set_size");
  if (cleaned.some((state) => !(STATE_CATEGORIES as readonly string[]).includes(state.category))) throw new ActionError("state_set_size");
  if (!workflowHasStartAndDone(cleaned.map((state) => state.category))) throw new ActionError("workflow_needs_start_and_done");
  return cleaned;
}

export async function saveStateSet(setId: string | null, input: StateSetInput, actorPersonId: string): Promise<{ before: StateSetRow | null; after: StateSetRow }> {
  const values = { ...input, states: checkStates(input.states) };
  const saved = await db().transaction(async (tx) => {
    if (!setId) {
      const [after] = await tx.insert(schema.workStateSet).values({ ...values, createdByPersonId: actorPersonId }).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.workStateSet).where(eq(schema.workStateSet.id, setId)).limit(1).for("update");
    if (!before) throw new ActionError("status_set_not_found");
    const [after] = await tx.update(schema.workStateSet).set({ ...values, updatedAt: new Date() }).where(eq(schema.workStateSet.id, setId)).returning();
    return { before, after };
  });
  await invalidateStateSets();
  return saved;
}

/** Teams made from a workflow kept their own copy: removing it changes none of them. */
export async function deleteStateSet(setId: string): Promise<StateSetRow> {
  const [row] = await db().delete(schema.workStateSet).where(eq(schema.workStateSet.id, setId)).returning();
  if (!row) throw new ActionError("status_set_not_found");
  await invalidateStateSets();
  return row;
}

/** A team's workflow as it stands (its active states, in order), saved to the library as the team's own. */
export async function stateSetFromTeam(teamId: string, name: string, actorPersonId: string): Promise<StateSetRow> {
  const states = await db().select({ name: schema.workState.name, category: schema.workState.category }).from(schema.workState).where(and(eq(schema.workState.teamId, teamId), eq(schema.workState.isActive, true))).orderBy(asc(schema.workState.sortOrder), asc(schema.workState.createdAt));
  const { after } = await saveStateSet(null, { name, description: null, ownerTeamId: teamId, states, isActive: true }, actorPersonId);
  return after;
}

/** The states a new team starts with: a workflow from the library, or one per category, named by the caller. */
export function startingStates(set: Pick<StateSetRow, "states"> | null, categoryNames: Partial<Record<StateCategory, string>>): StateSetItem[] {
  return set ? set.states : STATE_CATEGORIES.map((category) => ({ name: categoryNames[category]?.trim() || category, category }));
}

// ── Project status sets ─────────────────────────────────────────────────────────────────────

export type ProjectStatusInput = { id: string | null; name: string; category: ProjectStatus; isActive: boolean };
export type ProjectStatusSetInput = { name: string; description: string | null; ownerTeamId: string | null; isActive: boolean; statuses: ProjectStatusInput[] };
export type SavedProjectStatusSet = ProjectStatusSetRow & { statuses: ProjectStatusRow[] };

/**
 * The set and its statuses, as listed: a listed status is kept (renamed, reordered, retired), an
 * unlisted one removed — unless a project is in it, or its category would change under projects
 * already in it (their category would no longer be their status's). Afterwards the projects of
 * the teams using the set that had no status of their category take the set's first one.
 */
export async function saveProjectStatusSet(setId: string | null, input: ProjectStatusSetInput, actorPersonId: string): Promise<{ before: SavedProjectStatusSet | null; after: SavedProjectStatusSet }> {
  const statuses = input.statuses.map((status) => ({ ...status, name: status.name.trim() })).filter((status) => status.name);
  if (statuses.length === 0 || statuses.length > MAX_SET_PROJECT_STATUSES) throw new ActionError("status_set_size");
  const setValues = { name: input.name, description: input.description, ownerTeamId: input.ownerTeamId, isActive: input.isActive };
  const saved = await db().transaction(async (tx) => {
    let before: SavedProjectStatusSet | null = null;
    let set: ProjectStatusSetRow;
    if (setId) {
      const [row] = await tx.select().from(schema.workProjectStatusSet).where(eq(schema.workProjectStatusSet.id, setId)).limit(1).for("update");
      if (!row) throw new ActionError("status_set_not_found");
      before = { ...row, statuses: await statusesOfSet(setId, { executor: tx }) };
      [set] = await tx.update(schema.workProjectStatusSet).set({ ...setValues, updatedAt: new Date() }).where(eq(schema.workProjectStatusSet.id, setId)).returning();
    } else {
      [set] = await tx.insert(schema.workProjectStatusSet).values({ ...setValues, createdByPersonId: actorPersonId }).returning();
    }

    const existing = new Map((before?.statuses ?? []).map((status) => [status.id, status]));
    if (statuses.some((status) => status.id && !existing.has(status.id))) throw new ActionError("project_status_not_found");
    const kept = new Set(statuses.flatMap((status) => (status.id ? [status.id] : [])));
    const removed = [...existing.keys()].filter((id) => !kept.has(id));
    const recategorised = statuses.flatMap((status) => (status.id && existing.get(status.id)!.category !== status.category ? [status.id] : []));
    const touched = [...removed, ...recategorised];
    if (touched.length) {
      const [used] = await tx.select({ value: count() }).from(schema.workProject).where(inArray(schema.workProject.statusId, touched));
      if ((used?.value ?? 0) > 0) throw new ActionError("project_status_in_use");
    }
    if (removed.length) await tx.delete(schema.workProjectStatus).where(inArray(schema.workProjectStatus.id, removed));
    const now = new Date();
    for (const [index, status] of statuses.entries()) {
      const values = { name: status.name, category: status.category, isActive: status.isActive, sortOrder: (index + 1) * 10 };
      if (status.id) await tx.update(schema.workProjectStatus).set({ ...values, updatedAt: now }).where(eq(schema.workProjectStatus.id, status.id));
      else await tx.insert(schema.workProjectStatus).values({ ...values, setId: set.id });
    }
    // Writing `status_id` wakes the trigger, which picks each project's status from the set again.
    // Projects in a status of this set keep it; the others take the set's first of their category.
    const teams = tx.select({ id: schema.workTeam.id }).from(schema.workTeam).where(eq(schema.workTeam.projectStatusSetId, set.id));
    const resolved = await tx.update(schema.workProject).set({ statusId: null }).where(and(inArray(schema.workProject.teamId, teams), isNull(schema.workProject.statusId))).returning({ id: schema.workProject.id });
    return { before, after: { ...set, statuses: await statusesOfSet(set.id, { executor: tx }) }, resolved: resolved.length };
  });
  await Promise.all([invalidateProjectStatusSets(), saved.resolved > 0 ? invalidateWorkDirectory() : null]);
  return { before: saved.before, after: saved.after };
}

/** A set no team uses and no project sits in. */
export async function deleteProjectStatusSet(setId: string): Promise<ProjectStatusSetRow> {
  const removed = await db().transaction(async (tx) => {
    const [team] = await tx.select({ id: schema.workTeam.id }).from(schema.workTeam).where(eq(schema.workTeam.projectStatusSetId, setId)).limit(1);
    if (team) throw new ActionError("status_set_in_use");
    const statuses = tx.select({ id: schema.workProjectStatus.id }).from(schema.workProjectStatus).where(eq(schema.workProjectStatus.setId, setId));
    const [project] = await tx.select({ id: schema.workProject.id }).from(schema.workProject).where(inArray(schema.workProject.statusId, statuses)).limit(1);
    if (project) throw new ActionError("project_status_in_use");
    const [row] = await tx.delete(schema.workProjectStatusSet).where(eq(schema.workProjectStatusSet.id, setId)).returning();
    if (!row) throw new ActionError("status_set_not_found");
    return row;
  });
  await invalidateProjectStatusSets();
  return removed;
}

/**
 * Inside the team write that changes its set: the team's projects drop the old set's statuses and
 * take the new set's first of their category (the trigger), or none. The caller invalidates the
 * work directory once it commits.
 */
export async function restatusTeamProjects(tx: Executor, teamId: string): Promise<void> {
  await tx.update(schema.workProject).set({ statusId: null }).where(eq(schema.workProject.teamId, teamId));
}

/** May the team name this set (`null` = none)? Active and usable by it — or already its set. */
export async function checkTeamProjectStatusSet(executor: Executor, teamId: string | null, setId: string | null, currentSetId: string | null = null): Promise<void> {
  if (!setId || setId === currentSetId) return;
  const set = await findProjectStatusSet(setId, executor);
  if (!set || !set.isActive || !usableByTeam(set, teamId)) throw new ActionError("status_set_not_found");
}

