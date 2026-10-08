// The checklist library (work_checklist): any department's reusable tick-lists — "before hand-off",
// "brief received", "before publishing" — and where they hook in. Reading is checklist-library.ts;
// here are the writers, each dropping every cache its change touches once it has committed.
//
// Hook points: a workflow stage (work_state_checklist — entering adds the checklist to the task,
// `required` holds the task until it is ticked), a hand-off package, an intake form and a template
// step (their `checklist_ids`), and a task by hand (`addChecklistIds` on a task update, tasks.ts).
import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { listOrgUnits } from "../platform/org/service";
import { assertUsable, type ChecklistRow, findChecklist, invalidateChecklists, invalidateStateChecklists } from "./checklist-library";
import { type ChecklistItemInput, checklistProblem, newChecklistItemId, normalizeItems } from "./engine/checklists";
import { invalidateHandoffPackages } from "./handoff-gate";
import { invalidateIntakeForms } from "./intake";
import type { ChecklistOwner } from "./policy";
import { invalidateWorkTemplates } from "./templates";
import { listTeams, teamFacts } from "./teams";

export type { ChecklistRow } from "./checklist-library";

// ── Owners ──────────────────────────────────────────────────────────────────────────────────

type Owned = Pick<ChecklistRow, "ownerUnitId" | "ownerTeamId">;

/** Who owns each checklist, in the shape the policy asks about — from the cached unit tree and team list. */
export async function checklistOwners<Row extends Owned>(rows: readonly Row[]): Promise<Map<Row, ChecklistOwner>> {
  const [units, teams] = await Promise.all([rows.some((row) => row.ownerUnitId) ? listOrgUnits() : [], rows.some((row) => row.ownerTeamId) ? listTeams() : []]);
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return new Map(
    rows.map((row) => {
      const unit = row.ownerUnitId ? unitById.get(row.ownerUnitId) : undefined;
      const team = row.ownerTeamId ? teamById.get(row.ownerTeamId) : undefined;
      // A team that has gone missing leaves the checklist to be kept at group level, as a
      // company-wide one — never open to whoever asks.
      const owner: ChecklistOwner = { unit: row.ownerUnitId ? { id: row.ownerUnitId, entityId: unit?.entityId ?? null, path: unit?.path ?? [row.ownerUnitId] } : null, team: team ? teamFacts(team) : null };
      return [row, owner];
    }),
  );
}

export const checklistOwner = async (row: Owned): Promise<ChecklistOwner> => (await checklistOwners([row])).get(row)!;

// ── Keeping the library ─────────────────────────────────────────────────────────────────────

export type ChecklistInput = { name: string; description: string | null; ownerUnitId: string | null; ownerTeamId: string | null; items: ChecklistItemInput[]; isActive: boolean };

export async function saveChecklist(checklistId: string | null, input: ChecklistInput, actorPersonId: string): Promise<{ before: ChecklistRow | null; after: ChecklistRow }> {
  if (input.ownerUnitId && input.ownerTeamId) throw new ActionError("checklist_owner_invalid");
  const before = checklistId ? await findChecklist(checklistId) : null;
  if (checklistId && !before) throw new ActionError("checklist_not_found");
  // Items keep their ids across edits: a hand-off sheet open while the checklist changes still matches its boxes.
  const known = new Set((before?.items ?? []).map((item) => item.id));
  const items = normalizeItems(
    input.items.map((item) => ({ ...item, id: item.id && known.has(item.id) ? item.id : null })),
    newChecklistItemId,
  );
  const values = { name: input.name.trim(), description: input.description?.trim() || null, ownerUnitId: input.ownerUnitId, ownerTeamId: input.ownerTeamId, items, isActive: input.isActive };
  const problem = checklistProblem(values);
  if (problem) throw new ActionError(problem);
  if (input.ownerUnitId && !(await listOrgUnits()).some((unit) => unit.id === input.ownerUnitId && unit.isActive)) throw new ActionError("checklist_owner_invalid");
  if (input.ownerTeamId && !(await listTeams()).some((team) => team.id === input.ownerTeamId && team.isActive)) throw new ActionError("checklist_owner_invalid");

  const after = before
    ? (
        await db()
          .update(schema.workChecklist)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.workChecklist.id, before.id))
          .returning()
      )[0]
    : (
        await db()
          .insert(schema.workChecklist)
          .values({ ...values, createdByPersonId: actorPersonId })
          .returning()
      )[0];
  await invalidateChecklists();
  return { before: before ?? null, after };
}

