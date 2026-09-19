// Goals, key results and check-ins (FR-PRF-01): reads for the screens and the use-cases behind the
// actions. Figures are never stored while a goal is open — they are computed by the pure engine
// from the key results, whose current values only ever change through an append-only check-in.
import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { Principal } from "../platform/rbac/policy";
import { type GoalInput, type GoalProgress, goalProgress, isStale, keyResultProgressBp, weekStartOf, weightedAverageBp } from "./engine/progress";
import { type Confidence, type GoalLevel, type GoalStatus, isAnnual, isPeriodKey, levelRank, type MetricType, type Milestone, parseMetricValue, STALE_AFTER_DAYS, yearOfPeriod } from "./enums";
import { type Directory, loadDirectory, reportsBelow } from "./people";
import { canCheckIn, canCloseGoal, canEditGoal, canManagePerformanceOf, canReopenGoal, canSeeGoal, type GoalParties, readablePeople } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type GoalRow = typeof schema.goal.$inferSelect;
export type KeyResultRow = typeof schema.keyResult.$inferSelect;
export type CheckInRow = typeof schema.goalCheckIn.$inferSelect;
export type Viewer = { principal: Principal; personId: string };

export type KeyResultView = KeyResultRow & { metricType: MetricType; confidence: Confidence | null; progressBp: number; stale: boolean };
export type GoalView = Omit<GoalRow, "level" | "status"> & {
  level: GoalLevel;
  status: GoalStatus;
  ownerName: string;
  /** The entity, department, team or person the goal belongs to; null for the group. */
  unitName: string | null;
  progress: GoalProgress;
  keyResults: KeyResultView[];
  /** Children the viewer may see. Individual goals of people they do not read are only counted. */
  childIds: string[];
  hiddenChildren: number;
};

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

type Year = { goals: Map<string, GoalRow>; keyResults: Map<string, KeyResultRow[]>; inputs: Map<string, GoalInput> };

/** Every goal of a year with its key results: parents and children share a year, so a roll-up never needs more. */
async function loadYear(year: number, executor: Executor = db()): Promise<Year> {
  const goals = await executor.select().from(schema.goal).where(eq(schema.goal.year, year)).orderBy(asc(schema.goal.createdAt), asc(schema.goal.id));
  const keyResultRows = goals.length === 0 ? [] : await executor.select().from(schema.keyResult).where(inArray(schema.keyResult.goalId, goals.map((goal) => goal.id))).orderBy(asc(schema.keyResult.sortOrder), asc(schema.keyResult.createdAt));
  const keyResults = new Map<string, KeyResultRow[]>();
  for (const row of keyResultRows) keyResults.set(row.goalId, [...(keyResults.get(row.goalId) ?? []), row]);
  const children = new Map<string, string[]>();
  for (const goal of goals) if (goal.parentGoalId) children.set(goal.parentGoalId, [...(children.get(goal.parentGoalId) ?? []), goal.id]);
  const inputs = new Map<string, GoalInput>(
    goals.map((goal) => [
      goal.id,
      {
        id: goal.id,
        status: goal.status as GoalStatus,
        weight: goal.weight,
        finalProgressBp: goal.finalProgressBp,
        childIds: children.get(goal.id) ?? [],
        keyResults: (keyResults.get(goal.id) ?? []).map((row) => ({ id: row.id, metricType: row.metricType as MetricType, startValue: row.startValue, targetValue: row.targetValue, currentValue: row.currentValue, milestones: row.milestones, weight: row.weight, confidence: row.confidence as Confidence | null })),
      },
    ]),
  );
  return { goals: new Map(goals.map((goal) => [goal.id, goal])), keyResults, inputs };
}

export const partiesOf = (goal: Pick<GoalRow, "level" | "entityId" | "departmentId" | "teamId" | "ownerPersonId" | "personId">, directory: Directory): GoalParties => ({
  level: goal.level as GoalLevel,
  entityId: goal.entityId,
  departmentId: goal.departmentId,
  teamId: goal.teamId,
  ownerPersonId: goal.ownerPersonId,
  person: goal.personId ? (directory.get(goal.personId) ?? null) : null,
});

