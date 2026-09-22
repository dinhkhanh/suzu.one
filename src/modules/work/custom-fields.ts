// Custom fields (FR-PJM-35): a team's extra fields (aspect ratio, platform, ad account…), and a
// project's own. The definitions are small reference data read by every list, so the whole table
// sits in the shared cache; the values live on `work_task.custom_values` and every change to one is
// written to the task's activity, display-ready, like any other field.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { applicableFields, checkCustomValue, currentValue, type CustomFieldDef, type CustomFieldType, displayCustomValue, fieldDefinitionProblem, type FieldView, MAX_CUSTOM_FIELDS } from "./engine/custom-fields";
import type { CustomFieldOption, CustomFieldValue } from "./schema";
import type { ActivityEntry } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
export type CustomFieldRow = typeof schema.workCustomField.$inferSelect;

const FIELDS_KEY = "work:custom-fields";
const FIELDS_TTL = 30 * 60;

export const toFieldViews = (rows: readonly CustomFieldRow[]): FieldView[] => rows.map((row) => ({ id: row.id, name: row.name, type: row.type as CustomFieldType, options: row.options, showOnCard: row.showOnCard, projectId: row.projectId, isActive: row.isActive, sortOrder: row.sortOrder }));

export const asFieldDef = (row: CustomFieldRow): CustomFieldDef => ({ id: row.id, name: row.name, type: row.type as CustomFieldType, options: row.options, teamId: row.teamId, projectId: row.projectId, isActive: row.isActive });

async function allFields(executor?: Executor): Promise<CustomFieldRow[]> {
  const load = (from: Executor) => from.select().from(schema.workCustomField).orderBy(schema.workCustomField.sortOrder, schema.workCustomField.name, schema.workCustomField.id);
  // Inside a transaction the rows come from there, not the cache.
  return executor ? load(executor) : cached(FIELDS_KEY, FIELDS_TTL, () => load(db()));
}

/**
 * The fields of a team's lists: the team's own and, for a project list, that project's too.
 * `withProjects` returns every project's fields of the team (the team page's table spans them).
 */
export async function listCustomFields(scope: { teamId: string; projectId?: string | null; withProjects?: boolean }, options: { includeInactive?: boolean; executor?: Executor } = {}): Promise<CustomFieldRow[]> {
  const rows = await allFields(options.executor);
  return rows.filter((row) => row.teamId === scope.teamId && (options.includeInactive || row.isActive) && (row.projectId === null || scope.withProjects || row.projectId === scope.projectId));
}

export async function findCustomField(fieldId: string): Promise<CustomFieldRow | undefined> {
  const [row] = await db().select().from(schema.workCustomField).where(eq(schema.workCustomField.id, fieldId)).limit(1);
  return row;
}

export type CustomFieldInput = { name: string; type: CustomFieldType; options: { id?: string | null; label: string; color?: string | null }[]; showOnCard: boolean; sortOrder: number; isActive: boolean };

const newOptionId = () => Math.random().toString(36).slice(2, 10);

/**
 * A new field, or a change to one. The type stays what it was — values of the old type would no
 * longer read. Removing an option clears it from every task that had it, each change in that
 * task's activity, so a filter never counts a choice nobody can see.
 */
