// READ-ONLY aggregates over the PJM tables (work, projects, daily) for the delivery dashboards
// (FR-PJM-60), the KPI actuals proposed from work (FR-PJM-62) and profitability (FR-PJM-63).
//
// These aggregates are not exported by `work/service.ts`, `projects/service.ts` or
// `daily/service.ts` yet, so they are written here, in one clearly named file, as GROUP BY /
// FILTER queries that return counts and sums. Nothing in this file writes. When the owning
// modules grow equivalents, each function here should move behind their service.
//
// No authorization inside: every caller passes ids it has already decided the reader may see
// (projects from `listPortfolio`, teams from the reader's own reach) or runs as a job.
import "server-only";
import { and, between, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";

type Range = { from: IsoDate; to: IsoDate };
const vnDate = (column: unknown) => sql`(${column} at time zone 'Asia/Ho_Chi_Minh')::date`;

export type TaskCounts = { completedDated: number; completedOnTime: number; completedTasks: number; revisionRounds: number };

/** Per assignee: work tasks completed in the range, how many had a due date and met it, and their revision rounds. */
export async function taskCountsByAssignee(personIds: readonly string[], range: Range): Promise<Map<string, TaskCounts>> {
  if (personIds.length === 0) return new Map();
  const completedOn = vnDate(schema.task.completedAt);
  const rows = await db()
    .select({
      personId: schema.task.assigneePersonId,
      completedTasks: sql<number>`count(*)::int`,
      completedDated: sql<number>`count(*) filter (where ${schema.task.dueDate} is not null)::int`,
      completedOnTime: sql<number>`count(*) filter (where ${schema.task.dueDate} is not null and ${completedOn} <= ${schema.task.dueDate})::int`,
      revisionRounds: sql<number>`coalesce(sum(greatest(0, ${schema.workTask.revisionRounds})), 0)::int`,
    })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .where(and(inArray(schema.task.assigneePersonId, [...personIds]), eq(schema.task.status, "done"), isNull(schema.task.deletedAt), sql`${completedOn} between ${range.from}::date and ${range.to}::date`))
    .groupBy(schema.task.assigneePersonId);
  return new Map(rows.flatMap((row) => (row.personId ? [[row.personId, { completedTasks: Number(row.completedTasks), completedDated: Number(row.completedDated), completedOnTime: Number(row.completedOnTime), revisionRounds: Number(row.revisionRounds) }] as const] : [])));
}

/**
 * Per assignee: distinct tasks whose deliverable was accepted in the range — an internal approval
 * of a version, or the client's approval (with or without changes) recorded on it (FR-PJM-51).
 */
export async function acceptedDeliverablesByAssignee(personIds: readonly string[], range: Range): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const accepted = sql`(
    (${schema.workDeliverable.decision} = 'approved' and ${vnDate(schema.workDeliverable.decidedAt)} between ${range.from}::date and ${range.to}::date)
    or exists (
      select 1 from work_deliverable_decision dd
      where dd.deliverable_id = ${schema.workDeliverable.id} and dd.is_client and dd.decision in ('approved', 'approved_with_changes')
        and (dd.created_at at time zone 'Asia/Ho_Chi_Minh')::date between ${range.from}::date and ${range.to}::date
    ))`;
  const rows = await db()
    .select({ personId: schema.task.assigneePersonId, accepted: sql<number>`count(distinct ${schema.task.id})::int` })
    .from(schema.task)
    .innerJoin(schema.workDeliverable, eq(schema.workDeliverable.taskId, schema.task.id))
    .where(and(inArray(schema.task.assigneePersonId, [...personIds]), isNull(schema.task.deletedAt), accepted))
    .groupBy(schema.task.assigneePersonId);
  return new Map(rows.flatMap((row) => (row.personId ? [[row.personId, Number(row.accepted)] as const] : [])));
}

