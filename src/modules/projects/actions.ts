"use server";
// The project layer's mutations (FR-PJM-01..15, 27). Each re-checks the project against the viewer:
// the plan by `canEditPlan`, the brief and client side by `canEditClientSide`, money by
// `pjm:commercial` over the project's entity, status updates by `canPostStatus`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import type { CurrentUser } from "../platform/auth/session";
import { getRequest } from "../platform/approvals/service";
import { ROLE_KEY } from "../platform/tasks-engine/engine/checklist";
import { updateTaskAction } from "../work/actions";
import { CHANNELS, CONTENT_FORMATS, VISIBILITIES } from "../work/enums";
import type { WorkViewer } from "../work/policy";
import { canCreateProject, canEditTask, canGiveProjectRole, canManageTemplate, createProjectFromTemplate, findProject, findTeam, findWorkTemplate, invalidateWorkDirectory, loadTask, loadViewer, projectFacts, projectRoleOf, teamFacts } from "../work/service";
import { PROJECT_KINDS } from "./engine/brief";
import { HEALTHS } from "./engine/status";
import { decideBrief, projectBriefRequest, submitBrief } from "./kickoff";
import { isProjectClosed, setAccountManager, setFee, updateBrief, updatePlanSettings } from "./plans";
import { canEditClientSide, canEditFees, canEditPlan, canManageBookings, canPostStatus, canRebaseline, type PlanFacts } from "./policy";
import { buildPortfolioExport } from "./portfolio";
import { postStatusUpdate } from "./status-updates";
import { cancelDeliverable, createTasksForLine, deleteMilestone, deletePhase, findDeliverable, findMilestone, findPhase, linkTask, projectOfTask, saveDeliverable, saveMilestone, savePhase, setMilestoneDone, unlinkTask } from "./structure";
import { applyTemplatePlanIn, saveTemplatePlan } from "./template-plans";
import { rebaseline } from "./baselines";
import { bookWeeks, deleteBooking, fillPlaceholder, findBooking, updateBooking } from "./bookings";
import { BOOKING_STATUSES } from "./engine/capacity";
import { moveTimelineTask, type TaskDateWriter } from "./timeline";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const isoDate = z.iso.date();
const text = (max: number) => optional(z.string().trim().max(max));
/** Hours on screen, minutes in the database: "12.5" → 750. */
const hours = z.preprocess(blankToNull, z.coerce.number().min(0).max(100_000).nullable().default(null)).transform((value) => (value === null ? null : Math.round(value * 60)));
/** Rows of a repeated group: the form posts "roles.0.role", "roles.1.role"… which arrive as an object keyed by position. Blank rows are dropped. */
const rows = <Schema extends z.ZodType>(schema: Schema, max: number) =>
  z.preprocess((value) => {
    const list = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).sort(([a], [b]) => Number(a) - Number(b)).map(([, row]) => row) : (value ?? []);
    return (list as unknown[]).filter((row) => !row || typeof row !== "object" || Object.values(row).some((cell) => typeof cell === "string" ? cell.trim() !== "" : cell !== undefined && cell !== null && cell !== false));
  }, z.array(schema).max(max));
/** Integer VND; "12.000.000" and "12,000,000" are what people type. */
const vnd = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? null : value.replace(/[.,\s]/g, "")) : value), z.coerce.number().int().min(0).max(1_000_000_000_000).nullable().default(null));

type Project = { viewer: WorkViewer; facts: PlanFacts; project: NonNullable<Awaited<ReturnType<typeof findProject>>>["project"] };

/** The project as the plan rules see it — including whether it was closed, which makes the plan read-only. */
async function projectFor(user: CurrentUser, projectId: string | null): Promise<Project | null> {
  if (!projectId) return null;
  const [found, viewer, closed] = await Promise.all([findProject(projectId), loadViewer(user), isProjectClosed(projectId)]);
  return found ? { viewer, facts: { ...projectFacts(found.project, found.team), closed }, project: found.project } : null;
}

const may = async (user: CurrentUser, projectId: string | null, rule: (viewer: WorkViewer, facts: PlanFacts) => boolean) => {
  const found = await projectFor(user, projectId);
  return !!found && rule(found.viewer, found.facts);
};