export async function saveCustomField(scope: { teamId: string; projectId: string | null }, fieldId: string | null, input: CustomFieldInput, actorPersonId: string): Promise<{ before: CustomFieldRow | null; after: CustomFieldRow; cleared: number }> {
  const options: CustomFieldOption[] = input.type === "select" || input.type === "multi_select" ? input.options.filter((option) => option.label.trim()).map((option) => ({ id: option.id || newOptionId(), label: option.label.trim(), ...(option.color ? { color: option.color } : {}) })) : [];
  const problem = fieldDefinitionProblem({ name: input.name, type: input.type, options });
  if (problem) throw new ActionError(problem);
  const values = { name: input.name.trim(), options, showOnCard: input.showOnCard, sortOrder: input.sortOrder, isActive: input.isActive };

  const saved = await db().transaction(async (tx) => {
    if (scope.projectId) {
      const [project] = await tx.select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, scope.projectId)).limit(1);
      if (!project || project.teamId !== scope.teamId) throw new ActionError("project_not_found");
    }
    if (!fieldId) {
      const [{ value }] = await tx.select({ value: sql<number>`count(*)::int` }).from(schema.workCustomField).where(and(eq(schema.workCustomField.teamId, scope.teamId), scope.projectId ? eq(schema.workCustomField.projectId, scope.projectId) : isNull(schema.workCustomField.projectId)));
      if (value >= MAX_CUSTOM_FIELDS) throw new ActionError("custom_field_limit");
      const [after] = await tx.insert(schema.workCustomField).values({ teamId: scope.teamId, projectId: scope.projectId, type: input.type, ...values, createdByPersonId: actorPersonId }).returning();
      return { before: null, after, cleared: 0 };
    }
    const [before] = await tx.select().from(schema.workCustomField).where(eq(schema.workCustomField.id, fieldId)).limit(1);
    if (!before || before.teamId !== scope.teamId || before.projectId !== scope.projectId) throw new ActionError("custom_field_not_found");
    if (before.type !== input.type) throw new ActionError("custom_field_type_locked");
    const [after] = await tx.update(schema.workCustomField).set({ ...values, updatedAt: new Date() }).where(eq(schema.workCustomField.id, fieldId)).returning();

    const removed = before.options.filter((option) => !options.some((kept) => kept.id === option.id));
    let cleared = 0;
    if (removed.length > 0) {
      const holders = await tx
        .select({ taskId: schema.workTask.taskId, customValues: schema.workTask.customValues })
        .from(schema.workTask)
        .where(and(eq(schema.workTask.teamId, scope.teamId), sql`${schema.workTask.customValues} ? ${fieldId}`));
      const beforeDef = asFieldDef(before);
      const afterDef = asFieldDef(after);
      for (const holder of holders) {
        const old = holder.customValues[fieldId];
        const next = currentValue(afterDef, old);
        if (JSON.stringify(next) === JSON.stringify(currentValue(beforeDef, old))) continue;
        const nextValues = { ...holder.customValues };
        if (next === null) delete nextValues[fieldId];
        else nextValues[fieldId] = next;
        await tx.update(schema.workTask).set({ customValues: nextValues }).where(eq(schema.workTask.taskId, holder.taskId));
        await tx.insert(schema.workActivity).values({ taskId: holder.taskId, actorPersonId, type: "custom_field_changed", field: fieldId, fromValue: { name: before.name, value: displayCustomValue(beforeDef, old) }, toValue: { name: after.name, value: displayCustomValue(afterDef, next) } });
        cleared += 1;
      }
    }
    return { before, after, cleared };
  });
  await invalidate(FIELDS_KEY);
  return saved;
}

/**
 * What a patch of custom values does to a task: the values to store and the activity entries.
 * Only the task's own fields may be set (its team's, and its project's); a person must still be
 * with the company. Unchanged values write nothing.
 */
export async function customValueChanges(tx: Executor, task: { teamId: string; projectId: string | null; customValues: Record<string, CustomFieldValue> }, patch: Record<string, unknown>): Promise<{ values: Record<string, CustomFieldValue>; changes: ActivityEntry[] }> {
  const fields = applicableFields((await allFields(tx)).map(asFieldDef), task);
  const values = { ...task.customValues };
  const changes: ActivityEntry[] = [];
  const pending: { field: CustomFieldDef; from: CustomFieldValue; to: CustomFieldValue }[] = [];
  for (const [fieldId, raw] of Object.entries(patch)) {
    const field = fields.find((row) => row.id === fieldId);
    if (!field) throw new ActionError("custom_field_not_found");
    const checked = checkCustomValue(field, raw);
    if (!checked.ok) throw new ActionError("custom_value_invalid", { fieldId, problem: checked.problem });
    const from = currentValue(field, values[fieldId]);
    if (JSON.stringify(from) === JSON.stringify(checked.value)) continue;
    pending.push({ field, from, to: checked.value });
    if (checked.value === null) delete values[fieldId];
    else values[fieldId] = checked.value;
  }
  // People are named in the log as they were, so a later name change does not rewrite history.
  const personIds = pending.flatMap((row) => (row.field.type === "person" ? [row.from, row.to] : [])).filter((id): id is string => typeof id === "string");
  const people = personIds.length ? await tx.select({ id: schema.person.id, name: schema.person.fullName, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, personIds)) : [];
  for (const row of pending) {
    if (row.field.type === "person" && typeof row.to === "string" && !people.some((person) => person.id === row.to && person.status !== "offboarded")) throw new ActionError("person_not_found");
    const names = new Map(people.map((person) => [person.id, person.name]));
    changes.push({ type: "custom_field_changed", field: row.field.id, from: { name: row.field.name, value: displayCustomValue(row.field, row.from, names) }, to: { name: row.field.name, value: displayCustomValue(row.field, row.to, names) } });
  }
  return { values, changes };
}
