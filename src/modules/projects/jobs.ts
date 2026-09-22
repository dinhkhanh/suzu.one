// The project layer's scheduled jobs. Each is safe to run again the same day: plans are made once,
// milestone reminders are marked on the milestone, budget alerts on the plan, quota alerts on the
// retainer month, and a status reminder is not sent twice for the same overdue update.
import "server-only";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { JobDefinition } from "../platform/jobs/service";
import { notify } from "../platform/notifications/service";
import { alertsDue } from "./engine/budget";
import { milestoneReminder, updateDueOn } from "./engine/status";
import { loadBurns } from "./metrics";
import { backfillPlans } from "./plans";
import { runRetainers, sendQuotaAlerts } from "./retainers";

const RUNNING = ["planned", "active", "paused"];
const formatDate = (date: IsoDate) => date.split("-").reverse().join("/");

async function leadsOf(projectIds: readonly string[], roles: readonly string[] = ["lead"]): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db().select({ projectId: schema.workProjectMember.projectId, personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(inArray(schema.workProjectMember.projectId, [...projectIds]), inArray(schema.workProjectMember.role, [...roles])));
  const result = new Map<string, string[]>();
  for (const row of rows) result.set(row.projectId, [...(result.get(row.projectId) ?? []), row.personId]);
  return result;
}

/** Milestones due within the lead days, and milestones missed (FR-PJM-04): the owner and the project's leads, once each. */
export async function sendMilestoneReminders(today: IsoDate): Promise<{ dueSoon: number; missed: number }> {
  const rows = await db()
    .select({ milestone: schema.projectMilestone, projectName: schema.workProject.name })
    .from(schema.projectMilestone)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectMilestone.projectId))
    .where(and(isNull(schema.projectMilestone.doneAt), inArray(schema.workProject.status, RUNNING)));
  const due = rows.flatMap((row) => {
    const kind = milestoneReminder({ dueDate: row.milestone.dueDate, done: false, notified: row.milestone.notified }, today);
    return kind ? [{ ...row, kind }] : [];
  });
  const leads = await leadsOf([...new Set(due.map((row) => row.milestone.projectId))]);
  const sent = { due_soon: 0, missed: 0 };
  for (const { milestone, projectName, kind } of due) {
    await db().transaction(async (tx) => {
      // Marked under the row's lock: a second run finds the mark and sends nothing.
      const [fresh] = await tx.select({ notified: schema.projectMilestone.notified }).from(schema.projectMilestone).where(eq(schema.projectMilestone.id, milestone.id)).limit(1).for("update");
      if (!fresh || fresh.notified.includes(kind)) return;
      await tx.update(schema.projectMilestone).set({ notified: [...fresh.notified, kind] }).where(eq(schema.projectMilestone.id, milestone.id));
      const recipients = [...new Set([milestone.ownerPersonId, ...(leads.get(milestone.projectId) ?? [])].filter((id): id is string => !!id))];
      await notify({ recipients, kind: kind === "due_soon" ? "projects.milestone_due" : "projects.milestone_missed", params: { milestone: milestone.name, project: projectName, date: formatDate(milestone.dueDate!) }, link: `/projects/${milestone.projectId}/plan` }, tx);
      sent[kind] += 1;
    });
  }
  return { dueSoon: sent.due_soon, missed: sent.missed };
}