const auditProject = (projectId: string, entityId: string | null = null) => ({ type: "work_project", id: projectId, entityId });
function refresh(projectId: string) {
  for (const tab of ["", "/plan", "/deliverables", "/budget", "/updates", "/timeline", "/team", "/acceptance", "/close"]) revalidatePath(`/projects/${projectId}${tab}`);
  revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/projects");
  // A billing milestone marked done lands in finance's queue.
  revalidatePath("/projects/billing");
}

// ── The plan: type, budget, account manager, fee ────────────────────────────────────────────

const settingsPipeline = createAction({
  name: "projects.plan.settings",
  input: z.object({
    projectId: z.uuid(),
    kind: z.enum(PROJECT_KINDS),
    budgetHours: hours,
    roles: rows(z.object({ role: z.string().trim().max(60), hours }), 20).default([]),
    updateCadenceDays: z.coerce.number().int().min(1).max(60).default(7),
    driveUrl: optional(z.url().max(500)),
  }),
  authorize: (user, input) => may(user, input.projectId, canEditPlan),
  run: async ({ input }) => {
    const budgetByRole = input.roles.flatMap((role) => (role.role && role.hours ? [{ role: role.role, minutes: role.hours }] : []));
    const { before, after } = await updatePlanSettings(input.projectId, { kind: input.kind, budgetMinutes: input.budgetHours, budgetByRole, updateCadenceDays: input.updateCadenceDays, driveUrl: input.driveUrl });
    refresh(input.projectId);
    const shape = (plan: typeof before) => ({ kind: plan.kind, budgetMinutes: plan.budgetMinutes, budgetByRole: plan.budgetByRole, updateCadenceDays: plan.updateCadenceDays, driveUrl: plan.driveUrl });
    return { data: { budgetMinutes: after.budgetMinutes }, audit: { resource: auditProject(input.projectId), summary: `${after.jobNumber ?? ""} plan settings`, before: shape(before), after: shape(after) } };
  },
});
export async function updatePlanSettingsAction(input: unknown) {
  return settingsPipeline(input);
}

const feePipeline = createAction({
  name: "projects.plan.fee",
  input: z.object({ projectId: z.uuid(), feeVnd: vnd }),
  authorize: (user, input) => may(user, input.projectId, canEditFees),
  run: async ({ user, input }) => {
    const found = await projectFor(user, input.projectId);
    const change = await setFee(input.projectId, input.feeVnd);
    refresh(input.projectId);
    // The log says the fee changed, never what it is: an audit reader is not a `pjm:commercial`
    // holder. The entity is on the record so the reading itself is kept to the project's own.
    return { data: { ok: true }, audit: { resource: auditProject(input.projectId, found?.project.entityId ?? null), summary: "fee", before: { feeSet: change.before !== null }, after: { feeSet: change.after !== null, feeChanged: change.before !== change.after } } };
  },
});
export async function setFeeAction(input: unknown) {
  return feePipeline(input);
}

const accountManagerPipeline = createAction({
  name: "projects.plan.account_manager",
  input: z.object({ projectId: z.uuid(), personId: optional(z.uuid()) }),
  // Naming who owns the client relationship is running the project. The account manager reads the
  // fee (Q21), so naming someone new takes `pjm:commercial` too (`canGiveProjectRole`); clearing
  // the role, or keeping the one already named, does not.
  authorize: async (user, input) => {
    const found = await projectFor(user, input.projectId);
    if (!found || !canEditPlan(found.viewer, found.facts)) return false;
    if (!input.personId) return true;
    return canGiveProjectRole(found.viewer, found.facts, await projectRoleOf(input.projectId, input.personId), "account_manager");
  },
  run: async ({ input }) => {
    const change = await setAccountManager(input.projectId, input.personId);
    refresh(input.projectId);
    return { data: change, audit: { resource: auditProject(input.projectId), summary: `account manager: ${change.before ?? "—"} → ${change.after ?? "—"}`, before: { accountManagerPersonId: change.before }, after: { accountManagerPersonId: change.after } } };
  },
});
export async function setAccountManagerAction(input: unknown) {
  return accountManagerPipeline(input);
}

// ── The brief and the kick-off gate (FR-PJM-03) ─────────────────────────────────────────────

