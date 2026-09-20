"use server";
// Templates, recurring tasks and the leader's nudge (FR-WRK-07, 10, 11).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { ROLE_KEY } from "../platform/tasks-engine/engine/checklist";
import { VISIBILITIES } from "./enums";
import { nudgeTask } from "./leader";
import { canContributeToProject, canCreateProject, canManageTemplate, canNudgeTask } from "./policy";
import { findProject, projectFacts } from "./projects";
import { changeRecurrence, createRecurrence, findRecurrence } from "./recurrences";
import { loadTask } from "./tasks";
import { findTeam, teamFacts } from "./teams";
import { addWorkTemplateItem, applyTemplate, createProjectFromTemplate, findWorkTemplate, findWorkTemplateItem, removeWorkTemplateItem, saveWorkTemplate, WORK_TEMPLATE_PURPOSES } from "./templates";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.iso.date();

// ── Templates ───────────────────────────────────────────────────────────────────────────────

async function ownerFacts(ownerId: string | null) {
  if (!ownerId) return { ok: true as const, team: null };
  const team = await findTeam(ownerId);
  return team ? { ok: true as const, team: teamFacts(team) } : { ok: false as const, team: null };
}

const saveTemplatePipeline = createAction({
  name: "work.template.save",
  input: z.object({ templateId: optional(z.uuid()), purpose: z.enum(WORK_TEMPLATE_PURPOSES), name: z.string().trim().min(1).max(120), description: optional(z.string().trim().max(1000)), ownerId: optional(z.uuid()), isActive: checkbox.default(true) }),
  authorize: async (user, input) => {
    const viewer = await loadViewer(user);
    const existing = input.templateId ? await findWorkTemplate(input.templateId) : null;
    if (input.templateId && !existing) return false;
    // Authority over where the template is now and over where it is being moved to.
    const [from, to] = [await ownerFacts(existing?.ownerId ?? null), await ownerFacts(input.ownerId)];
    return from.ok && to.ok && (!existing || canManageTemplate(viewer, from.team)) && canManageTemplate(viewer, to.team);
  },
  run: async ({ input }) => {
    const { templateId, ...values } = input;
    const { before, after } = await saveWorkTemplate(templateId, values);
    revalidatePath("/work/templates");
    return { data: { id: after.id }, audit: { resource: { type: "work_template", id: after.id }, summary: `${after.purpose}: ${after.name}`, before, after } };
  },
});
export async function saveWorkTemplateAction(input: unknown) {
  return saveTemplatePipeline(input);
}

const addItemPipeline = createAction({
  name: "work.template.item.add",
  input: z.object({
    templateId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: optional(z.string().trim().max(1000)),
    parentItemId: optional(z.uuid()),
    roleKey: optional(z.string().trim().toLowerCase().regex(ROLE_KEY)),
    dueOffsetDays: z.coerce.number().int().min(-365).max(365),
    estimateHours: optional(z.coerce.number().min(0.25).max(1000)),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  }),
  authorize: async (user, input) => {
    const template = await findWorkTemplate(input.templateId);
    if (!template) return false;
    const owner = await ownerFacts(template.ownerId);
    return owner.ok && canManageTemplate(await loadViewer(user), owner.team);
  },
  run: async ({ input }) => {
    const { templateId, estimateHours, ...rest } = input;
    const item = await addWorkTemplateItem(templateId, { ...rest, estimateMinutes: estimateHours === null ? null : Math.round(estimateHours * 60) });
    revalidatePath("/work/templates");
    return { data: { id: item.id }, audit: { resource: { type: "work_template", id: templateId }, summary: item.title, after: item } };
  },
});
export async function addWorkTemplateItemAction(input: unknown) {
  return addItemPipeline(input);
}