type UnitNames = { entities: Map<string, string>; departments: Map<string, string>; teams: Map<string, string> };
async function loadUnitNames(executor: Executor = db()): Promise<UnitNames> {
  const [entities, departments, teams] = await Promise.all([
    executor.select({ id: schema.entity.id, name: schema.entity.shortName }).from(schema.entity),
    executor.select({ id: schema.department.id, name: schema.department.name }).from(schema.department),
    executor.select({ id: schema.team.id, name: schema.team.name }).from(schema.team),
  ]);
  const toMap = (rows: { id: string; name: string }[]) => new Map(rows.map((row) => [row.id, row.name]));
  return { entities: toMap(entities), departments: toMap(departments), teams: toMap(teams) };
}

function unitNameOf(goal: GoalRow, names: UnitNames, directory: Directory): string | null {
  const entity = goal.entityId ? (names.entities.get(goal.entityId) ?? null) : null;
  switch (goal.level as GoalLevel) {
    case "entity":
      return entity;
    case "department": {
      const department = goal.departmentId ? (names.departments.get(goal.departmentId) ?? null) : null;
      return department && entity ? `${department} · ${entity}` : department;
    }
    case "team":
      return goal.teamId ? (names.teams.get(goal.teamId) ?? null) : null;
    case "individual":
      return goal.personId ? (directory.get(goal.personId)?.fullName ?? null) : null;
    default:
      return null;
  }
}

function toView(goal: GoalRow, year: Year, names: UnitNames, directory: Directory, visible: (goal: GoalRow) => boolean, now: Date): GoalView {
  const children = (year.inputs.get(goal.id)?.childIds ?? []).map((id) => year.goals.get(id)!);
  const seen = children.filter(visible);
  return {
    ...goal,
    level: goal.level as GoalLevel,
    status: goal.status as GoalStatus,
    ownerName: directory.get(goal.ownerPersonId)?.fullName ?? "—",
    unitName: unitNameOf(goal, names, directory),
    progress: goalProgress(goal.id, year.inputs),
    keyResults: (year.keyResults.get(goal.id) ?? []).map((row) => ({
      ...row,
      metricType: row.metricType as MetricType,
      confidence: row.confidence as Confidence | null,
      progressBp: keyResultProgressBp({ ...row, metricType: row.metricType as MetricType }),
      stale: isStale(row.lastCheckInAt, goal.status as GoalStatus, now, STALE_AFTER_DAYS),
    })),
    childIds: seen.map((child) => child.id),
    hiddenChildren: children.length - seen.length,
  };
}

/** What the viewer may see of a year: unit goals (staff only) and the individual goals of the people they read. */
export async function listGoals(viewer: Viewer, filter: { year: number; periodKey?: string | null }, now: Date = new Date()): Promise<GoalView[]> {
  const [year, directory, names] = await Promise.all([loadYear(filter.year), loadDirectory(), loadUnitNames()]);
  const readable = readablePeople(viewer.principal, directory.values());
  const visible = (goal: GoalRow) => (goal.level === "individual" ? !!goal.personId && readable.has(goal.personId) : canSeeGoal(viewer.principal, partiesOf(goal, directory)));
  // A quarter shows its own goals and the annual ones they hang under.
  const inPeriod = (goal: GoalRow) => !filter.periodKey || goal.periodKey === filter.periodKey || (!isAnnual(filter.periodKey) && isAnnual(goal.periodKey));
  return [...year.goals.values()].filter((goal) => visible(goal) && inPeriod(goal)).map((goal) => toView(goal, year, names, directory, (child) => visible(child) && inPeriod(child), now));
}

