// Task and project templates (FR-WRK-10) on the task engine's template tables: a tree of steps
// with days from an anchor date and a role per step. Using one asks who plays each role, then
// makes the whole tree as work tasks — in a new project, or inside an existing one.
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getDaysOff } from "@/modules/attendance/service";
import { notify } from "../platform/notifications/service";
import { ROLE_KEY } from "../platform/tasks-engine/engine/checklist";
import { type Anchor, planTree, roleKeysOf, type TreeItem } from "./engine/templates";
import { invalidateWorkDirectory } from "./directory";
import { invalidateMemberships } from "./viewer";
import { createProjectIn, type ProjectInput, type ProjectRow } from "./projects";
import { createWorkTaskIn } from "./tasks";
import type { TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type WorkTemplateRow = typeof schema.taskTemplate.$inferSelect;
export type WorkTemplateItemRow = typeof schema.taskTemplateItem.$inferSelect;

export const WORK_TEMPLATE_PURPOSES = ["work_project", "work_task"] as const;
export type WorkTemplatePurpose = (typeof WORK_TEMPLATE_PURPOSES)[number];
const isWorkPurpose = inArray(schema.taskTemplate.purpose, [...WORK_TEMPLATE_PURPOSES]);

export type WorkTemplateView = WorkTemplateRow & { items: WorkTemplateItemRow[]; roleKeys: string[] };

const treeItem = (item: WorkTemplateItemRow): TreeItem => ({ id: item.id, parentItemId: item.parentItemId, title: item.title, description: item.description, assigneeRule: item.assigneeRule, assigneePersonId: item.assigneePersonId, dueOffsetDays: item.dueOffsetDays, sortOrder: item.sortOrder, estimateMinutes: item.estimateMinutes });

// The work templates and their steps are small reference data read by every picker that offers
// one, so the whole set sits under a single cache key and the callers filter it here; every writer
// below drops the entry once committed, and the TTL bounds anything written behind the app's back
// (a seed). The checklist purposes stay out: their own screens never read this.
const TEMPLATES_KEY = "work:templates";
const TEMPLATES_TTL = 30 * 60;
/** After a write to `task_template` or its items outside this file (a seed) has committed. */
export const invalidateWorkTemplates = () => invalidate(TEMPLATES_KEY);

async function allWorkTemplates(executor?: Executor): Promise<WorkTemplateView[]> {
  const load = async (from: Executor): Promise<WorkTemplateView[]> => {
    const templates = await from.select().from(schema.taskTemplate).where(isWorkPurpose).orderBy(asc(schema.taskTemplate.purpose), asc(schema.taskTemplate.name), asc(schema.taskTemplate.id));
    if (templates.length === 0) return [];
    const items = await from.select().from(schema.taskTemplateItem).where(inArray(schema.taskTemplateItem.templateId, templates.map((template) => template.id))).orderBy(asc(schema.taskTemplateItem.sortOrder), asc(schema.taskTemplateItem.dueOffsetDays), asc(schema.taskTemplateItem.id));
    return templates.map((template) => {
      const own = items.filter((item) => item.templateId === template.id);
      return { ...template, items: own, roleKeys: roleKeysOf(own.map(treeItem)) };
    });
  };
  // Inside a transaction the rows come from there, not the cache.
  return executor ? load(executor) : cached(TEMPLATES_KEY, TEMPLATES_TTL, () => load(db()));
}

/** Shared templates (no owner) and those of the given teams. `teamIds` undefined = every team's. */
export async function listWorkTemplates(teamIds?: readonly string[], options: { activeOnly?: boolean; executor?: Executor } = {}): Promise<WorkTemplateView[]> {
  const all = await allWorkTemplates(options.executor);
  const wanted = teamIds === undefined ? null : new Set(teamIds);
  return all.filter((template) => (!options.activeOnly || template.isActive) && (wanted === null || template.ownerId === null || wanted.has(template.ownerId)));
}

export async function findWorkTemplate(templateId: string, executor: Executor = db()): Promise<WorkTemplateRow | undefined> {
  const [row] = await executor.select().from(schema.taskTemplate).where(and(eq(schema.taskTemplate.id, templateId), isWorkPurpose)).limit(1);
  return row;
}

export async function findWorkTemplateItem(itemId: string): Promise<{ item: WorkTemplateItemRow; template: WorkTemplateRow } | undefined> {
  const [row] = await db().select({ item: schema.taskTemplateItem, template: schema.taskTemplate }).from(schema.taskTemplateItem).innerJoin(schema.taskTemplate, eq(schema.taskTemplate.id, schema.taskTemplateItem.templateId)).where(and(eq(schema.taskTemplateItem.id, itemId), isWorkPurpose)).limit(1);
  return row;
}

export type WorkTemplateInput = { purpose: WorkTemplatePurpose; name: string; description: string | null; ownerId: string | null; isActive: boolean };

export async function saveWorkTemplate(templateId: string | null, input: WorkTemplateInput): Promise<{ before: WorkTemplateRow | null; after: WorkTemplateRow }> {
  if (!templateId) {
    const [after] = await db().insert(schema.taskTemplate).values(input).returning();
    await invalidateWorkTemplates();
    return { before: null, after };
  }
  const before = await findWorkTemplate(templateId);
  if (!before) throw new ActionError("template_not_found");
  const [after] = await db().update(schema.taskTemplate).set({ ...input, updatedAt: new Date() }).where(eq(schema.taskTemplate.id, templateId)).returning();
  await invalidateWorkTemplates();
  return { before, after };
}

export type WorkTemplateItemInput = { title: string; description: string | null; parentItemId: string | null; roleKey: string | null; dueOffsetDays: number; estimateMinutes: number | null; sortOrder: number };

export async function addWorkTemplateItem(templateId: string, input: WorkTemplateItemInput): Promise<WorkTemplateItemRow> {
  if (input.roleKey && !ROLE_KEY.test(input.roleKey)) throw new ActionError("template_role_invalid");
  if (input.parentItemId) {
    const [parent] = await db().select().from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.id, input.parentItemId)).limit(1);
    if (!parent || parent.templateId !== templateId) throw new ActionError("template_parent_invalid");
    // Two levels — task and sub-task — is what the screens show well.
    if (parent.parentItemId) throw new ActionError("template_too_deep");
  }
  const [row] = await db()
    .insert(schema.taskTemplateItem)
    .values({ templateId, title: input.title, description: input.description, parentItemId: input.parentItemId, roleKey: input.roleKey, assigneeRule: input.roleKey ? `role:${input.roleKey}` : "none", dueOffsetDays: input.dueOffsetDays, estimateMinutes: input.estimateMinutes, sortOrder: input.sortOrder })
    .returning();
  await invalidateWorkTemplates();
  return row;
}