/** Per person: minutes logged on days in the range. Sums only. */
export async function loggedMinutesByPerson(personIds: readonly string[], range: Range): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const rows = await db()
    .select({ personId: schema.timeEntry.personId, minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int` })
    .from(schema.timeEntry)
    .where(and(inArray(schema.timeEntry.personId, [...personIds]), isNull(schema.timeEntry.deletedAt), between(schema.timeEntry.date, range.from, range.to)))
    .groupBy(schema.timeEntry.personId);
  return new Map(rows.map((row) => [row.personId, Number(row.minutes)]));
}

/** Per person: the dates in the range with a submitted end-of-day report. */
export async function submittedReportDates(personIds: readonly string[], range: Range): Promise<Map<string, Set<IsoDate>>> {
  const result = new Map<string, Set<IsoDate>>();
  if (personIds.length === 0) return result;
  const rows = await db()
    .select({ personId: schema.dailyReport.personId, dates: sql<IsoDate[]>`array_agg(${schema.dailyReport.date}::text order by ${schema.dailyReport.date})` })
    .from(schema.dailyReport)
    .where(and(inArray(schema.dailyReport.personId, [...personIds]), eq(schema.dailyReport.status, "submitted"), gte(schema.dailyReport.date, range.from), lte(schema.dailyReport.date, range.to)))
    .groupBy(schema.dailyReport.personId);
  for (const row of rows) result.set(row.personId, new Set(row.dates));
  return result;
}

// ── Delivery dashboards (FR-PJM-60): per project, for projects the reader may open ─────────

const inProjects = (projectIds: readonly string[]) => sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `);
/** An instant range for timestamps: the period's first day 00:00 to the day after its last, Vietnam time. */
const instants = (range: Range) => ({ from: sql`(${range.from}::date)::timestamp at time zone 'Asia/Ho_Chi_Minh'`, to: sql`((${range.to}::date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')` });

export type MilestoneRow = { projectId: string; total: number; baselined: number; slipped: number; slipDays: number; overdue: number };

/**
 * Milestones per project against the baseline taken at kick-off (`project_plan.baseline`): how
 * many have a baseline date, how many moved past it and by how many days in all, and how many are
 * open past their date today.
 */
export async function milestoneCountsByProject(projectIds: readonly string[], today: IsoDate): Promise<Map<string, MilestoneRow>> {
  if (projectIds.length === 0) return new Map();
  const baselineDue = sql`(select (m->>'dueDate')::date from jsonb_array_elements(coalesce(${schema.projectPlan.baseline}->'milestones', '[]'::jsonb)) m where m->>'id' = ${schema.projectMilestone.id}::text limit 1)`;
  const rows = await db()
    .select({
      projectId: schema.projectMilestone.projectId,
      total: sql<number>`count(*)::int`,
      baselined: sql<number>`count(*) filter (where ${baselineDue} is not null and ${schema.projectMilestone.dueDate} is not null)::int`,
      slipped: sql<number>`count(*) filter (where ${schema.projectMilestone.dueDate} > ${baselineDue})::int`,
      slipDays: sql<number>`coalesce(sum(greatest(${schema.projectMilestone.dueDate} - ${baselineDue}, 0)), 0)::int`,
      overdue: sql<number>`count(*) filter (where ${schema.projectMilestone.doneAt} is null and ${schema.projectMilestone.dueDate} < ${today}::date)::int`,
    })
    .from(schema.projectMilestone)
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.projectMilestone.projectId))
    .where(inArray(schema.projectMilestone.projectId, [...projectIds]))
    .groupBy(schema.projectMilestone.projectId);
  return new Map(rows.map((row) => [row.projectId, { projectId: row.projectId, total: Number(row.total), baselined: Number(row.baselined), slipped: Number(row.slipped), slipDays: Number(row.slipDays), overdue: Number(row.overdue) }]));
}

/** Tasks of each project completed in the period: all, those with a due date, and those done by it. */
export async function onTimeCountsByProject(projectIds: readonly string[], range: Range): Promise<Map<string, { completed: number; dated: number; onTime: number }>> {
  if (projectIds.length === 0) return new Map();
  const completedOn = vnDate(schema.task.completedAt);
  const rows = await db()
    .select({
      projectId: schema.workTask.projectId,
      completed: sql<number>`count(*)::int`,
      dated: sql<number>`count(*) filter (where ${schema.task.dueDate} is not null)::int`,
      onTime: sql<number>`count(*) filter (where ${schema.task.dueDate} is not null and ${completedOn} <= ${schema.task.dueDate})::int`,
    })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .where(and(inArray(schema.workTask.projectId, [...projectIds]), eq(schema.task.status, "done"), isNull(schema.task.deletedAt), sql`${completedOn} between ${range.from}::date and ${range.to}::date`))
    .groupBy(schema.workTask.projectId);
  return new Map(rows.flatMap((row) => (row.projectId ? [[row.projectId, { completed: Number(row.completed), dated: Number(row.dated), onTime: Number(row.onTime) }] as const] : [])));
}