const lines = (max: number) => z.preprocess((value) => (typeof value === "string" ? value.split("\n").map((line) => line.trim()).filter(Boolean) : (value ?? [])), z.array(z.string().max(max)).max(30));

const briefPipeline = createAction({
  name: "projects.brief.update",
  input: z.object({
    projectId: z.uuid(),
    objective: text(4000),
    scopeIn: text(4000),
    scopeOut: text(4000),
    successCriteria: text(4000),
    assumptions: text(4000),
    audience: text(2000),
    keyMessages: text(2000),
    /** One contact per line: "Name — role — phone or email". */
    clientContacts: lines(300),
    links: z.preprocess((value) => (typeof value === "string" ? value.split("\n").map((line) => line.trim()).filter(Boolean) : (value ?? [])), z.array(z.url().max(500)).max(20)),
  }),
  authorize: (user, input) => may(user, input.projectId, canEditClientSide),
  run: async ({ input }) => {
    const { projectId, clientContacts, links, ...fields } = input;
    const contacts = clientContacts.map((line) => {
      const [name, role, contact] = line.split(/\s+[—–-]\s+/).map((part) => part.trim());
      return { name, ...(role ? { role } : {}), ...(contact ? { contact } : {}) };
    });
    const brief = Object.fromEntries(Object.entries({ ...fields, clientContacts: contacts.length ? contacts : undefined, links: links.length ? links : undefined }).filter(([, value]) => value !== null && value !== undefined));
    await updateBrief(projectId, brief);
    refresh(projectId);
    // The brief is client information, not personal data; the log says that it changed, not what it says.
    return { data: { ok: true }, audit: { resource: auditProject(projectId), summary: "brief updated", after: { fields: Object.keys(brief) } } };
  },
});
export async function updateBriefAction(input: unknown) {
  return briefPipeline(input);
}

const submitBriefPipeline = createAction({
  name: "projects.brief.submit",
  input: z.object({ projectId: z.uuid() }),
  authorize: (user, input) => may(user, input.projectId, canEditClientSide),
  run: async ({ user, input }) => {
    const { plan, requestId, resubmitted } = await submitBrief(input.projectId, user.person.id);
    // A configured flow with nothing to ask approves at once, and the project goes live.
    if (plan.briefStatus === "approved") await invalidateWorkDirectory();
    refresh(input.projectId);
    revalidatePath("/approvals");
    return { data: { requestId, briefStatus: plan.briefStatus }, audit: { resource: auditProject(input.projectId), summary: resubmitted ? "brief resubmitted" : "brief submitted", after: { requestId, briefStatus: plan.briefStatus } } };
  },
});
export async function submitBriefAction(input: unknown) {
  return submitBriefPipeline(input);
}