/** Sub-steps go with their step (ON DELETE CASCADE); tasks already made keep their text. */
export async function removeWorkTemplateItem(itemId: string): Promise<WorkTemplateItemRow> {
  const [row] = await db().delete(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.id, itemId)).returning();
  if (!row) throw new ActionError("template_not_found");
  await invalidateWorkTemplates();
  return row;
}

// ── Using a template ────────────────────────────────────────────────────────────────────────

export type TemplateUse = { templateId: string; anchor: Anchor; /** role key → person */ roles: Record<string, string | null> };

/** Sundays and the entity's days off: a generated due date never lands on one. */
async function dayOffCheck(tx: Executor, entityId: string | null, anchor: Anchor, items: readonly TreeItem[]): Promise<(date: IsoDate) => boolean> {
  const span = Math.max(0, ...items.map((item) => Math.abs(item.dueOffsetDays))) + 30;
  const shift = (days: number) => new Date(Date.parse(`${anchor.date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const daysOff = new Set((await getDaysOff(entityId, shift(-span), shift(span), tx)).map((day) => day.date));
  return (date) => daysOff.has(date) || new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

export async function applyTemplateIn(tx: Executor, use: TemplateUse, target: { team: TeamRow; project: ProjectRow }, actorPersonId: string): Promise<{ template: WorkTemplateRow; taskIds: string[] }> {
  const template = await findWorkTemplate(use.templateId, tx);
  if (!template || !template.isActive) throw new ActionError("template_not_found");
  if (template.ownerId && template.ownerId !== target.team.id) throw new ActionError("template_other_team");
  const items = (await tx.select().from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.templateId, template.id))).map(treeItem);
  if (items.length === 0) throw new ActionError("template_empty");

  const roleKeys = roleKeysOf(items);
  const roles = Object.fromEntries(Object.entries(use.roles).filter(([key, personId]) => roleKeys.includes(key) && !!personId)) as Record<string, string>;
  const peopleIds = [...new Set(Object.values(roles))];
  if (peopleIds.length) {
    const found = await tx.select({ id: schema.person.id, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, peopleIds));
    if (found.length !== peopleIds.length || found.some((person) => person.status === "offboarded")) throw new ActionError("person_not_found");
    // Whoever plays a role works in the project.
    await tx.insert(schema.workProjectMember).values(peopleIds.map((personId) => ({ projectId: target.project.id, personId, role: "member" }))).onConflictDoNothing();
    await invalidateMemberships(...peopleIds);
  }

  const plan = planTree(items, use.anchor, roles, await dayOffCheck(tx, target.project.entityId, use.anchor, items));
  const taskOf = new Map<string, string>();
  const perAssignee = new Map<string, { count: number; title: string }>();
  for (const node of plan) {
    const { task } = await createWorkTaskIn(
      tx,
      { teamId: target.team.id, projectId: target.project.id, title: node.title, description: node.description, assigneePersonId: node.assigneePersonId, dueDate: node.dueDate, estimateMinutes: node.estimateMinutes, parentTaskId: node.parentItemId ? (taskOf.get(node.parentItemId) ?? null) : null, templateItemId: node.templateItemId },
      actorPersonId,
      { notify: false },
    );
    taskOf.set(node.templateItemId, task.id);
    if (node.assigneePersonId && node.assigneePersonId !== actorPersonId) perAssignee.set(node.assigneePersonId, { count: (perAssignee.get(node.assigneePersonId)?.count ?? 0) + 1, title: perAssignee.get(node.assigneePersonId)?.title ?? node.title });
  }
  // A thirty-step project is one notice per person, not thirty.
  for (const [personId, own] of perAssignee) await notify({ recipients: [personId], kind: "tasks.assigned", params: own, link: `/work/projects/${target.project.id}` }, tx);
  return { template, taskIds: [...taskOf.values()] };
}

export async function applyTemplate(use: TemplateUse, projectId: string, actorPersonId: string): Promise<{ template: WorkTemplateRow; project: ProjectRow; taskIds: string[] }> {
  return db().transaction(async (tx) => {
    const [found] = await tx.select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(eq(schema.workProject.id, projectId)).limit(1);
    if (!found) throw new ActionError("project_not_found");
    if (found.project.status === "archived") throw new ActionError("project_archived");
    return { ...(await applyTemplateIn(tx, use, found, actorPersonId)), project: found.project };
  });
}

/**
 * What else is made with the project, in the same transaction. The project layer (FR-PJM-15) adds
 * the plan half of the template here — phases, milestones, register — without work importing it.
 */
export type ProjectCreatedHook = (tx: Tx, made: { project: ProjectRow; template: WorkTemplateRow; taskIds: string[]; use: TemplateUse; lastStepDay: number }) => Promise<void>;

export async function createProjectFromTemplate(input: ProjectInput, use: TemplateUse, actorPersonId: string, onCreated?: ProjectCreatedHook): Promise<{ project: ProjectRow; template: WorkTemplateRow; taskIds: string[] }> {
  const created = await db().transaction(async (tx) => {
    const project = await createProjectIn(tx, input, actorPersonId);
    const [team] = await tx.select().from(schema.workTeam).where(eq(schema.workTeam.id, project.teamId)).limit(1);
    const made = { project, ...(await applyTemplateIn(tx, use, { team, project }, actorPersonId)) };
    if (onCreated) {
      const [last] = await tx.select({ day: sql<number | null>`max(${schema.taskTemplateItem.dueOffsetDays})` }).from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.templateId, made.template.id));
      await onCreated(tx, { ...made, use, lastStepDay: last?.day ?? 0 });
    }
    return made;
  });
  await invalidateWorkDirectory();
  return created;
}
