// The task engine's use-cases. Feature modules create tasks (directly or from a template) inside
// their own transaction and hang them on a context ("lifecycle_event" + id); people work through
// them on /tasks. Checklists are the first kind; see schema.ts for what Phase 3 adds.
import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../notifications/service";
import type { Principal } from "../rbac/policy";
import type { Permission } from "../rbac/roles";
import { listPeopleHolding } from "../rbac/service";
import { type AssigneeRule, isChecklistPurpose, parseAssigneeRule, pickTemplate, planChecklist } from "./engine/checklist";
import { canManageTask, canMoveTask, movesThroughEngine } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type TaskRow = typeof schema.task.$inferSelect;
export type TaskStatus = TaskRow["status"];
export type TaskTemplateRow = typeof schema.taskTemplate.$inferSelect;
export type TaskTemplateItemRow = typeof schema.taskTemplateItem.$inferSelect;
export type TaskContext = { type: string; id: string };

const OPEN: TaskStatus[] = ["todo", "in_progress"];
const live = isNull(schema.task.deletedAt);

// ── Creating ────────────────────────────────────────────────────────────────────────────────

export type NewTask = {
  kind: string;
  title: string;
  description?: string | null;
  linkUrl?: string | null;
  assigneePersonId?: string | null;
  dueDate?: IsoDate | null;
  priority?: number | null;
  entityId?: string | null;
  parentTaskId?: string | null;
  context?: TaskContext | null;
  subjectPersonId?: string | null;
  sortOrder?: number;
  templateItemId?: string | null;
  startDate?: IsoDate | null;
  estimateMinutes?: number | null;
  requesterPersonId?: string | null;
};

async function tellAssignees(executor: Executor, tasks: TaskRow[], actorId: string | null): Promise<void> {
  // One notice per person per batch: a twelve-step checklist is one event, not twelve.
  const byAssignee = Map.groupBy(tasks.filter((task) => task.assigneePersonId && task.assigneePersonId !== actorId), (task) => task.assigneePersonId!);
  for (const [assigneeId, own] of byAssignee) {
    await notify({ recipients: [assigneeId], kind: "tasks.assigned", params: { count: own.length, title: own[0].title }, link: "/tasks" }, executor);
  }
}

/** `notify: false` when the calling module tells people itself, in its own words and with its own link. */
export async function createTasks(executor: Executor, tasks: NewTask[], actorId: string | null, options: { notify?: boolean } = {}): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];
  const rows = await executor
    .insert(schema.task)
    .values(tasks.map(({ context, ...task }) => ({ ...task, contextType: context?.type ?? null, contextId: context?.id ?? null, createdByPersonId: actorId })))
    .returning();
  if (options.notify !== false) await tellAssignees(executor, rows, actorId);
  return rows;
}

export const createTask = async (executor: Executor, task: NewTask, actorId: string | null, options: { notify?: boolean } = {}): Promise<TaskRow> => (await createTasks(executor, [task], actorId, options))[0];

export type InstantiateInput = {
  purpose: string;
  kind?: string;
  entityId: string | null;
  departmentId: string | null;
  positionId: string | null;
  anchorDate: IsoDate;
  context: TaskContext;
  subjectPersonId: string | null;
  actorId: string | null;
};

/**
 * Turns the template that fits best into tasks. No template = no tasks (and no error: a company
 * that has not written its checklist yet can still hire). Rules become people here, once: a task
 * keeps its assignee when the org changes later, and HR can reassign.
 */
export async function instantiateTemplate(tx: Executor, input: InstantiateInput): Promise<{ template: TaskTemplateRow | null; tasks: TaskRow[] }> {
  const templates = await tx.select().from(schema.taskTemplate).where(eq(schema.taskTemplate.purpose, input.purpose)).orderBy(asc(schema.taskTemplate.createdAt));
  const template = pickTemplate(templates, input);
  if (!template) return { template: null, tasks: [] };
  const items = await tx.select().from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.templateId, template.id));

  const [subject] = input.subjectPersonId ? await tx.select().from(schema.person).where(eq(schema.person.id, input.subjectPersonId)).limit(1) : [];
  const target = { entityId: input.entityId, departmentId: input.departmentId, personId: input.subjectPersonId, managerId: subject?.managerId ?? null };
  const holders = new Map<string, string | null>();
  for (const item of items) {
    const rule = parseAssigneeRule(item.assigneeRule, item.assigneePersonId);
    if (rule?.rule !== "permission" || holders.has(rule.permission)) continue;
    // The people whose job it is, not the owners' "*"; never the subject (nobody offboards themselves).
    const people = (await listPeopleHolding(rule.permission as Exclude<Permission, "*">, target, { includeWildcard: false, executor: tx })).filter((id) => id !== input.subjectPersonId).sort();
    // Several people may hold it (entity HR and group HR): the one who works in the entity is the
    // likelier owner of the step. One name, not a committee — a manager of the kind can reassign.
    const local = people.length > 1 && input.entityId ? await tx.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, people), eq(schema.person.primaryEntityId, input.entityId))).orderBy(asc(schema.person.id)) : [];
    holders.set(rule.permission, local[0]?.id ?? people[0] ?? null);
  }
  const resolve = (rule: AssigneeRule): string | null => {
    if (rule.rule === "subject") return input.subjectPersonId;
    if (rule.rule === "line_manager") return subject?.managerId ?? null;
    if (rule.rule === "person") return rule.personId;
    return rule.rule === "permission" ? (holders.get(rule.permission) ?? null) : null;
  };

  const planned = planChecklist(items, input.anchorDate, resolve);
  const tasks = await createTasks(tx, planned.map((task) => ({ ...task, kind: input.kind ?? "checklist", entityId: input.entityId, context: input.context, subjectPersonId: input.subjectPersonId })), input.actorId);
  return { template, tasks };
}

