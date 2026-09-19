"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { ASSIGNEE_RULES, isChecklistPurpose } from "./engine/checklist";
import { canManageTask, canManageTemplates, canMoveTask, movesThroughEngine } from "./policy";
import { addTemplateItem, findTask, findTemplate, findTemplateItem, reassignTask, removeTemplateItem, saveTemplate, setTaskStatus } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

function refresh(task: { subjectPersonId: string | null }) {
  revalidatePath("/tasks");
  if (task.subjectPersonId) revalidatePath(`/people/${task.subjectPersonId}`);
}
const auditResource = (task: { id: string; kind: string; entityId: string | null }) => ({ type: `task:${task.kind}`, id: task.id, entityId: task.entityId });

const statusPipeline = createAction({
  name: "task.status",
  input: z.object({ taskId: z.uuid(), status: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  authorize: async (user, input) => {
    const task = await findTask(input.taskId);
    // Cancelling says "this will not happen": the manager's call, not the assignee's.
    return !!task && movesThroughEngine(task) && (input.status === "cancelled" ? canManageTask(user.principal, task) : canMoveTask(user.principal, task));
  },
  run: async ({ user, input }) => {
    const { before, after } = await setTaskStatus(input.taskId, input.status, user.person.id);
    refresh(after);
    return { data: { id: after.id }, audit: { resource: auditResource(after), summary: `${after.title}: ${before.status} → ${after.status}`, before: { status: before.status }, after: { status: after.status } } };
  },
});

export async function setTaskStatusAction(input: unknown) {
  return statusPipeline(input);
}

const reassignPipeline = createAction({
  name: "task.reassign",
  input: z.object({ taskId: z.uuid(), assigneePersonId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const task = await findTask(input.taskId);
    return !!task && movesThroughEngine(task) && canManageTask(user.principal, task);
  },
  run: async ({ user, input }) => {
    const { before, after } = await reassignTask(input.taskId, input.assigneePersonId, user.person.id);
    refresh(after);
    return { data: { id: after.id }, audit: { resource: auditResource(after), summary: after.title, before: { assigneePersonId: before.assigneePersonId }, after: { assigneePersonId: after.assigneePersonId } } };
  },
});

export async function reassignTaskAction(input: unknown) {
  return reassignPipeline(input);
}

// ── Checklist templates ─────────────────────────────────────────────────────────────────────

const templatePipeline = createAction({
  name: "task_template.save",
  input: z.object({
    templateId: optional(z.uuid()),
    purpose: z.string().trim().regex(/^[a-z_]{2,40}$/),
    name: z.string().trim().min(1).max(120),
    entityId: optional(z.uuid()),
    departmentId: optional(z.uuid()),
    positionId: optional(z.uuid()),
    isActive: checkbox,
  }),
  authorize: async (user, input) => {
    // Authority over where the template is now *and* over where it is being moved to.
    const existing = input.templateId ? await findTemplate(input.templateId) : null;
    if (input.templateId && !existing) return false;
    // Work templates have their own keepers (team leads), not HR.
    if (!isChecklistPurpose(input.purpose) || (existing && !isChecklistPurpose(existing.purpose))) return false;
    return (!existing || canManageTemplates(user.principal, existing)) && canManageTemplates(user.principal, { entityId: input.entityId });
  },
  run: async ({ input }) => {
    const { templateId, ...values } = input;
    const { before, after } = await saveTemplate(templateId, values);
    revalidatePath("/admin/checklists");
    return { data: { id: after.id }, audit: { resource: { type: "task_template", id: after.id, entityId: after.entityId }, summary: `${after.purpose}: ${after.name}`, before, after } };
  },
});

export async function saveTemplateAction(input: unknown) {
  return templatePipeline(input);
}

const addItemPipeline = createAction({
  name: "task_template.item.add",
  input: z.object({
    templateId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: optional(z.string().trim().max(1000)),
    rule: z.enum(ASSIGNEE_RULES),
    permission: optional(z.string().trim().regex(/^[a-z_]+:[a-z_]+$/)),
    assigneePersonId: optional(z.uuid()),
    dueOffsetDays: z.coerce.number().int().min(-365).max(365),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  }),
  authorize: async (user, input) => {
    const template = await findTemplate(input.templateId);
    return !!template && isChecklistPurpose(template.purpose) && canManageTemplates(user.principal, template);
  },
  run: async ({ input }) => {
    const { templateId, rule, permission, ...rest } = input;
    const item = await addTemplateItem(templateId, { ...rest, assigneeRule: rule === "permission" ? `permission:${permission ?? "person:manage"}` : rule });
    revalidatePath("/admin/checklists");
    return { data: { id: item.id }, audit: { resource: { type: "task_template", id: templateId }, summary: item.title, after: item } };
  },
});

export async function addTemplateItemAction(input: unknown) {
  return addItemPipeline(input);
}

const removeItemPipeline = createAction({
  name: "task_template.item.remove",
  input: z.object({ itemId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findTemplateItem(input.itemId);
    return !!found && isChecklistPurpose(found.template.purpose) && canManageTemplates(user.principal, found.template);
  },
  run: async ({ input }) => {
    const item = await removeTemplateItem(input.itemId);
    revalidatePath("/admin/checklists");
    return { data: { id: item.id }, audit: { resource: { type: "task_template", id: item.templateId }, summary: item.title, before: item } };
  },
});

export async function removeTemplateItemAction(input: unknown) {
  return removeItemPipeline(input);
}