/**
 * Gone from the library and from every place that named it — stages, packages, forms, template
 * steps. Boxes already copied onto tasks stay: they are the task's own.
 */
export async function deleteChecklist(checklistId: string): Promise<ChecklistRow> {
  const removed = await db().transaction(async (tx) => {
    const named = sql`${checklistId}::uuid = ANY(checklist_ids)`;
    const drop = sql`array_remove(checklist_ids, ${checklistId}::uuid)`;
    await tx.update(schema.workHandoffPackage).set({ checklistIds: drop }).where(named);
    await tx.update(schema.workIntakeForm).set({ checklistIds: drop }).where(named);
    await tx.update(schema.taskTemplateItem).set({ checklistIds: drop }).where(named);
    // Its stage hooks go with it (ON DELETE CASCADE).
    const [row] = await tx.delete(schema.workChecklist).where(eq(schema.workChecklist.id, checklistId)).returning();
    if (!row) throw new ActionError("checklist_not_found");
    return row;
  });
  await Promise.all([invalidateChecklists(), invalidateStateChecklists(), invalidateHandoffPackages(), invalidateIntakeForms(), invalidateWorkTemplates()]);
  return removed;
}

/**
 * Where a checklist is used — for its card on the library page: how many stages, packages, intake
 * forms and template steps name it, per checklist, counted in SQL.
 */
export async function checklistUsage(): Promise<Map<string, { stages: number; packages: number; forms: number; steps: number }>> {
  const id = schema.workChecklist.id;
  // Qualified by hand: inside a subquery a bare "id" would be the inner table's own.
  const outer = sql.raw(`"work_checklist"."id"`);
  const rows = await db()
    .select({
      id,
      stages: sql<number>`(select count(*)::int from ${schema.workStateChecklist} where ${schema.workStateChecklist.checklistId} = ${outer})`,
      packages: sql<number>`(select count(*)::int from ${schema.workHandoffPackage} where ${outer} = any(${schema.workHandoffPackage.checklistIds}))`,
      forms: sql<number>`(select count(*)::int from ${schema.workIntakeForm} where ${outer} = any(${schema.workIntakeForm.checklistIds}))`,
      steps: sql<number>`(select count(*)::int from ${schema.taskTemplateItem} where ${outer} = any(${schema.taskTemplateItem.checklistIds}))`,
    })
    .from(schema.workChecklist);
  return new Map(rows.map(({ id: checklistId, ...usage }) => [checklistId, usage]));
}

// ── Stage hooks ─────────────────────────────────────────────────────────────────────────────

export type StageHook = { checklistId: string; required: boolean };

/** The checklists hooked to one stage, replaced as a whole. Each must be an active checklist of the library. */
export async function setStateChecklists(stateId: string, hooks: readonly StageHook[]): Promise<{ before: StageHook[]; after: StageHook[] }> {
  const wanted = [...new Map(hooks.map((hook) => [hook.checklistId, hook])).values()];
  const before = await db().transaction(async (tx) => {
    const stored = await tx.select({ checklistId: schema.workStateChecklist.checklistId, required: schema.workStateChecklist.required }).from(schema.workStateChecklist).where(eq(schema.workStateChecklist.stateId, stateId));
    await assertUsable(
      wanted.map((hook) => hook.checklistId),
      stored.map((hook) => hook.checklistId),
      tx,
    );
    const keep = wanted.map((hook) => hook.checklistId);
    await tx.delete(schema.workStateChecklist).where(and(eq(schema.workStateChecklist.stateId, stateId), keep.length ? notInArray(schema.workStateChecklist.checklistId, keep) : undefined));
    if (wanted.length) {
      await tx
        .insert(schema.workStateChecklist)
        .values(wanted.map((hook) => ({ stateId, checklistId: hook.checklistId, required: hook.required })))
        .onConflictDoUpdate({ target: [schema.workStateChecklist.stateId, schema.workStateChecklist.checklistId], set: { required: sql`excluded.required` } });
    }
    return stored;
  });
  await invalidateStateChecklists();
  return { before, after: wanted };
}