/**
 * Revision rounds per project in the period, internal and client apart (FR-PJM-51): every
 * "changes required" decision on a deliverable version, by who decided it. A version reviewed
 * before review chains existed has its decision on the version only; it counts as internal.
 */
export async function revisionCountsByProject(projectIds: readonly string[], range: Range): Promise<Map<string, { reviewedTasks: number; internalRounds: number; clientRounds: number }>> {
  if (projectIds.length === 0) return new Map();
  const { from, to } = instants(range);
  const rows = rowsOf<{ project_id: string; reviewed_tasks: number; internal_rounds: number; client_rounds: number }>(
    await db().execute(sql`
      with decisions as (
        select wt.project_id, d.task_id, dd.is_client, dd.decision
        from work_deliverable_decision dd
        join work_deliverable d on d.id = dd.deliverable_id
        join work_task wt on wt.task_id = d.task_id
        where wt.project_id in (${inProjects(projectIds)}) and dd.created_at >= ${from} and dd.created_at < ${to}
        union all
        select wt.project_id, d.task_id, false, 'changes_required'
        from work_deliverable d
        join work_task wt on wt.task_id = d.task_id
        where wt.project_id in (${inProjects(projectIds)}) and d.decision = 'changes_requested'
          and d.decided_at >= ${from} and d.decided_at < ${to}
          and not exists (select 1 from work_deliverable_decision x where x.deliverable_id = d.id)
      )
      select project_id,
        count(distinct task_id)::int as reviewed_tasks,
        count(*) filter (where not is_client and decision = 'changes_required')::int as internal_rounds,
        count(*) filter (where is_client and decision = 'changes_required')::int as client_rounds
      from decisions group by project_id`),
  );
  return new Map(rows.map((row) => [row.project_id, { reviewedTasks: Number(row.reviewed_tasks), internalRounds: Number(row.internal_rounds), clientRounds: Number(row.client_rounds) }]));
}

/**
 * Stage and cross-team hand-offs of each project's tasks sent in the period (FR-PJM-41): how many,
 * how many came back, how many still wait, and the minutes answered ones waited in all.
 */
export async function handoffCountsByProject(projectIds: readonly string[], range: Range): Promise<Map<string, { total: number; returned: number; pending: number; answered: number; waitMinutes: number }>> {
  if (projectIds.length === 0) return new Map();
  const { from, to } = instants(range);
  const rows = await db()
    .select({
      projectId: schema.workTask.projectId,
      total: sql<number>`count(*)::int`,
      returned: sql<number>`count(*) filter (where ${schema.workHandoff.status} = 'returned')::int`,
      pending: sql<number>`count(*) filter (where ${schema.workHandoff.status} = 'pending')::int`,
      answered: sql<number>`count(*) filter (where ${schema.workHandoff.respondedAt} is not null)::int`,
      waitMinutes: sql<number>`coalesce(round(sum(extract(epoch from (${schema.workHandoff.respondedAt} - ${schema.workHandoff.createdAt})) / 60) filter (where ${schema.workHandoff.respondedAt} is not null)), 0)::int`,
    })
    .from(schema.workHandoff)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workHandoff.taskId))
    .where(and(inArray(schema.workTask.projectId, [...projectIds]), inArray(schema.workHandoff.kind, ["stage", "cross_team"]), sql`${schema.workHandoff.createdAt} >= ${from} and ${schema.workHandoff.createdAt} < ${to}`))
    .groupBy(schema.workTask.projectId);
  return new Map(rows.flatMap((row) => (row.projectId ? [[row.projectId, { total: Number(row.total), returned: Number(row.returned), pending: Number(row.pending), answered: Number(row.answered), waitMinutes: Number(row.waitMinutes) }] as const] : [])));
}