export type GoalRights = { edit: boolean; checkIn: boolean; close: boolean; reopen: boolean };
export type LoadedGoal = {
  goal: GoalView;
  parties: GoalParties;
  rights: GoalRights;
  parent: { id: string; title: string } | null;
  children: GoalView[];
  checkIns: (CheckInRow & { authorName: string; keyResultTitle: string })[];
  /** Titles for the trace's lines; a child the viewer may not see stays nameless. */
  lineTitles: Record<string, string>;
};

/** One goal for its page, or null when it does not exist or is not the viewer's to see. */
export async function loadGoal(viewer: Viewer, goalId: string, now: Date = new Date()): Promise<LoadedGoal | null> {
  const [row] = await db().select().from(schema.goal).where(eq(schema.goal.id, goalId)).limit(1);
  if (!row) return null;
  const [year, directory, names] = await Promise.all([loadYear(row.year), loadDirectory(), loadUnitNames()]);
  const parties = partiesOf(row, directory);
  if (!canSeeGoal(viewer.principal, parties)) return null;
  const visible = (goal: GoalRow) => canSeeGoal(viewer.principal, partiesOf(goal, directory));
  const goal = toView(row, year, names, directory, visible, now);
  const parentRow = row.parentGoalId ? year.goals.get(row.parentGoalId) : undefined;
  const checkIns = await db().select().from(schema.goalCheckIn).where(eq(schema.goalCheckIn.goalId, goalId)).orderBy(desc(schema.goalCheckIn.createdAt)).limit(200);
  const children = goal.childIds.map((id) => toView(year.goals.get(id)!, year, names, directory, visible, now));
  const lineTitles: Record<string, string> = {};
  for (const keyResult of goal.keyResults) lineTitles[keyResult.id] = keyResult.title;
  for (const child of children) lineTitles[child.id] = child.title;
  return {
    goal,
    parties,
    rights: { edit: canEditGoal(viewer.principal, parties), checkIn: canCheckIn(viewer.principal, parties), close: canCloseGoal(viewer.principal, parties), reopen: canReopenGoal(viewer.principal, parties) },
    parent: parentRow && visible(parentRow) ? { id: parentRow.id, title: parentRow.title } : null,
    children,
    checkIns: checkIns.map((checkIn) => ({ ...checkIn, authorName: directory.get(checkIn.authorPersonId)?.fullName ?? "—", keyResultTitle: goal.keyResults.find((keyResult) => keyResult.id === checkIn.keyResultId)?.title ?? "—" })),
    lineTitles,
  };
}

/** For an action's authorize step: the goal and who it concerns, without the viewer's filter. */
export async function findGoalParties(goalId: string, executor: Executor = db()): Promise<{ goal: GoalRow; parties: GoalParties } | null> {
  const [goal] = await executor.select().from(schema.goal).where(eq(schema.goal.id, goalId)).limit(1);
  if (!goal) return null;
  return { goal, parties: partiesOf(goal, await loadDirectory(executor)) };
}

export async function findKeyResult(keyResultId: string, executor: Executor = db()): Promise<{ keyResult: KeyResultRow; goal: GoalRow; parties: GoalParties } | null> {
  const [keyResult] = await executor.select().from(schema.keyResult).where(eq(schema.keyResult.id, keyResultId)).limit(1);
  if (!keyResult) return null;
  const found = await findGoalParties(keyResult.goalId, executor);
  return found ? { keyResult, ...found } : null;
}

// ── What the "new goal" form may offer ──────────────────────────────────────────────────────

export type GoalFormOptions = {
  levels: GoalLevel[];
  entities: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  people: { id: string; name: string }[];
  owners: { id: string; name: string }[];
};