const decideBriefPipeline = createAction({
  name: "projects.brief.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  // Whose turn it is comes from the flow: the team's leads, else the owners.
  authorize: async (user, input) => !!(await getRequest({ personId: user.person.id, principal: user.principal }, projectBriefRequest, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { projectId, outcome, plan, entityId, before } = await decideBrief(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    // Approval may have made the project active: the work directory holds its status.
    await invalidateWorkDirectory();
    refresh(projectId);
    revalidatePath("/approvals");
    return { data: { outcome }, audit: { resource: auditProject(projectId, entityId), summary: `brief ${input.decision}`, before, after: { outcome, briefStatus: plan.briefStatus, baseline: plan.baseline } } };
  },
});
export async function decideBriefAction(input: unknown) {
  return decideBriefPipeline(input);
}

// ── Phases, milestones, register (FR-PJM-04, 05) ────────────────────────────────────────────

const phasePipeline = createAction({
  name: "projects.phase.save",
  input: z.object({ projectId: z.uuid(), phaseId: optional(z.uuid()), name: z.string().trim().min(1).max(120), startDate: optional(isoDate), endDate: optional(isoDate), budgetHours: hours, sortOrder: z.coerce.number().int().min(0).max(1000).default(0) }),
  authorize: (user, input) => may(user, input.projectId, canEditPlan),
  run: async ({ input }) => {
    const { projectId, phaseId, budgetHours, ...values } = input;
    const { before, after } = await savePhase(projectId, phaseId, { ...values, budgetMinutes: budgetHours });
    refresh(projectId);
    return { data: { id: after.id }, audit: { resource: auditProject(projectId), summary: `phase: ${after.name}`, before, after } };
  },
});
export async function savePhaseAction(input: unknown) {
  return phasePipeline(input);
}

const deletePhasePipeline = createAction({
  name: "projects.phase.delete",
  input: z.object({ phaseId: z.uuid() }),
  authorize: async (user, input) => may(user, (await findPhase(input.phaseId))?.projectId ?? null, canEditPlan),
  run: async ({ input }) => {
    const row = await deletePhase(input.phaseId);
    refresh(row.projectId);
    return { data: { id: row.id }, audit: { resource: auditProject(row.projectId), summary: `phase removed: ${row.name}`, before: row } };
  },
});
export async function deletePhaseAction(input: unknown) {
  return deletePhasePipeline(input);
}

const milestonePipeline = createAction({
  name: "projects.milestone.save",
  input: z.object({
    projectId: z.uuid(),
    milestoneId: optional(z.uuid()),
    name: z.string().trim().min(1).max(160),
    dueDate: optional(isoDate),
    phaseId: optional(z.uuid()),
    ownerPersonId: optional(z.uuid()),
    isClientFacing: checkbox.default(false),
    isBilling: checkbox.default(false),
    billingAmountVnd: vnd.optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  }),
  authorize: (user, input) => may(user, input.projectId, canEditPlan),
  run: async ({ user, input }) => {
    const { projectId, milestoneId, billingAmountVnd, ...values } = input;
    const found = await projectFor(user, projectId);
    // A billing amount is money: written only with `pjm:commercial` over the entity (Q21 widened
    // who *reads* a fee, not who moves one); for anyone else it is left as it was.
    const amount = found && canEditFees(found.viewer, found.facts) && billingAmountVnd !== undefined ? { billingAmountVnd } : {};
    const { before, after } = await saveMilestone(projectId, milestoneId, { ...values, ...amount });
    refresh(projectId);
    const shape = (row: typeof after | null) => (row ? { name: row.name, dueDate: row.dueDate, phaseId: row.phaseId, ownerPersonId: row.ownerPersonId, isClientFacing: row.isClientFacing, isBilling: row.isBilling } : null);
    return { data: { id: after.id }, audit: { resource: auditProject(projectId, found?.project.entityId ?? null), summary: `milestone: ${after.name}`, before: shape(before), after: { ...shape(after), billingAmountChanged: "billingAmountVnd" in amount } } };
  },
});
export async function saveMilestoneAction(input: unknown) {
  return milestonePipeline(input);
}

const milestoneDonePipeline = createAction({
  name: "projects.milestone.done",
  input: z.object({ milestoneId: z.uuid(), done: checkbox }),
  authorize: async (user, input) => may(user, (await findMilestone(input.milestoneId))?.projectId ?? null, canEditPlan),
  run: async ({ user, input }) => {
    const { after } = await setMilestoneDone(input.milestoneId, input.done, user.person.id);
    refresh(after.projectId);
    return { data: { id: after.id }, audit: { resource: auditProject(after.projectId), summary: `milestone ${input.done ? "done" : "reopened"}: ${after.name}`, after: { doneAt: after.doneAt } } };
  },
});
export async function setMilestoneDoneAction(input: unknown) {
  return milestoneDonePipeline(input);
}

const deleteMilestonePipeline = createAction({
  name: "projects.milestone.delete",
  input: z.object({ milestoneId: z.uuid() }),
  authorize: async (user, input) => may(user, (await findMilestone(input.milestoneId))?.projectId ?? null, canEditPlan),
  run: async ({ input }) => {
    const row = await deleteMilestone(input.milestoneId);
    refresh(row.projectId);
    return { data: { id: row.id }, audit: { resource: auditProject(row.projectId), summary: `milestone removed: ${row.name}`, before: { name: row.name, dueDate: row.dueDate } } };
  },
});
export async function deleteMilestoneAction(input: unknown) {
  return deleteMilestonePipeline(input);
}

const deliverablePipeline = createAction({
  name: "projects.deliverable.save",
  input: z.object({
    projectId: z.uuid(),
    deliverableId: optional(z.uuid()),
    title: z.string().trim().min(1).max(200),
    quantity: z.coerce.number().int().min(1).max(1000),
    format: optional(z.enum(CONTENT_FORMATS)),
    channel: optional(z.enum(CHANNELS)),
    dueDate: optional(isoDate),
    milestoneId: optional(z.uuid()),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  }),
  authorize: (user, input) => may(user, input.projectId, canEditPlan),
  run: async ({ input }) => {
    const { projectId, deliverableId, ...values } = input;
    const { before, after } = await saveDeliverable(projectId, deliverableId, values);
    refresh(projectId);
    return { data: { id: after.id }, audit: { resource: auditProject(projectId), summary: `register: ${after.quantity} × ${after.title}`, before, after } };
  },
});
export async function saveDeliverableAction(input: unknown) {
  return deliverablePipeline(input);
}

const cancelDeliverablePipeline = createAction({
  name: "projects.deliverable.cancel",
  input: z.object({ deliverableId: z.uuid(), cancelled: checkbox }),
  authorize: async (user, input) => may(user, (await findDeliverable(input.deliverableId))?.projectId ?? null, canEditPlan),
  run: async ({ input }) => {
    const { after } = await cancelDeliverable(input.deliverableId, input.cancelled);
    refresh(after.projectId);
    return { data: { id: after.id }, audit: { resource: auditProject(after.projectId), summary: `register ${input.cancelled ? "cancelled" : "restored"}: ${after.title}`, after: { cancelledAt: after.cancelledAt } } };
  },
});
export async function cancelDeliverableAction(input: unknown) {
  return cancelDeliverablePipeline(input);
}

// ── Tasks and the plan ──────────────────────────────────────────────────────────────────────

const linkPipeline = createAction({
  name: "projects.task.link",
  input: z.object({ taskId: z.uuid(), milestoneId: optional(z.uuid()), deliverableId: optional(z.uuid()), phaseId: optional(z.uuid()) }),
  authorize: async (user, input) => may(user, await projectOfTask(input.taskId), canEditPlan),
  run: async ({ input }) => {
    const projectId = (await projectOfTask(input.taskId))!;
    const { before, after } = await linkTask(projectId, input.taskId, { milestoneId: input.milestoneId, deliverableId: input.deliverableId, phaseId: input.phaseId });
    refresh(projectId);
    return { data: after, audit: { resource: { type: "task:work", id: input.taskId }, summary: "plan link", before, after } };
  },
});
export async function linkTaskAction(input: unknown) {
  return linkPipeline(input);
}

const unlinkPipeline = createAction({
  name: "projects.task.unlink",
  input: z.object({ taskId: z.uuid() }),
  authorize: async (user, input) => may(user, await projectOfTask(input.taskId), canEditPlan),
  run: async ({ input }) => {
    const projectId = (await projectOfTask(input.taskId))!;
    const removed = await unlinkTask(input.taskId);
    refresh(projectId);
    return { data: { removed }, audit: { resource: { type: "task:work", id: input.taskId }, summary: "plan link removed" } };
  },
});
export async function unlinkTaskAction(input: unknown) {
  return unlinkPipeline(input);
}

const lineTasksPipeline = createAction({
  name: "projects.deliverable.create_tasks",
  input: z.object({ deliverableId: z.uuid(), count: z.coerce.number().int().min(1).max(50), assigneePersonId: optional(z.uuid()), dueDate: optional(isoDate) }),
  // Making tasks in the project is contributing; making them for the register is planning.
  authorize: async (user, input) => may(user, (await findDeliverable(input.deliverableId))?.projectId ?? null, canEditPlan),
  run: async ({ user, input }) => {
    const { line, taskIds } = await createTasksForLine(input.deliverableId, { count: input.count, assigneePersonId: input.assigneePersonId, dueDate: input.dueDate }, user.person.id);
    refresh(line.projectId);
    revalidatePath("/tasks");
    return { data: { tasks: taskIds.length }, audit: { resource: auditProject(line.projectId), summary: `${taskIds.length} tasks for ${line.title}`, after: { deliverableId: line.id, taskIds } } };
  },
});
export async function createLineTasksAction(input: unknown) {
  return lineTasksPipeline(input);
}

// ── Status updates (FR-PJM-27) ──────────────────────────────────────────────────────────────

const statusPipeline = createAction({
  name: "projects.status.post",
  input: z.object({ projectId: z.uuid(), health: z.enum(HEALTHS), summary: z.string().trim().min(1).max(4000), highlights: text(4000), nextSteps: text(4000) }),
  authorize: (user, input) => may(user, input.projectId, canPostStatus),
  run: async ({ user, input }) => {
    const { projectId, ...values } = input;
    const row = await postStatusUpdate(projectId, values, { personId: user.person.id, fullName: user.person.fullName });
    refresh(projectId);
    return { data: { id: row.id }, audit: { resource: auditProject(projectId), summary: `status: ${row.health}`, after: { health: row.health, facts: row.facts } } };
  },
});
export async function postStatusUpdateAction(input: unknown) {
  return statusPipeline(input);
}

// ── The portfolio as CSV (FR-PJM-08, FR-PLT-37) ─────────────────────────────────────────────

const filterId = optional(z.uuid());
const exportPipeline = createAction({
  name: "projects.portfolio.export",
  input: z.object({ teamId: filterId, clientId: filterId, leadPersonId: filterId, entityId: filterId, kind: optional(z.enum(PROJECT_KINDS)), health: optional(z.enum([...HEALTHS, "stale", "none"])), locale: z.enum(["vi", "en"]).default("vi") }),
  // Anyone may export what they may see: the rows are the portfolio's own, filtered by the same policy.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { locale, ...raw } = input;
    const filters = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null)) as Record<string, string>;
    const { file, withFees } = await buildPortfolioExport(await loadViewer(user), filters, locale);
    return { data: file, audit: { resource: { type: "export:portfolio" }, summary: `${file.rowCount} rows`, after: { filters, rowCount: file.rowCount, withFees } } };
  },
});
export async function exportPortfolioAction(input: unknown) {
  return exportPipeline(input);
}