/**
 * Blocked time per project (FR-PJM-28): blockers raised in the period, those still open, and the
 * minutes tasks spent blocked *inside* the period — an open blocker counted up to now, one raised
 * before the period from the period's start (`blockedMinutesWithin` is the same rule, tested).
 */
export async function blockedCountsByProject(projectIds: readonly string[], range: Range): Promise<Map<string, { blockers: number; open: number; blockedMinutes: number }>> {
  if (projectIds.length === 0) return new Map();
  const { from, to } = instants(range);
  const start = sql`greatest(${schema.workBlocker.raisedAt}, ${from})`;
  const end = sql`least(coalesce(${schema.workBlocker.resolvedAt}, now()), ${to}, now())`;
  const rows = await db()
    .select({
      projectId: schema.workTask.projectId,
      blockers: sql<number>`count(*) filter (where ${schema.workBlocker.raisedAt} >= ${from})::int`,
      open: sql<number>`count(*) filter (where ${schema.workBlocker.resolvedAt} is null)::int`,
      blockedMinutes: sql<number>`coalesce(round(sum(greatest(extract(epoch from (${end} - ${start})), 0)) / 60), 0)::int`,
    })
    .from(schema.workBlocker)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workBlocker.taskId))
    .where(and(inArray(schema.workTask.projectId, [...projectIds]), sql`${schema.workBlocker.raisedAt} < ${to}`, sql`(${schema.workBlocker.resolvedAt} is null or ${schema.workBlocker.resolvedAt} >= ${from})`))
    .groupBy(schema.workTask.projectId);
  return new Map(rows.flatMap((row) => (row.projectId ? [[row.projectId, { blockers: Number(row.blockers), open: Number(row.open), blockedMinutes: Number(row.blockedMinutes) }] as const] : [])));
}

/** Active members of these work teams, per team. */
export async function activeMembersByTeam(teamIds: readonly string[]): Promise<Map<string, string[]>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db()
    .select({ teamId: schema.workTeamMember.teamId, personId: schema.workTeamMember.personId })
    .from(schema.workTeamMember)
    .innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId))
    .where(and(inArray(schema.workTeamMember.teamId, [...teamIds]), eq(schema.person.status, "active")));
  const result = new Map<string, string[]>();
  for (const row of rows) result.set(row.teamId, [...(result.get(row.teamId) ?? []), row.personId]);
  return result;
}

/** Timesheet weeks submitted or approved, as "personId:weekStart" keys. A returned week is not among them. */
export async function submittedTimesheetWeeks(personIds: readonly string[], weekStarts: readonly IsoDate[]): Promise<Set<string>> {
  if (personIds.length === 0 || weekStarts.length === 0) return new Set();
  const rows = await db()
    .select({ personId: schema.timesheetWeek.personId, weekStart: schema.timesheetWeek.weekStart })
    .from(schema.timesheetWeek)
    .where(and(inArray(schema.timesheetWeek.personId, [...personIds]), inArray(schema.timesheetWeek.weekStart, [...weekStarts]), inArray(schema.timesheetWeek.status, ["submitted", "approved"])));
  return new Set(rows.map((row) => `${row.personId}:${row.weekStart}`));
}

// ── Profitability (FR-PJM-63): time and fees per project ────────────────────────────────────

export type ProjectTimeRow = { projectId: string; personId: string; month: string; teamId: string | null; minutes: number };

/**
 * Minutes per project, person, month and the team whose task it was — the finest grain the cost
 * needs. **Never returned to a screen**: `reports/profitability.ts` turns it into sums at once.
 */