export async function goalFormOptions(viewer: Viewer): Promise<GoalFormOptions> {
  const [directory, entities, departments, teams] = await Promise.all([
    loadDirectory(),
    db().select().from(schema.entity).where(eq(schema.entity.isActive, true)).orderBy(asc(schema.entity.code)),
    db().select().from(schema.department).where(eq(schema.department.isActive, true)).orderBy(asc(schema.department.name)),
    db().select().from(schema.team).where(eq(schema.team.isActive, true)).orderBy(asc(schema.team.name)),
  ]);
  const unit = (level: GoalLevel, ids: { entityId?: string | null; departmentId?: string | null; teamId?: string | null }): GoalParties => ({ level, entityId: ids.entityId ?? null, departmentId: ids.departmentId ?? null, teamId: ids.teamId ?? null, ownerPersonId: null, person: null });
  const entityChoices = [null, ...entities.map((entity) => entity.id)];
  const departmentOf = new Map(teams.map((team) => [team.id, team.departmentId]));
  const options: GoalFormOptions = {
    levels: [],
    entities: entities.filter((entity) => canEditGoal(viewer.principal, unit("entity", { entityId: entity.id }))).map((entity) => ({ id: entity.id, name: entity.shortName })),
    // A shared department's goal may be set for one entity: offer the department when any such pairing is the viewer's.
    departments: departments.filter((department) => (department.entityId ? [department.entityId] : entityChoices).some((entityId) => canEditGoal(viewer.principal, unit("department", { departmentId: department.id, entityId })))).map((department) => ({ id: department.id, name: department.name })),
    teams: teams.filter((team) => entityChoices.some((entityId) => canEditGoal(viewer.principal, unit("team", { teamId: team.id, departmentId: departmentOf.get(team.id), entityId })))).map((team) => ({ id: team.id, name: team.name })),
    people: [],
    owners: [...directory.values()].filter((person) => person.status === "active" || person.status === "preboarding").map((person) => ({ id: person.personId, name: person.fullName })),
  };
  const mine = new Set([viewer.personId, ...reportsBelow(directory, viewer.personId).map((person) => person.personId)]);
  options.people = [...directory.values()].filter((person) => person.status !== "offboarded" && (mine.has(person.personId) || canManagePerformanceOf(viewer.principal, person))).map((person) => ({ id: person.personId, name: person.fullName }));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "vi");
  options.people.sort(byName);
  options.owners.sort(byName);
  if (canEditGoal(viewer.principal, unit("group", {}))) options.levels.push("group");
  if (options.entities.length > 0) options.levels.push("entity");
  if (options.departments.length > 0) options.levels.push("department");
  if (options.teams.length > 0) options.levels.push("team");
  if (options.people.length > 0) options.levels.push("individual");
  return options;
}

// ── Use-cases ───────────────────────────────────────────────────────────────────────────────

export type GoalDraft = { level: GoalLevel; entityId: string | null; departmentId: string | null; teamId: string | null; personId: string | null; ownerPersonId: string | null; parentGoalId: string | null; title: string; description: string | null; periodKey: string; weight: number; activate: boolean };

/**
 * Where a new goal would sit, with everything the level implies filled in (a team's department, a
 * person's placement) and everything it does not need dropped. Null when a unit or person is missing.
 */
export async function resolveDraft(draft: GoalDraft, executor: Executor = db()): Promise<{ values: Pick<GoalRow, "level" | "entityId" | "departmentId" | "teamId" | "personId" | "ownerPersonId">; parties: GoalParties } | null> {
  const directory = await loadDirectory(executor);
  let values: Pick<GoalRow, "level" | "entityId" | "departmentId" | "teamId" | "personId"> | null = null;
  if (draft.level === "group") values = { level: "group", entityId: null, departmentId: null, teamId: null, personId: null };
  if (draft.level === "entity" && draft.entityId) {
    const [entity] = await executor.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, draft.entityId)).limit(1);
    if (entity) values = { level: "entity", entityId: entity.id, departmentId: null, teamId: null, personId: null };
  }
  if (draft.level === "department" && draft.departmentId) {
    const [department] = await executor.select().from(schema.department).where(eq(schema.department.id, draft.departmentId)).limit(1);
    // An entity's own department belongs to that entity; a shared one may be narrowed to one.
    if (department) values = { level: "department", entityId: department.entityId ?? draft.entityId, departmentId: department.id, teamId: null, personId: null };
  }
  if (draft.level === "team" && draft.teamId) {
    const [team] = await executor.select({ team: schema.team, departmentEntityId: schema.department.entityId }).from(schema.team).innerJoin(schema.department, eq(schema.department.id, schema.team.departmentId)).where(eq(schema.team.id, draft.teamId)).limit(1);
    if (team) values = { level: "team", entityId: team.departmentEntityId ?? draft.entityId, departmentId: team.team.departmentId, teamId: team.team.id, personId: null };
  }
  if (draft.level === "individual" && draft.personId) {
    const person = directory.get(draft.personId);
    if (person) values = { level: "individual", entityId: person.entityId ?? null, departmentId: person.departmentId ?? null, teamId: person.teamId ?? null, personId: person.personId };
  }
  if (!values) return null;
  if (values.entityId && values.level !== "individual" && values.level !== "entity") {
    const [entity] = await executor.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, values.entityId)).limit(1);
    if (!entity) return null;
  }
  const ownerPersonId = draft.ownerPersonId ?? values.personId;
  if (!ownerPersonId || !directory.has(ownerPersonId)) return null;
  const full = { ...values, ownerPersonId };
  return { values: full, parties: partiesOf(full, directory) };
}