// ── Working on tasks ────────────────────────────────────────────────────────────────────────

export async function findTask(taskId: string, executor: Executor = db()): Promise<TaskRow | undefined> {
  const [row] = await executor.select().from(schema.task).where(and(eq(schema.task.id, taskId), live)).limit(1);
  return row;
}

export async function setTaskStatus(taskId: string, status: TaskStatus, actorId: string, executor: Executor = db()): Promise<{ before: TaskRow; after: TaskRow }> {
  const before = await findTask(taskId, executor);
  if (!before) throw new ActionError("task_not_found");
  const done = status === "done";
  const [after] = await executor
    .update(schema.task)
    .set({ status, completedAt: done ? new Date() : null, completedByPersonId: done ? actorId : null, updatedAt: new Date() })
    .where(eq(schema.task.id, taskId))
    .returning();
  return { before, after };
}

export async function reassignTask(taskId: string, assigneePersonId: string | null, actorId: string): Promise<{ before: TaskRow; after: TaskRow }> {
  return db().transaction(async (tx) => {
    const before = await findTask(taskId, tx);
    if (!before) throw new ActionError("task_not_found");
    if (assigneePersonId) {
      const [assignee] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, assigneePersonId)).limit(1);
      if (!assignee || assignee.status === "offboarded") throw new ActionError("task_assignee_not_found");
    }
    const [after] = await tx.update(schema.task).set({ assigneePersonId, updatedAt: new Date() }).where(eq(schema.task.id, taskId)).returning();
    if (assigneePersonId !== before.assigneePersonId) await tellAssignees(tx, [after], actorId);
    return { before, after };
  });
}

/** Open tasks of a context that will never happen (a cancelled termination): cancelled, not deleted. */
export async function cancelOpenTasksOfContext(executor: Executor, context: TaskContext): Promise<number> {
  const rows = await executor
    .update(schema.task)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.task.contextType, context.type), eq(schema.task.contextId, context.id), inArray(schema.task.status, OPEN), live))
    .returning({ id: schema.task.id });
  return rows.length;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type TaskView = TaskRow & { assigneeName: string | null; subjectName: string | null };

function taskViews(executor: Executor = db()) {
  const assignee = alias(schema.person, "assignee");
  const subject = alias(schema.person, "subject");
  return executor
    .select({ task: schema.task, assigneeName: assignee.fullName, subjectName: subject.fullName })
    .from(schema.task)
    .leftJoin(assignee, eq(assignee.id, schema.task.assigneePersonId))
    .leftJoin(subject, eq(subject.id, schema.task.subjectPersonId))
    .$dynamic();
}
const flatten = (rows: { task: TaskRow; assigneeName: string | null; subjectName: string | null }[]): TaskView[] => rows.map(({ task, ...names }) => ({ ...task, ...names }));

/** Open tasks (most urgent first; undated last) and what was finished in the last two weeks. */
export async function listMyTasks(personId: string): Promise<{ open: TaskView[]; recentlyDone: TaskView[] }> {
  const mine = and(eq(schema.task.assigneePersonId, personId), live);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [open, recentlyDone] = await Promise.all([
    taskViews().where(and(mine, inArray(schema.task.status, OPEN))).orderBy(sql`${schema.task.dueDate} asc nulls last`, asc(schema.task.sortOrder)),
    taskViews().where(and(mine, eq(schema.task.status, "done"), gte(schema.task.completedAt, twoWeeksAgo))).orderBy(desc(schema.task.completedAt)).limit(30),
  ]);
  return { open: flatten(open), recentlyDone: flatten(recentlyDone) };
}

export async function countMyOpenTasks(personId: string): Promise<number> {
  const [row] = await db().select({ value: count() }).from(schema.task).where(and(eq(schema.task.assigneePersonId, personId), inArray(schema.task.status, OPEN), live));
  return row?.value ?? 0;
}

export async function listTasksOfContext(context: TaskContext, executor: Executor = db()): Promise<TaskView[]> {
  return flatten(await taskViews(executor).where(and(eq(schema.task.contextType, context.type), eq(schema.task.contextId, context.id), live)).orderBy(asc(schema.task.sortOrder)));
}