const removeItemPipeline = createAction({
  name: "work.template.item.remove",
  input: z.object({ itemId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findWorkTemplateItem(input.itemId);
    if (!found) return false;
    const owner = await ownerFacts(found.template.ownerId);
    return owner.ok && canManageTemplate(await loadViewer(user), owner.team);
  },
  run: async ({ input }) => {
    const item = await removeWorkTemplateItem(input.itemId);
    revalidatePath("/work/templates");
    return { data: { id: item.id }, audit: { resource: { type: "work_template", id: item.templateId }, summary: item.title, before: item } };
  },
});
export async function removeWorkTemplateItemAction(input: unknown) {
  return removeItemPipeline(input);
}

const templateUseFields = { templateId: z.uuid(), anchorMode: z.enum(["start", "end"]), anchorDate: isoDate, roles: z.record(z.string().regex(ROLE_KEY), optional(z.uuid())).default({}) };
const templateUseOf = (input: { templateId: string; anchorMode: "start" | "end"; anchorDate: string; roles: Record<string, string | null> }) => ({ templateId: input.templateId, anchor: { mode: input.anchorMode, date: input.anchorDate }, roles: input.roles });

const projectFromTemplatePipeline = createAction({
  name: "work.project.create_from_template",
  input: z.object({ ...templateUseFields, teamId: z.uuid(), name: z.string().trim().min(1).max(120), description: optional(z.string().trim().max(2000)), clientId: optional(z.uuid()), visibility: z.enum(VISIBILITIES), leadPersonId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canCreateProject(await loadViewer(user), teamFacts(team));
  },
  run: async ({ user, input }) => {
    const anchored = input.anchorMode === "start" ? { startDate: input.anchorDate, dueDate: null } : { startDate: null, dueDate: input.anchorDate };
    const { project, template, taskIds } = await createProjectFromTemplate({ teamId: input.teamId, name: input.name, description: input.description, clientId: input.clientId, status: "active", visibility: input.visibility, leadPersonId: input.leadPersonId, ...anchored }, templateUseOf(input), user.person.id);
    revalidatePath("/work");
    return { data: { id: project.id, tasks: taskIds.length }, audit: { resource: { type: "work_project", id: project.id, entityId: project.entityId }, summary: `${project.name} ← ${template.name} (${taskIds.length})`, after: { project, templateId: template.id, tasks: taskIds.length } } };
  },
});
export async function createProjectFromTemplateAction(input: unknown) {
  return projectFromTemplatePipeline(input);
}

const applyTemplatePipeline = createAction({
  name: "work.template.apply",
  input: z.object({ ...templateUseFields, projectId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findProject(input.projectId);
    return !!found && canContributeToProject(await loadViewer(user), projectFacts(found.project, found.team));
  },
  run: async ({ user, input }) => {
    const { project, template, taskIds } = await applyTemplate(templateUseOf(input), input.projectId, user.person.id);
    revalidatePath(`/work/projects/${project.id}`);
    return { data: { tasks: taskIds.length }, audit: { resource: { type: "work_project", id: project.id, entityId: project.entityId }, summary: `${project.name} ← ${template.name} (${taskIds.length})`, after: { templateId: template.id, tasks: taskIds.length } } };
  },
});
export async function applyTemplateAction(input: unknown) {
  return applyTemplatePipeline(input);
}

// ── Recurring tasks ─────────────────────────────────────────────────────────────────────────

const weekday = z.coerce.number().int().min(1).max(7);
const ruleInput = z.discriminatedUnion("freq", [
  z.object({ freq: z.literal("daily"), interval: z.coerce.number().int().min(1).max(366) }),
  z.object({ freq: z.literal("weekly"), interval: z.coerce.number().int().min(1).max(52), weekdays: z.array(weekday).min(1).max(7) }),
  z.object({ freq: z.literal("monthly"), interval: z.coerce.number().int().min(1).max(24), monthDay: z.union([z.literal("last"), z.coerce.number().int().min(1).max(31)]) }),
]);

const canWorkInProject = async (user: Parameters<typeof loadViewer>[0], projectId: string | null) => {
  const found = projectId ? await findProject(projectId) : undefined;
  return !!found && canContributeToProject(await loadViewer(user), projectFacts(found.project, found.team));
};

const createRecurrencePipeline = createAction({
  name: "work.recurrence.create",
  input: z.object({
    projectId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    rule: ruleInput,
    startDate: isoDate,
    endDate: optional(isoDate),
    leadDays: z.coerce.number().int().min(0).max(60).default(7),
    assigneePersonId: optional(z.uuid()),
    priority: optional(z.coerce.number().int().min(1).max(4)),
    description: optional(z.string().trim().max(10000)),
  }),
  authorize: (user, input) => canWorkInProject(user, input.projectId),
  run: async ({ user, input }) => {
    const { assigneePersonId, priority, description, ...rest } = input;
    const { recurrence, made } = await createRecurrence({ ...rest, draft: { assigneePersonId, priority, description } }, user.person.id, todayInVietnam());
    revalidatePath(`/work/projects/${input.projectId}`);
    return { data: { id: recurrence.id, made }, audit: { resource: { type: "work_recurrence", id: recurrence.id }, summary: `${recurrence.title} (${recurrence.rule.freq})`, after: { ...recurrence, made } } };
  },
});
export async function createRecurrenceAction(input: unknown) {
  return createRecurrencePipeline(input);
}

const changeRecurrencePipeline = createAction({
  name: "work.recurrence.change",
  input: z.object({ recurrenceId: z.uuid(), change: z.enum(["pause", "resume", "end"]) }),
  authorize: async (user, input) => canWorkInProject(user, (await findRecurrence(input.recurrenceId))?.projectId ?? null),
  run: async ({ input }) => {
    const { before, after } = await changeRecurrence(input.recurrenceId, input.change === "end" ? { endDate: todayInVietnam() } : { isActive: input.change === "resume" });
    if (after.projectId) revalidatePath(`/work/projects/${after.projectId}`);
    return { data: { id: after.id }, audit: { resource: { type: "work_recurrence", id: after.id }, summary: `${after.title}: ${input.change}`, before: { isActive: before.isActive, endDate: before.endDate }, after: { isActive: after.isActive, endDate: after.endDate } } };
  },
});
export async function changeRecurrenceAction(input: unknown) {
  return changeRecurrencePipeline(input);
}

// ── Leader view ─────────────────────────────────────────────────────────────────────────────

const nudgePipeline = createAction({
  name: "work.task.nudge",
  input: z.object({ taskId: z.uuid() }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canNudgeTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { loaded, assigneePersonId } = await nudgeTask(input.taskId, { personId: user.person.id, fullName: user.person.fullName }, todayInVietnam());
    revalidatePath("/work/leader");
    return { data: { id: input.taskId }, audit: { resource: { type: "task:work", id: input.taskId, entityId: loaded.task.entityId }, summary: `nudge: ${loaded.task.title}`, after: { assigneePersonId } } };
  },
});
export async function nudgeTaskAction(input: unknown) {
  return nudgePipeline(input);
}