/** A parent sits at the same level or higher, in the same year, in the same period or the whole year, is not cancelled — and is never a descendant. */
async function assertParent(tx: Tx, viewer: Viewer, child: { id: string | null; level: GoalLevel; periodKey: string }, parentGoalId: string): Promise<void> {
  const year = await loadYear(yearOfPeriod(child.periodKey), tx);
  const parent = year.goals.get(parentGoalId);
  // A parent from another year, or one the viewer may not see, does not exist as far as they are concerned.
  if (!parent || !canSeeGoal(viewer.principal, partiesOf(parent, await loadDirectory(tx)))) throw new ActionError("parent_not_found");
  if (parent.status === "cancelled") throw new ActionError("parent_cancelled");
  if (levelRank(parent.level as GoalLevel) > levelRank(child.level)) throw new ActionError("parent_below_child");
  if (!isAnnual(parent.periodKey) && parent.periodKey !== child.periodKey) throw new ActionError("parent_other_period");
  const seen = new Set<string>();
  for (let cursor: GoalRow | undefined = parent; cursor && !seen.has(cursor.id); cursor = cursor.parentGoalId ? year.goals.get(cursor.parentGoalId) : undefined) {
    if (cursor.id === child.id) throw new ActionError("parent_is_descendant");
    seen.add(cursor.id);
  }
}

export async function createGoal(viewer: Viewer, draft: GoalDraft): Promise<GoalRow> {
  if (!isPeriodKey(draft.periodKey)) throw new ActionError("bad_period");
  return db().transaction(async (tx) => {
    const resolved = await resolveDraft(draft, tx);
    if (!resolved) throw new ActionError("unit_not_found");
    if (draft.parentGoalId) await assertParent(tx, viewer, { id: null, level: draft.level, periodKey: draft.periodKey }, draft.parentGoalId);
    const [row] = await tx
      .insert(schema.goal)
      .values({ ...resolved.values, parentGoalId: draft.parentGoalId, title: draft.title, description: draft.description, year: yearOfPeriod(draft.periodKey), periodKey: draft.periodKey, status: draft.activate ? "active" : "draft", weight: draft.weight, createdByPersonId: viewer.personId })
      .returning();
    return row;
  });
}

const assertOpen = (goal: GoalRow) => {
  if (goal.status === "closed" || goal.status === "cancelled") throw new ActionError("goal_not_open");
};

