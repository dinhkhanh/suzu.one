// Teams with their members and workflow, labels, and the client / brand list.
import "server-only";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { isOpenCategory, type StateCategory, type TeamRole, type Visibility, WORKFLOW_PRESETS, type WorkflowPreset } from "./enums";
import type { TeamFacts } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type TeamRow = typeof schema.workTeam.$inferSelect;
export type StateRow = typeof schema.workState.$inferSelect;
export type LabelRow = typeof schema.workLabel.$inferSelect;
export type ClientRow = typeof schema.workClient.$inferSelect;

export const teamFacts = (team: Pick<TeamRow, "id" | "entityId" | "departmentId" | "defaultVisibility">): TeamFacts => ({ id: team.id, entityId: team.entityId, departmentId: team.departmentId, defaultVisibility: team.defaultVisibility as Visibility });

// ── Teams ───────────────────────────────────────────────────────────────────────────────────

export async function findTeam(teamId: string, executor: Executor = db()): Promise<TeamRow | undefined> {
  const [row] = await executor.select().from(schema.workTeam).where(eq(schema.workTeam.id, teamId)).limit(1);
  return row;
}

export type TeamSummary = TeamRow & { memberCount: number; entityName: string | null };

export async function listTeams(): Promise<TeamSummary[]> {
  const rows = await db()
    .select({ team: schema.workTeam, entityName: schema.entity.shortName, memberCount: sql<number>`(select count(*)::int from ${schema.workTeamMember} where ${schema.workTeamMember.teamId} = ${schema.workTeam.id})` })
    .from(schema.workTeam)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.workTeam.entityId))
    .orderBy(asc(schema.workTeam.name));
  return rows.map(({ team, ...rest }) => ({ ...team, ...rest }));
}

export type TeamInput = { key: string; name: string; description: string | null; entityId: string | null; departmentId: string | null; defaultVisibility: Visibility; isActive: boolean };

/** A new team starts with a workflow preset and its creator as lead. */
export async function createTeam(input: TeamInput, preset: WorkflowPreset, stateNames: Record<string, string>, actorPersonId: string): Promise<TeamRow> {
  return db().transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.workTeam.id }).from(schema.workTeam).where(eq(schema.workTeam.key, input.key)).limit(1);
    if (taken) throw new ActionError("team_key_taken");
    const [team] = await tx.insert(schema.workTeam).values(input).returning();
    await tx.insert(schema.workState).values(WORKFLOW_PRESETS[preset].map((state, index) => ({ teamId: team.id, name: stateNames[state.key] ?? state.key, category: state.category, sortOrder: (index + 1) * 10 })));
    await tx.insert(schema.workTeamMember).values({ teamId: team.id, personId: actorPersonId, role: "lead" });
    return team;
  });
}

/** The key stays: task numbers ("VID-12") are quoted in chats and briefs. */
export async function updateTeam(teamId: string, input: Omit<TeamInput, "key">): Promise<{ before: TeamRow; after: TeamRow }> {
  const before = await findTeam(teamId);
  if (!before) throw new ActionError("team_not_found");
  const [after] = await db().update(schema.workTeam).set({ ...input, updatedAt: new Date() }).where(eq(schema.workTeam.id, teamId)).returning();
  return { before, after };
}

export type MemberView = { personId: string; fullName: string; role: TeamRole; workforceType: string; status: string };

export async function listTeamMembers(teamId: string, executor: Executor = db()): Promise<MemberView[]> {
  const rows = await executor
    .select({ personId: schema.person.id, fullName: schema.person.fullName, role: schema.workTeamMember.role, workforceType: schema.person.workforceType, status: schema.person.status, searchName: schema.person.searchName })
    .from(schema.workTeamMember)
    .innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId))
    .where(eq(schema.workTeamMember.teamId, teamId))
    .orderBy(asc(schema.workTeamMember.role), asc(schema.person.searchName));
  return rows.map(({ searchName: _searchName, ...row }) => ({ ...row, role: row.role as TeamRole }));
}