// ── Project templates v2 (FR-PJM-15) ────────────────────────────────────────────────────────

async function managesTemplate(user: CurrentUser, templateId: string): Promise<boolean> {
  const template = await findWorkTemplate(templateId);
  if (!template || template.purpose !== "work_project") return false;
  const owner = template.ownerId ? await findTeam(template.ownerId) : null;
  if (template.ownerId && !owner) return false;
  return canManageTemplate(await loadViewer(user), owner ? teamFacts(owner) : null);
}

const day = z.coerce.number().int().min(-365).max(730);
const index = z.preprocess(blankToNull, z.coerce.number().int().min(0).max(99).nullable().default(null));
const templatePlanPipeline = createAction({
  name: "projects.template_plan.save",
  input: z.object({
    templateId: z.uuid(),
    kind: z.enum(PROJECT_KINDS),
    updateCadenceDays: z.coerce.number().int().min(1).max(60).default(7),
    phases: rows(z.object({ name: z.string().trim().min(1).max(120), startDay: day, endDay: day }), 20).default([]),
    milestones: rows(z.object({ name: z.string().trim().min(1).max(160), day, phase: index, isClientFacing: checkbox.default(false), isBilling: checkbox.default(false) }), 40).default([]),
    deliverables: rows(z.object({ title: z.string().trim().min(1).max(200), quantity: z.coerce.number().int().min(1).max(1000), format: optional(z.enum(CONTENT_FORMATS)), channel: optional(z.enum(CHANNELS)), milestone: index, day: z.preprocess(blankToNull, day.nullable().default(null)) }), 60).default([]),
    roles: rows(z.object({ role: z.string().trim().max(60), hours }), 20).default([]),
    objective: text(4000),
    scopeIn: text(4000),
    scopeOut: text(4000),
    successCriteria: text(4000),
    assumptions: text(4000),
  }),
  authorize: (user, input) => managesTemplate(user, input.templateId),
  run: async ({ input }) => {
    const { templateId, roles, objective, scopeIn, scopeOut, successCriteria, assumptions, ...parts } = input;
    const brief = Object.fromEntries(Object.entries({ objective, scopeIn, scopeOut, successCriteria, assumptions }).filter(([, value]) => value !== null));
    const budgetByRole = roles.flatMap((role) => (role.role && role.hours ? [{ role: role.role, minutes: role.hours }] : []));
    const { before, after } = await saveTemplatePlan(templateId, { ...parts, budgetByRole, brief });
    revalidatePath("/work/templates");
    return { data: { templateId }, audit: { resource: { type: "work_template", id: templateId }, summary: "plan parts", before, after } };
  },
});
export async function saveTemplatePlanAction(input: unknown) {
  return templatePlanPipeline(input);
}