export async function updateGoal(goalId: string, input: { title: string; description: string | null; periodKey: string; weight: number; ownerPersonId: string }): Promise<{ before: GoalRow; after: GoalRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.goal).where(eq(schema.goal.id, goalId)).for("update");
    if (!before) throw new ActionError("not_found");
    assertOpen(before);
    // The tree lives inside one year; a goal moves between that year's periods only, and not away from a quarterly parent or children.
    if (!isPeriodKey(input.periodKey) || yearOfPeriod(input.periodKey) !== before.year) throw new ActionError("bad_period");
    if (input.periodKey !== before.periodKey) {
      const [parent] = before.parentGoalId ? await tx.select().from(schema.goal).where(eq(schema.goal.id, before.parentGoalId)) : [];
      if (parent && !isAnnual(parent.periodKey) && parent.periodKey !== input.periodKey) throw new ActionError("parent_other_period");
      const children = await tx.select({ periodKey: schema.goal.periodKey }).from(schema.goal).where(eq(schema.goal.parentGoalId, goalId));
      if (!isAnnual(input.periodKey) && children.some((child) => child.periodKey !== input.periodKey)) throw new ActionError("children_other_period");
    }
    const [owner] = await tx.select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.id, input.ownerPersonId)).limit(1);
    if (!owner) throw new ActionError("owner_not_found");
    // An individual goal stays its person's: accountability does not move to someone else.
    const ownerPersonId = before.level === "individual" ? before.ownerPersonId : input.ownerPersonId;
    const [after] = await tx.update(schema.goal).set({ title: input.title, description: input.description, periodKey: input.periodKey, weight: input.weight, ownerPersonId, updatedAt: new Date() }).where(eq(schema.goal.id, goalId)).returning();
    return { before, after };
  });
}

export async function reparentGoal(viewer: Viewer, goalId: string, parentGoalId: string | null): Promise<{ before: GoalRow; after: GoalRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.goal).where(eq(schema.goal.id, goalId)).for("update");
    if (!before) throw new ActionError("not_found");
    assertOpen(before);
    if (parentGoalId) await assertParent(tx, viewer, { id: goalId, level: before.level as GoalLevel, periodKey: before.periodKey }, parentGoalId);
    const [after] = await tx.update(schema.goal).set({ parentGoalId, updatedAt: new Date() }).where(eq(schema.goal.id, goalId)).returning();
    return { before, after };
  });
}

export type StatusMove = "activate" | "close" | "cancel" | "reopen";

/** What a move takes, for the action's authorize step. Cancelling an active goal takes the right to close it: it drops out of every average. */
export function mayMove(principal: Principal, goal: GoalRow, parties: GoalParties, move: StatusMove): boolean {
  if (move === "activate") return canEditGoal(principal, parties);
  if (move === "close") return canCloseGoal(principal, parties);
  if (move === "cancel") return goal.status === "draft" ? canEditGoal(principal, parties) : canCloseGoal(principal, parties);
  return canReopenGoal(principal, parties);
}

export async function moveGoal(viewer: Viewer, goalId: string, move: StatusMove): Promise<{ before: GoalRow; after: GoalRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.goal).where(eq(schema.goal.id, goalId)).for("update");
    if (!before) throw new ActionError("not_found");
    const allowed: Record<StatusMove, GoalStatus[]> = { activate: ["draft"], close: ["active"], cancel: ["draft", "active"], reopen: ["closed", "cancelled"] };
    if (!allowed[move].includes(before.status as GoalStatus)) throw new ActionError("bad_transition");
    let values: Partial<GoalRow>;
    if (move === "close") {
      // The figure of this moment, from the same engine the screens use, becomes the record.
      const figure = goalProgress(goalId, (await loadYear(before.year, tx)).inputs).progressBp;
      if (figure === null) throw new ActionError("nothing_to_freeze");
      values = { status: "closed", finalProgressBp: figure, closedAt: new Date(), closedByPersonId: viewer.personId };
    } else if (move === "reopen") values = { status: "active", finalProgressBp: null, closedAt: null, closedByPersonId: null };
    else values = { status: move === "activate" ? "active" : "cancelled" };
    const [after] = await tx.update(schema.goal).set({ ...values, updatedAt: new Date() }).where(eq(schema.goal.id, goalId)).returning();
    return { before, after };
  });
}

export type KeyResultInput = { title: string; metricType: MetricType; startValue: string | null; targetValue: string | null; milestones: string[]; weight: number };