async function activePerson(tx: Executor, personId: string): Promise<void> {
  const [row] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || row.status === "offboarded") throw new ActionError("person_not_found");
}

/** `role` null removes the person. A team keeps at least one lead. */
export async function setTeamMember(teamId: string, personId: string, role: TeamRole | null): Promise<{ before: TeamRole | null; after: TeamRole | null }> {
  return db().transaction(async (tx) => {
    const members = await tx.select().from(schema.workTeamMember).where(eq(schema.workTeamMember.teamId, teamId));
    const current = members.find((member) => member.personId === personId);
    const before = (current?.role as TeamRole | undefined) ?? null;
    const otherLeads = members.filter((member) => member.role === "lead" && member.personId !== personId).length;
    if (before === "lead" && role !== "lead" && otherLeads === 0) throw new ActionError("team_last_lead");
    if (role === null) {
      if (current) await tx.delete(schema.workTeamMember).where(eq(schema.workTeamMember.id, current.id));
    } else if (current) {
      await tx.update(schema.workTeamMember).set({ role }).where(eq(schema.workTeamMember.id, current.id));
    } else {
      await activePerson(tx, personId);
      await tx.insert(schema.workTeamMember).values({ teamId, personId, role });
    }
    return { before, after: role };
  });
}

// ── Workflow states ─────────────────────────────────────────────────────────────────────────

export async function listStates(teamIds: readonly string[], executor: Executor = db()): Promise<StateRow[]> {
  if (teamIds.length === 0) return [];
  return executor.select().from(schema.workState).where(inArray(schema.workState.teamId, [...teamIds])).orderBy(asc(schema.workState.sortOrder), asc(schema.workState.createdAt));
}

export async function findState(stateId: string, executor: Executor = db()): Promise<StateRow | undefined> {
  const [row] = await executor.select().from(schema.workState).where(eq(schema.workState.id, stateId)).limit(1);
  return row;
}

export type StateInput = { name: string; category: StateCategory; sortOrder: number; isActive: boolean };

export async function saveState(teamId: string, stateId: string | null, input: StateInput): Promise<{ before: StateRow | null; after: StateRow }> {
  return db().transaction(async (tx) => {
    if (!stateId) {
      const [after] = await tx.insert(schema.workState).values({ teamId, ...input }).returning();
      return { before: null, after };
    }
    const before = await findState(stateId, tx);
    if (!before || before.teamId !== teamId) throw new ActionError("state_not_found");
    if (before.isActive && !input.isActive) {
      // Tasks must never sit in a state nobody can see on the board.
      const [used] = await tx.select({ value: count() }).from(schema.workTask).innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId)).where(and(eq(schema.workTask.stateId, stateId), isNull(schema.task.deletedAt)));
      if ((used?.value ?? 0) > 0) throw new ActionError("state_in_use");
    }
    if (before.category !== input.category) {
      // The generic status follows the category, so "my open tasks" stays right for every kind.
      const [used] = await tx.select({ value: count() }).from(schema.workTask).where(eq(schema.workTask.stateId, stateId));
      if ((used?.value ?? 0) > 0 && isOpenCategory(before.category as StateCategory) !== isOpenCategory(input.category)) throw new ActionError("state_category_in_use");
    }
    const [after] = await tx.update(schema.workState).set({ ...input, updatedAt: new Date() }).where(eq(schema.workState.id, stateId)).returning();
    const stillOpen = await tx.select({ value: count() }).from(schema.workState).where(and(eq(schema.workState.teamId, teamId), eq(schema.workState.isActive, true), inArray(schema.workState.category, ["backlog", "todo"])));
    const stillDone = await tx.select({ value: count() }).from(schema.workState).where(and(eq(schema.workState.teamId, teamId), eq(schema.workState.isActive, true), eq(schema.workState.category, "done")));
    if ((stillOpen[0]?.value ?? 0) === 0 || (stillDone[0]?.value ?? 0) === 0) throw new ActionError("workflow_needs_start_and_done");
    return { before, after };
  });
}