/**
 * A project from a template, both halves: the work module makes the project and its task tree,
 * the plan half (phases, milestones, register, budget, brief) is made in the same transaction. The
 * project starts "planned": it goes live when its brief passes the kick-off gate.
 */
const projectFromTemplatePipeline = createAction({
  name: "projects.create_from_template",
  input: z.object({
    templateId: z.uuid(),
    anchorMode: z.enum(["start", "end"]),
    anchorDate: isoDate,
    roles: z.record(z.string().regex(ROLE_KEY), optional(z.uuid())).default({}),
    teamId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: text(2000),
    clientId: optional(z.uuid()),
    visibility: z.enum(VISIBILITIES),
    leadPersonId: optional(z.uuid()),
  }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canCreateProject(await loadViewer(user), teamFacts(team));
  },
  run: async ({ user, input }) => {
    const anchored = input.anchorMode === "start" ? { startDate: input.anchorDate, dueDate: null } : { startDate: null, dueDate: input.anchorDate };
    const { project, template, taskIds } = await createProjectFromTemplate(
      { teamId: input.teamId, name: input.name, description: input.description, clientId: input.clientId, status: "planned", visibility: input.visibility, leadPersonId: input.leadPersonId, ...anchored },
      { templateId: input.templateId, anchor: { mode: input.anchorMode, date: input.anchorDate }, roles: input.roles },
      user.person.id,
      applyTemplatePlanIn,
    );
    revalidatePath("/work");
    revalidatePath("/projects");
    return { data: { id: project.id, tasks: taskIds.length }, audit: { resource: { type: "work_project", id: project.id, entityId: project.entityId }, summary: `${project.name} ← ${template.name} (${taskIds.length})`, after: { project, templateId: template.id, tasks: taskIds.length } } };
  },
});
export async function createProjectFromTemplatePlanAction(input: unknown) {
  return projectFromTemplatePipeline(input);
}