export async function saveKeyResult(goalId: string, keyResultId: string | null, input: KeyResultInput): Promise<{ before: KeyResultRow | null; after: KeyResultRow }> {
  return db().transaction(async (tx) => {
    const [goal] = await tx.select().from(schema.goal).where(eq(schema.goal.id, goalId)).for("update");
    if (!goal) throw new ActionError("not_found");
    assertOpen(goal);
    const [before] = keyResultId ? await tx.select().from(schema.keyResult).where(and(eq(schema.keyResult.id, keyResultId), eq(schema.keyResult.goalId, goalId))) : [];
    if (keyResultId && !before) throw new ActionError("not_found");
    const [{ checkIns }] = before ? await tx.select({ checkIns: count() }).from(schema.goalCheckIn).where(eq(schema.goalCheckIn.keyResultId, before.id)) : [{ checkIns: 0 }];
    // Its history was recorded in one unit; that cannot be reinterpreted afterwards.
    if (before && checkIns > 0 && before.metricType !== input.metricType) throw new ActionError("metric_type_fixed");

    let values: Pick<KeyResultRow, "startValue" | "targetValue" | "currentValue" | "milestones">;
    if (input.metricType === "milestone") {
      if (input.milestones.length === 0) throw new ActionError("milestones_required");
      const done = new Map((before?.milestones ?? []).map((milestone) => [milestone.title, milestone.done]));
      const milestones: Milestone[] = input.milestones.map((title) => ({ title, done: done.get(title) ?? false }));
      values = { startValue: 0, targetValue: milestones.length, currentValue: milestones.filter((milestone) => milestone.done).length, milestones };
    } else {
      const startValue = parseMetricValue(input.metricType, input.startValue ?? "0");
      const targetValue = parseMetricValue(input.metricType, input.targetValue ?? "");
      if (startValue === null) throw new ActionError("bad_start_value");
      if (targetValue === null) throw new ActionError("bad_target_value");
      // Until someone checks in, the key result stands at its start.
      values = { startValue, targetValue, currentValue: before && checkIns > 0 ? before.currentValue : startValue, milestones: null };
    }
    if (before) {
      const [after] = await tx.update(schema.keyResult).set({ title: input.title, metricType: input.metricType, weight: input.weight, ...values, updatedAt: new Date() }).where(eq(schema.keyResult.id, before.id)).returning();
      return { before, after };
    }
    const [{ total }] = await tx.select({ total: count() }).from(schema.keyResult).where(eq(schema.keyResult.goalId, goalId));
    const [after] = await tx.insert(schema.keyResult).values({ goalId, title: input.title, metricType: input.metricType, weight: input.weight, sortOrder: total, ...values }).returning();
    return { before: null, after };
  });
}

/** Only a key result nobody has checked in on can go: with a history it stays, for the trace (edit it instead). */
export async function removeKeyResult(keyResultId: string): Promise<KeyResultRow> {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.keyResult).where(eq(schema.keyResult.id, keyResultId)).for("update");
    if (!row) throw new ActionError("not_found");
    const [goal] = await tx.select().from(schema.goal).where(eq(schema.goal.id, row.goalId));
    assertOpen(goal);
    const [{ checkIns }] = await tx.select({ checkIns: count() }).from(schema.goalCheckIn).where(eq(schema.goalCheckIn.keyResultId, keyResultId));
    if (checkIns > 0) throw new ActionError("key_result_has_check_ins");
    await tx.delete(schema.keyResult).where(eq(schema.keyResult.id, keyResultId));
    return row;
  });
}

export type CheckInInput = { value: string | null; doneMilestones: number[]; confidence: Confidence; note: string | null };