/** Where a new task lands: the first active "to do" state, else the first backlog state. */
export function entryState(states: readonly StateRow[], preferBacklog = false): StateRow | undefined {
  const active = states.filter((state) => state.isActive);
  const order: StateCategory[] = preferBacklog ? ["backlog", "todo"] : ["todo", "backlog"];
  for (const category of order) {
    const found = active.find((state) => state.category === category);
    if (found) return found;
  }
  return active[0];
}

// ── Labels ──────────────────────────────────────────────────────────────────────────────────

/** A team's own labels and the shared ones. */
export async function listLabels(teamIds: readonly string[], executor: Executor = db()): Promise<LabelRow[]> {
  return executor.select().from(schema.workLabel).where(teamIds.length ? or(isNull(schema.workLabel.teamId), inArray(schema.workLabel.teamId, [...teamIds])) : isNull(schema.workLabel.teamId)).orderBy(asc(schema.workLabel.name));
}

export async function findLabel(labelId: string): Promise<LabelRow | undefined> {
  const [row] = await db().select().from(schema.workLabel).where(eq(schema.workLabel.id, labelId)).limit(1);
  return row;
}

export async function saveLabel(labelId: string | null, input: { teamId: string | null; name: string; color: string }): Promise<{ before: LabelRow | null; after: LabelRow }> {
  if (!labelId) {
    const [after] = await db().insert(schema.workLabel).values(input).returning();
    return { before: null, after };
  }
  const before = await findLabel(labelId);
  if (!before) throw new ActionError("label_not_found");
  const [after] = await db().update(schema.workLabel).set({ name: input.name, color: input.color }).where(eq(schema.workLabel.id, labelId)).returning();
  return { before, after };
}

export async function deleteLabel(labelId: string): Promise<LabelRow> {
  const [row] = await db().delete(schema.workLabel).where(eq(schema.workLabel.id, labelId)).returning();
  if (!row) throw new ActionError("label_not_found");
  return row;
}

// ── Clients and brands ──────────────────────────────────────────────────────────────────────

export type ClientView = ClientRow & { parentName: string | null; openTasks: number };

export async function listClients(options: { activeOnly?: boolean } = {}): Promise<ClientRow[]> {
  return db().select().from(schema.workClient).where(options.activeOnly ? eq(schema.workClient.isActive, true) : undefined).orderBy(asc(schema.workClient.name));
}

export async function findClient(clientId: string, executor: Executor = db()): Promise<ClientRow | undefined> {
  const [row] = await executor.select().from(schema.workClient).where(eq(schema.workClient.id, clientId)).limit(1);
  return row;
}

export type ClientInput = { code: string; name: string; kind: "client" | "brand"; parentId: string | null; entityId: string | null; note: string | null; isActive: boolean };

export async function saveClient(clientId: string | null, input: ClientInput): Promise<{ before: ClientRow | null; after: ClientRow }> {
  return db().transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.workClient.id }).from(schema.workClient).where(eq(schema.workClient.code, input.code)).limit(1);
    if (taken && taken.id !== clientId) throw new ActionError("client_code_taken");
    if (input.parentId) {
      const parent = await findClient(input.parentId, tx);
      // Two levels only: a client and its brands.
      if (!parent || parent.id === clientId || parent.parentId) throw new ActionError("client_parent_invalid");
    }
    if (!clientId) {
      const [after] = await tx.insert(schema.workClient).values(input).returning();
      return { before: null, after };
    }
    const before = await findClient(clientId, tx);
    if (!before) throw new ActionError("client_not_found");
    const [after] = await tx.update(schema.workClient).set({ ...input, updatedAt: new Date() }).where(eq(schema.workClient.id, clientId)).returning();
    return { before, after };
  });
}