/** Hours burn at 80% and 100% of the budget (FR-PJM-09): the lead and the account manager, once per threshold. */
export async function sendBudgetAlerts(): Promise<{ alerts: number }> {
  const rows = await db()
    .select({ plan: schema.projectPlan, projectName: schema.workProject.name })
    .from(schema.projectPlan)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectPlan.projectId))
    .where(inArray(schema.workProject.status, RUNNING));
  const budgeted = rows.filter((row) => row.plan.budgetMinutes && row.plan.budgetMinutes > 0);
  const burns = await loadBurns(budgeted.map((row) => row.plan.projectId), new Map(budgeted.map((row) => [row.plan.projectId, row.plan.budgetMinutes])));
  const leads = await leadsOf(budgeted.map((row) => row.plan.projectId), ["lead", "account_manager"]);
  let alerts = 0;
  for (const { plan, projectName } of budgeted) {
    const burn = burns.get(plan.projectId);
    if (alertsDue(burn?.percent ?? null, plan.budgetAlerted).length === 0) continue;
    await db().transaction(async (tx) => {
      const [fresh] = await tx.select({ alerted: schema.projectPlan.budgetAlerted }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, plan.projectId)).limit(1).for("update");
      const crossed = alertsDue(burn?.percent ?? null, fresh?.alerted ?? []);
      if (crossed.length === 0) return;
      await tx.update(schema.projectPlan).set({ budgetAlerted: [...(fresh?.alerted ?? []), ...crossed].sort((a, b) => a - b) }).where(eq(schema.projectPlan.projectId, plan.projectId));
      await notify({ recipients: leads.get(plan.projectId) ?? [], kind: "projects.budget_alert", params: { project: projectName, percent: burn!.percent! }, link: `/projects/${plan.projectId}/budget` }, tx);
      alerts += 1;
    });
  }
  return { alerts };
}

/**
 * A status update is due (FR-PJM-27): the project's leads hear it once per overdue update — the
 * reminder is not repeated until a new update has been posted and fallen due again.
 */
export async function sendStatusReminders(today: IsoDate): Promise<{ reminded: number }> {
  const rows = await db()
    .select({ plan: schema.projectPlan, projectName: schema.workProject.name, status: schema.workProject.status })
    .from(schema.projectPlan)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectPlan.projectId))
    .where(eq(schema.workProject.status, "active"));
  const due = rows.flatMap((row) => {
    const dueOn = updateDueOn({ projectStatus: row.status, lastUpdateOn: row.plan.healthUpdatedAt ? todayInVietnam(row.plan.healthUpdatedAt) : null, since: todayInVietnam(row.plan.briefApprovedAt ?? row.plan.createdAt), cadenceDays: row.plan.updateCadenceDays });
    return dueOn && dueOn <= today ? [{ ...row, dueOn }] : [];
  });
  const leads = await leadsOf(due.map((row) => row.plan.projectId));
  let reminded = 0;
  for (const { plan, projectName, dueOn } of due) {
    const link = `/projects/${plan.projectId}/updates`;
    // Anything sent since the update fell due (a day's margin for the time zone) counts as sent.
    const [already] = await db()
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(and(eq(schema.notification.kind, "projects.status_due"), eq(schema.notification.link, link), gte(schema.notification.createdAt, new Date(`${addDays(dueOn, -1)}T00:00:00Z`))))
      .limit(1);
    if (already) continue;
    const recipients = leads.get(plan.projectId) ?? [];
    if (recipients.length === 0) continue;
    await notify({ recipients, kind: "projects.status_due", params: { project: projectName }, link });
    reminded += 1;
  }
  return { reminded };
}

/** At midnight: every project has its plan and job number before anyone opens the portfolio. */
export const projectPlansJob: JobDefinition = { name: "project-plans", run: () => backfillPlans() };

/** In the morning: milestones, budget and retainer quota alerts, status updates due — read with the day's first coffee. */
export const projectRemindersJob: JobDefinition = {
  name: "project-reminders",
  run: async ({ today }) => ({ ...(await sendMilestoneReminders(today)), ...(await sendBudgetAlerts()), ...(await sendStatusReminders(today)), quota: await sendQuotaAlerts() }),
};

/**
 * At midnight (FR-PJM-06, 56): every active retainer gets its months up to this one — a missed
 * night is caught up, oldest month first — and the months that ended are closed with their fee
 * handed to finance. Safe to run again: each month and each fee item is made once.
 */
export const projectRetainersJob: JobDefinition = { name: "project-retainers", run: ({ today }) => runRetainers(today) };