export async function loggedMinutesByProjectPersonMonth(projectIds: readonly string[], range: Range): Promise<ProjectTimeRow[]> {
  if (projectIds.length === 0) return [];
  const onProject = sql<string>`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId})`;
  const month = sql<string>`to_char(${schema.timeEntry.date}, 'YYYY-MM')`;
  const rows = await db()
    .select({ projectId: onProject, personId: schema.timeEntry.personId, month, teamId: schema.workTask.teamId, minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int` })
    .from(schema.timeEntry)
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .where(and(isNull(schema.timeEntry.deletedAt), between(schema.timeEntry.date, range.from, range.to), sql`${onProject} in (${inProjects(projectIds)})`))
    .groupBy(onProject, schema.timeEntry.personId, month, schema.workTask.teamId);
  return rows.map((row) => ({ ...row, minutes: Number(row.minutes) }));
}

export type ProjectFeeRow = { projectId: string; feeVnd: number | null; retainer: { feePerMonthVnd: number | null; startMonth: string; endMonth: string | null } | null; invoicedVnd: number };

/** What each project earns: its fee, its retainer's monthly fee, and billing items invoiced in the period. */
export async function feesByProject(projectIds: readonly string[], range: Range): Promise<Map<string, ProjectFeeRow>> {
  if (projectIds.length === 0) return new Map();
  const [plans, retainers, invoiced] = await Promise.all([
    db().select({ projectId: schema.projectPlan.projectId, feeVnd: schema.projectPlan.feeVnd }).from(schema.projectPlan).where(inArray(schema.projectPlan.projectId, [...projectIds])),
    db().select({ projectId: schema.projectRetainer.projectId, feePerMonthVnd: schema.projectRetainer.feePerMonthVnd, startMonth: schema.projectRetainer.startMonth, endMonth: schema.projectRetainer.endMonth }).from(schema.projectRetainer).where(inArray(schema.projectRetainer.projectId, [...projectIds])),
    db()
      .select({ projectId: schema.projectBillingItem.projectId, amount: sql<number>`coalesce(sum(${schema.projectBillingItem.amountVnd}), 0)::bigint` })
      .from(schema.projectBillingItem)
      .where(and(inArray(schema.projectBillingItem.projectId, [...projectIds]), eq(schema.projectBillingItem.status, "invoiced"), between(schema.projectBillingItem.invoiceDate, range.from, range.to)))
      .groupBy(schema.projectBillingItem.projectId),
  ]);
  const retainerOf = new Map(retainers.map((row) => [row.projectId, row]));
  const invoicedOf = new Map(invoiced.map((row) => [row.projectId, Number(row.amount)]));
  const feeOf = new Map(plans.map((row) => [row.projectId, row.feeVnd]));
  return new Map(
    projectIds.map((projectId) => {
      const retainer = retainerOf.get(projectId);
      return [projectId, { projectId, feeVnd: feeOf.get(projectId) ?? null, retainer: retainer ? { feePerMonthVnd: retainer.feePerMonthVnd, startMonth: retainer.startMonth, endMonth: retainer.endMonth } : null, invoicedVnd: invoicedOf.get(projectId) ?? 0 }];
    }),
  );
}

/**
 * Every project of these entities (a null entity = a group project), with its team, client and
 * privacy. The owning team's own place comes with it, so that a caller can ask the work policy
 * whether this reader may open the project (`canViewProject`) without a second query.
 */
export async function projectsOfEntities(reach: { all: true } | { all: false; entityIds: string[] }): Promise<{ id: string; name: string; teamId: string; teamName: string; teamEntityId: string | null; teamDepartmentId: string | null; teamDefaultVisibility: string; entityId: string | null; clientId: string | null; clientName: string | null; visibility: string; status: string; jobNumber: string | null }[]> {
  if (!reach.all && reach.entityIds.length === 0) return [];
  return db()
    .select({ id: schema.workProject.id, name: schema.workProject.name, teamId: schema.workProject.teamId, teamName: schema.workTeam.name, teamEntityId: schema.workTeam.entityId, teamDepartmentId: schema.workTeam.departmentId, teamDefaultVisibility: schema.workTeam.defaultVisibility, entityId: schema.workProject.entityId, clientId: schema.workProject.clientId, clientName: schema.workClient.name, visibility: schema.workProject.visibility, status: schema.workProject.status, jobNumber: schema.projectPlan.jobNumber })
    .from(schema.workProject)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
    .where(reach.all ? undefined : inArray(schema.workProject.entityId, reach.entityIds));
}
