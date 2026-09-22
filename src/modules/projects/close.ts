// Close-out (FR-PJM-59): the checklist computed live, the close itself — refused while items are
// unmet unless the lead says why — the final report kept on the plan, and the retrospective, whose
// lessons may be published to a knowledge-base space the author can write in.
//
// A closed project's status is "done" and its plan is read-only from then on: the policy's
// `closed` fact (`PlanFacts`) turns every plan edit off, whoever asks.
import "server-only";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { rulesOfPeople, sumLoggedMinutesByProject } from "../daily/service";
import { canCreatePage, createPage, type Doc, type DocNode, type KbViewer, loadSpace } from "../kb/service";
import { countOpenBilling } from "./billing";
import { adapterReturnedHandoffs, adapterRevisionRounds } from "./delivery-adapter";
import { type ChecklistItem, type CloseFacts, closeChecklist, closeRefusal, type CloseReport, closeReport, unmetChecks } from "./engine/close";
import { withLineStatus } from "./metrics";
import { ensurePlan, type PlanRow } from "./plans";
import type { MeetingRetro } from "./schema";

export type MeetingRow = typeof schema.projectMeeting.$inferSelect;

// ── The checklist ───────────────────────────────────────────────────────────────────────────

/**
 * Weeks with time on the project that still wait for approval: of the people whose team asks for
 * timesheet approval, every (person, week) with minutes on the project whose week is not approved.
 */
async function unapprovedWeeks(projectId: string): Promise<number> {
  const weeks = await db()
    .selectDistinct({ personId: schema.timeEntry.personId, weekStart: schema.timeEntry.weekStart })
    .from(schema.timeEntry)
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .where(and(isNull(schema.timeEntry.deletedAt), sql`${schema.timeEntry.minutes} > 0`, sql`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId}) = ${projectId}`));
  if (weeks.length === 0) return 0;
  const rules = await rulesOfPeople(weeks.map((row) => row.personId));
  const required = weeks.filter((row) => rules.get(row.personId)?.rules.timesheetApproval);
  if (required.length === 0) return 0;
  const approved = await db()
    .select({ personId: schema.timesheetWeek.personId, weekStart: schema.timesheetWeek.weekStart })
    .from(schema.timesheetWeek)
    .where(and(inArray(schema.timesheetWeek.personId, [...new Set(required.map((row) => row.personId))]), eq(schema.timesheetWeek.status, "approved")));
  const done = new Set(approved.map((row) => `${row.personId}:${row.weekStart}`));
  return required.filter((row) => !done.has(`${row.personId}:${row.weekStart}`)).length;
}

export async function loadCloseFacts(projectId: string, plan: Pick<PlanRow, "driveUrl">): Promise<CloseFacts> {
  const [tasks, lines, weeks, billing, retro] = await Promise.all([
    db()
      .select({ value: count() })
      .from(schema.workTask)
      .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
      .where(and(eq(schema.workTask.projectId, projectId), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress"]))),
    db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, projectId)).then(withLineStatus),
    unapprovedWeeks(projectId),
    countOpenBilling(db(), projectId),
    db().select({ id: schema.projectMeeting.id }).from(schema.projectMeeting).where(and(eq(schema.projectMeeting.projectId, projectId), eq(schema.projectMeeting.kind, "retro"))).limit(1),
  ]);
  return {
    openTasks: tasks[0]?.value ?? 0,
    openLines: lines.filter((line) => line.status !== "cancelled" && line.accepted < line.promised).length,
    unapprovedWeeks: weeks,
    openBillingItems: billing,
    driveUrl: plan.driveUrl,
    retroHeld: retro.length > 0,
  };
}

export async function getCloseChecklist(projectId: string): Promise<ChecklistItem[]> {
  return closeChecklist(await loadCloseFacts(projectId, await ensurePlan(projectId)));
}

// ── Closing ─────────────────────────────────────────────────────────────────────────────────

const dayInVietnam = (value: Date | null): IsoDate | null => (value ? todayInVietnam(value) : null);

async function buildReport(projectId: string, plan: PlanRow, closedOn: IsoDate): Promise<CloseReport> {
  const [[project], logged, rounds, returned, tasks, milestones] = await Promise.all([
    db().select({ startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1),
    sumLoggedMinutesByProject([projectId]),
    adapterRevisionRounds(projectId),
    adapterReturnedHandoffs(projectId),
    db()
      .select({ status: schema.task.status, dueDate: schema.task.dueDate, completedAt: schema.task.completedAt })
      .from(schema.workTask)
      .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
      .where(and(eq(schema.workTask.projectId, projectId), isNull(schema.task.deletedAt))),
    db().select({ id: schema.projectMilestone.id, dueDate: schema.projectMilestone.dueDate, doneAt: schema.projectMilestone.doneAt }).from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, projectId)),
  ]);
  return closeReport({
    closedOn,
    baseline: plan.baseline,
    startDate: project?.startDate ?? null,
    dueDate: project?.dueDate ?? null,
    budgetMinutes: plan.budgetMinutes,
    loggedMinutes: logged.get(projectId)?.minutes ?? 0,
    revisionRounds: rounds,
    returnedHandoffs: returned,
    tasks: tasks.map((task) => ({ status: task.status, dueDate: task.dueDate, completedOn: dayInVietnam(task.completedAt) })),
    milestones: milestones.map((milestone) => ({ id: milestone.id, dueDate: milestone.dueDate, doneOn: dayInVietnam(milestone.doneAt) })),
  });
}