// ── The timeline (FR-PJM-07) ────────────────────────────────────────────────────────────────

/**
 * The work module's own task update writes each date — its checks, its activity entry, its audit
 * line per task. A refusal there stops the move where it is and says why.
 */
const writeThroughWork: TaskDateWriter = async (taskId, dates) => {
  const result = await updateTaskAction({ taskId, startDate: dates.startDate, dueDate: dates.dueDate });
  if (!result.ok) throw new ActionError(result.error === "failed" ? (result.message ?? "generic") : result.error);
};

const movePipeline = createAction({
  name: "projects.timeline.move",
  input: z.object({ taskId: z.uuid(), startDate: optional(isoDate), dueDate: optional(isoDate), shiftDependents: checkbox.default(false) }),
  // Dragging a bar is editing the task's dates; every dependent shifted is checked the same way inside.
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task?.work.projectId && canEditTask(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const result = await moveTimelineTask(await loadViewer(user), input, writeThroughWork);
    refresh(result.projectId);
    const shape = (key: "from" | "to") => Object.fromEntries(result.applied.map((change) => [change.taskId, change[key]]));
    return {
      data: { moved: result.applied.length, shifted: Math.max(0, result.applied.length - 1), leftAlone: result.leftAlone },
      audit: { resource: { type: "task:work", id: input.taskId }, summary: `timeline move, ${result.plan.shiftDays} working days; ${input.shiftDependents ? `${result.plan.shifts.length} dependents shifted` : `${result.leftAlone} dependents left`}`, before: shape("from"), after: shape("to") },
    };
  },
});
export async function moveTimelineTaskAction(input: unknown) {
  return movePipeline(input);
}

// ── Baselines (FR-PJM-12) ───────────────────────────────────────────────────────────────────