/** Every checklist about a person, grouped by context by the caller. */
export async function listTasksAbout(subjectPersonId: string, kind: string): Promise<TaskView[]> {
  return flatten(await taskViews().where(and(eq(schema.task.subjectPersonId, subjectPersonId), eq(schema.task.kind, kind), live)).orderBy(desc(schema.task.createdAt), asc(schema.task.sortOrder)));
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────

export type TemplateView = TaskTemplateRow & { items: TaskTemplateItemRow[] };
export type TemplateInput = { purpose: string; name: string; entityId: string | null; departmentId: string | null; positionId: string | null; isActive: boolean };
export type TemplateItemInput = { title: string; description: string | null; linkUrl?: string | null; assigneeRule: string; assigneePersonId: string | null; dueOffsetDays: number; sortOrder: number };

/** Checklist templates; work management lists its own. */
export async function listTemplates(): Promise<TemplateView[]> {
  const [templates, items] = await Promise.all([
    db().select().from(schema.taskTemplate).orderBy(asc(schema.taskTemplate.purpose), asc(schema.taskTemplate.name)),
    db().select().from(schema.taskTemplateItem).orderBy(asc(schema.taskTemplateItem.sortOrder), asc(schema.taskTemplateItem.dueOffsetDays)),
  ]);
  const itemsOf = new Map<string, TaskTemplateItemRow[]>();
  for (const item of items) {
    const list = itemsOf.get(item.templateId);
    if (list) list.push(item);
    else itemsOf.set(item.templateId, [item]);
  }
  return templates.filter((template) => isChecklistPurpose(template.purpose)).map((template) => ({ ...template, items: itemsOf.get(template.id) ?? [] }));
}

export async function findTemplate(templateId: string): Promise<TaskTemplateRow | undefined> {
  const [row] = await db().select().from(schema.taskTemplate).where(eq(schema.taskTemplate.id, templateId)).limit(1);
  return row;
}

export async function findTemplateItem(itemId: string): Promise<{ item: TaskTemplateItemRow; template: TaskTemplateRow } | undefined> {
  const [row] = await db().select({ item: schema.taskTemplateItem, template: schema.taskTemplate }).from(schema.taskTemplateItem).innerJoin(schema.taskTemplate, eq(schema.taskTemplate.id, schema.taskTemplateItem.templateId)).where(eq(schema.taskTemplateItem.id, itemId)).limit(1);
  return row;
}

export async function saveTemplate(templateId: string | null, input: TemplateInput): Promise<{ before: TaskTemplateRow | null; after: TaskTemplateRow }> {
  if (!templateId) {
    const [after] = await db().insert(schema.taskTemplate).values(input).returning();
    return { before: null, after };
  }
  const before = await findTemplate(templateId);
  if (!before) throw new ActionError("template_not_found");
  const [after] = await db().update(schema.taskTemplate).set({ ...input, updatedAt: new Date() }).where(eq(schema.taskTemplate.id, templateId)).returning();
  return { before, after };
}

function checkItem(input: TemplateItemInput): void {
  const rule = parseAssigneeRule(input.assigneeRule, input.assigneePersonId);
  if (!rule) throw new ActionError("template_rule_invalid");
  if (rule.rule === "person" && !rule.personId) throw new ActionError("template_person_required");
}

export async function addTemplateItem(templateId: string, input: TemplateItemInput): Promise<TaskTemplateItemRow> {
  checkItem(input);
  const [row] = await db().insert(schema.taskTemplateItem).values({ templateId, ...input, assigneePersonId: input.assigneeRule === "person" ? input.assigneePersonId : null }).returning();
  return row;
}

/** Tasks already created from the item keep their text; they only lose the link back (ON DELETE SET NULL). */
export async function removeTemplateItem(itemId: string): Promise<TaskTemplateItemRow> {
  const [row] = await db().delete(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.id, itemId)).returning();
  if (!row) throw new ActionError("template_not_found");
  return row;
}

// ── For the screens ─────────────────────────────────────────────────────────────────────────

/**
 * Tasks as the list component shows them, with what this viewer may do (the actions re-check).
 * Kinds that do not move through the engine's own actions (work tasks, obligations) get no buttons
 * here: `linkFor` says where their own screen is.
 */
export function presentTasks(principal: Principal, tasks: TaskView[], linkFor?: (task: TaskView) => string | null) {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    linkUrl: task.linkUrl,
    status: task.status,
    dueDate: task.dueDate,
    assigneePersonId: task.assigneePersonId,
    assigneeName: task.assigneeName,
    subjectPersonId: task.subjectPersonId,
    subjectName: task.subjectName,
    href: linkFor?.(task) ?? null,
    canMove: movesThroughEngine(task) && canMoveTask(principal, task),
    canManage: movesThroughEngine(task) && canManageTask(principal, task),
  }));
}