/** The report as it would read if the project closed today — for the close page before the button. */
export async function previewCloseReport(projectId: string): Promise<CloseReport> {
  return buildReport(projectId, await ensurePlan(projectId), todayInVietnam());
}

export type StoredCloseReport = CloseReport & { unmet: string[]; overrideReason: string | null };

/**
 * Closes the project: refused with items unmet unless a reason is given (the action audits it with
 * the close); the report is kept on the plan; the project becomes "done". Once.
 */
export async function closeProject(projectId: string, input: { overrideReason: string | null }, actorPersonId: string): Promise<{ plan: PlanRow; report: StoredCloseReport; projectStatusBefore: string }> {
  const plan = await ensurePlan(projectId);
  if (plan.closedAt) throw new ActionError("project_closed");
  const checklist = closeChecklist(await loadCloseFacts(projectId, plan));
  const refusal = closeRefusal(checklist, input.overrideReason);
  if (refusal) throw new ActionError(refusal, { unmet: unmetChecks(checklist) });
  const unmet = unmetChecks(checklist);
  const report: StoredCloseReport = { ...(await buildReport(projectId, plan, todayInVietnam())), unmet, overrideReason: unmet.length ? (input.overrideReason?.trim() ?? null) : null };
  return db().transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1).for("update");
    if (locked.closedAt) throw new ActionError("project_closed");
    const [project] = await tx.select({ status: schema.workProject.status }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1).for("update");
    const now = new Date();
    const [after] = await tx.update(schema.projectPlan).set({ closedAt: now, closedByPersonId: actorPersonId, closeReport: report, updatedAt: now }).where(eq(schema.projectPlan.projectId, projectId)).returning();
    await tx.update(schema.workProject).set({ status: "done", updatedAt: now }).where(eq(schema.workProject.id, projectId));
    return { plan: after, report, projectStatusBefore: project?.status ?? "" };
  });
}

// ── The retrospective ───────────────────────────────────────────────────────────────────────

export const getRetro = async (projectId: string): Promise<MeetingRow | undefined> => (await db().select().from(schema.projectMeeting).where(and(eq(schema.projectMeeting.projectId, projectId), eq(schema.projectMeeting.kind, "retro"))).limit(1))[0];

export type RetroInput = { title: string; heldOn: IsoDate; attendeeIds: string[]; retro: MeetingRetro };

/** One retrospective per project: held once, edited as the team's thoughts settle. */
export async function saveRetro(projectId: string, input: RetroInput, actorPersonId: string): Promise<{ before: MeetingRow | null; after: MeetingRow }> {
  if (input.heldOn > todayInVietnam()) throw new ActionError("retro_in_future");
  const before = (await getRetro(projectId)) ?? null;
  if (before) {
    const [after] = await db().update(schema.projectMeeting).set({ ...input, updatedAt: new Date() }).where(eq(schema.projectMeeting.id, before.id)).returning();
    return { before, after };
  }
  const [after] = await db()
    .insert(schema.projectMeeting)
    .values({ projectId, kind: "retro", ...input, createdByPersonId: actorPersonId })
    .returning();
  return { before: null, after };
}

/** The retrospective as a knowledge-base page: a heading per part, a paragraph per line. */
export function retroDoc(retro: MeetingRetro, headings: { wentWell: string; improve: string; actions: string }): Doc {
  const text = (value: string): DocNode[] => [{ type: "text", text: value }];
  const content: DocNode[] = [];
  for (const key of ["wentWell", "improve", "actions"] as const) {
    const lines = (retro[key] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    content.push({ type: "heading", attrs: { level: 2 }, content: text(headings[key]) });
    for (const line of lines) content.push({ type: "paragraph", content: text(line) });
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * Publishes the lessons (FR-PJM-59) as a draft page in a knowledge-base space the author may add
 * pages to: the KB's own rules decide, and its review flow publishes it — a controlled space's
 * managers see it before anyone else reads it.
 */
export async function publishLessons(viewer: KbViewer, projectId: string, spaceId: string, title: string, headings: { wentWell: string; improve: string; actions: string }): Promise<{ pageId: string; spaceKey: string }> {
  const retro = await getRetro(projectId);
  if (!retro?.retro) throw new ActionError("retro_missing");
  const space = await loadSpace({ id: spaceId });
  if (!space || space.space.archivedAt) throw new ActionError("kb_space_not_found");
  if (!canCreatePage(viewer, space.facts, null)) throw new ActionError("forbidden");
  const page = await createPage({ spaceId, parentId: null, title, content: retroDoc(retro.retro, headings) }, { personId: viewer.personId });
  return { pageId: page.id, spaceKey: space.space.key };
}