const rebaselinePipeline = createAction({
  name: "projects.baseline.rebaseline",
  input: z.object({ projectId: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => may(user, input.projectId, canRebaseline),
  run: async ({ input }) => {
    const change = await rebaseline(input.projectId);
    refresh(input.projectId);
    // The replaced baseline lives on here, and only here: this record is the history of the yardstick.
    return { data: { tasks: change.after.tasks.length }, audit: { resource: auditProject(input.projectId), summary: `re-baselined: ${input.reason}`.slice(0, 300), before: { ...change.before, reason: input.reason }, after: change.after } };
  },
});
export async function rebaselineAction(input: unknown) {
  return rebaselinePipeline(input);
}

// ── Bookings (FR-PJM-13) ────────────────────────────────────────────────────────────────────

const bookingHours = z.coerce.number().min(0.5).max(80).transform((value) => Math.round(value * 60));
const bookPipeline = createAction({
  name: "projects.booking.create",
  input: z.object({
    projectId: z.uuid(),
    personId: optional(z.uuid()),
    placeholderRole: text(80),
    weekStart: isoDate,
    hours: bookingHours,
    status: z.enum(BOOKING_STATUSES),
    note: text(300),
    weeks: z.coerce.number().int().min(1).max(26).default(1),
  }),
  authorize: (user, input) => may(user, input.projectId, canManageBookings),
  run: async ({ user, input }) => {
    const { projectId, hours, ...rest } = input;
    const { created, changed } = await bookWeeks(projectId, { ...rest, minutes: hours }, { personId: user.person.id, fullName: user.person.fullName });
    refresh(projectId);
    revalidatePath("/projects/capacity");
    return { data: { created: created.length, changed: changed.length }, audit: { resource: auditProject(projectId), summary: `booking: ${input.personId ?? input.placeholderRole} × ${created.length + changed.length} weeks from ${input.weekStart}`, before: changed.length ? { bookings: changed.map((row) => row.before) } : undefined, after: { bookings: [...created, ...changed.map((row) => row.after)] } } };
  },
});
export async function bookAction(input: unknown) {
  return bookPipeline(input);
}

const updateBookingPipeline = createAction({
  name: "projects.booking.update",
  input: z.object({ bookingId: z.uuid(), hours: bookingHours, status: z.enum(BOOKING_STATUSES), note: text(300) }),
  authorize: async (user, input) => may(user, (await findBooking(input.bookingId))?.projectId ?? null, canManageBookings),
  run: async ({ user, input }) => {
    const { before, after } = await updateBooking(input.bookingId, { minutes: input.hours, status: input.status, note: input.note }, { personId: user.person.id, fullName: user.person.fullName });
    refresh(after.projectId);
    revalidatePath("/projects/capacity");
    return { data: { id: after.id }, audit: { resource: auditProject(after.projectId), summary: `booking ${after.weekStart}: ${after.minutes / 60} h ${after.status}`, before, after } };
  },
});
export async function updateBookingAction(input: unknown) {
  return updateBookingPipeline(input);
}

const deleteBookingPipeline = createAction({
  name: "projects.booking.delete",
  input: z.object({ bookingId: z.uuid() }),
  authorize: async (user, input) => may(user, (await findBooking(input.bookingId))?.projectId ?? null, canManageBookings),
  run: async ({ user, input }) => {
    const row = await deleteBooking(input.bookingId, { personId: user.person.id, fullName: user.person.fullName });
    refresh(row.projectId);
    revalidatePath("/projects/capacity");
    return { data: { id: row.id }, audit: { resource: auditProject(row.projectId), summary: `booking removed: ${row.weekStart}`, before: row } };
  },
});
export async function deleteBookingAction(input: unknown) {
  return deleteBookingPipeline(input);
}

const fillPipeline = createAction({
  name: "projects.booking.fill",
  input: z.object({ projectId: z.uuid(), placeholderRole: z.string().trim().min(1).max(80), personId: z.uuid(), fromWeek: optional(isoDate) }),
  authorize: (user, input) => may(user, input.projectId, canManageBookings),
  run: async ({ user, input }) => {
    const { projectId, ...rest } = input;
    const { filled, merged } = await fillPlaceholder(projectId, rest, { personId: user.person.id, fullName: user.person.fullName });
    refresh(projectId);
    revalidatePath("/projects/capacity");
    return { data: { filled: filled.length, merged }, audit: { resource: auditProject(projectId), summary: `placeholder filled: ${input.placeholderRole} → ${input.personId} (${filled.length} weeks)`, before: { bookings: filled.map((row) => row.before) }, after: { bookings: filled.map((row) => row.after) } } };
  },
});
export async function fillPlaceholderAction(input: unknown) {
  return fillPipeline(input);
}