/** The weekly check-in: one appended row, which also becomes the key result's current value and confidence. */
export async function createCheckIn(viewer: Viewer, keyResultId: string, input: CheckInInput, now: Date = new Date()): Promise<{ checkIn: CheckInRow; before: KeyResultRow; after: KeyResultRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.keyResult).where(eq(schema.keyResult.id, keyResultId)).for("update");
    if (!before) throw new ActionError("not_found");
    const [goal] = await tx.select().from(schema.goal).where(eq(schema.goal.id, before.goalId));
    if (goal.status !== "active") throw new ActionError("goal_not_active");
    let value: number | null = null;
    let milestones: Milestone[] | null = null;
    if (before.metricType === "milestone") {
      milestones = (before.milestones ?? []).map((milestone, index) => ({ title: milestone.title, done: input.doneMilestones.includes(index) }));
      value = milestones.filter((milestone) => milestone.done).length;
    } else {
      value = parseMetricValue(before.metricType as MetricType, input.value ?? "");
      if (value === null) throw new ActionError("bad_value");
    }
    const [checkIn] = await tx
      .insert(schema.goalCheckIn)
      .values({ keyResultId, goalId: before.goalId, weekStart: weekStartOf(todayInVietnam(now)), value, milestones, confidence: input.confidence, note: input.note, authorPersonId: viewer.personId, createdAt: now })
      .returning();
    const [after] = await tx.update(schema.keyResult).set({ currentValue: value, milestones, confidence: input.confidence, lastCheckInAt: now, updatedAt: now }).where(eq(schema.keyResult.id, keyResultId)).returning();
    return { checkIn, before, after };
  });
}

// ── For Phase 8 (review cycle, final result, bonus) ──────────────────────────────────────────

export type OkrGoalResult = { goalId: string; title: string; periodKey: string; status: GoalStatus; progressBp: number | null; /** Frozen at close: cannot move any more. */ final: boolean };
export type OkrFigure = { progressBp: number | null; goals: OkrGoalResult[] };
export type OkrResults = { individual: OkrFigure; units: { team: OkrFigure; department: OkrFigure; entity: OkrFigure; group: OkrFigure } };

/**
 * OKR attainment of one person for a year (FR-PRF-09 reads this): their own goals, and those of
 * the team, department, entity and group they belong to today. Each figure is the weighted average
 * of the top-most active or closed goals of that owner — a goal nested under another goal of the
 * same owner is already inside its parent (or deliberately beside it) and is listed, not averaged
 * twice. No authorization here: the caller decides who sees the result.
 */
export async function getOkrResults(input: { personId: string; year: number }, executor: Executor = db()): Promise<OkrResults> {
  const [year, directory] = await Promise.all([loadYear(input.year, executor), loadDirectory(executor)]);
  const person = directory.get(input.personId);
  const counted = [...year.goals.values()].filter((goal) => goal.status === "active" || goal.status === "closed");
  const figure = (goals: GoalRow[]): OkrFigure => {
    const ids = new Set(goals.map((goal) => goal.id));
    const results = goals.map((goal) => ({ goal, progressBp: goalProgress(goal.id, year.inputs).progressBp }));
    const top = results.filter(({ goal }) => !goal.parentGoalId || !ids.has(goal.parentGoalId));
    return {
      progressBp: weightedAverageBp(top.map(({ goal, progressBp }) => ({ weight: goal.weight, progressBp }))),
      goals: results.map(({ goal, progressBp }) => ({ goalId: goal.id, title: goal.title, periodKey: goal.periodKey, status: goal.status as GoalStatus, progressBp, final: goal.status === "closed" && goal.finalProgressBp !== null })),
    };
  };
  const ofEntity = (goal: GoalRow) => !goal.entityId || goal.entityId === person?.entityId;
  return {
    individual: figure(counted.filter((goal) => goal.level === "individual" && goal.personId === input.personId)),
    units: {
      team: figure(person?.teamId ? counted.filter((goal) => goal.level === "team" && goal.teamId === person.teamId) : []),
      department: figure(person?.departmentId ? counted.filter((goal) => goal.level === "department" && goal.departmentId === person.departmentId && ofEntity(goal)) : []),
      entity: figure(person?.entityId ? counted.filter((goal) => goal.level === "entity" && goal.entityId === person.entityId) : []),
      group: figure(counted.filter((goal) => goal.level === "group")),
    },
  };
}
