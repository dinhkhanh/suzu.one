// The timeline (FR-CRM-05): an account's history on one feed, read from where each thing is
// recorded — CRM activities and deals, and from PJM the projects, status updates, client decisions,
// deliveries, signed acceptances, client meetings and approved change requests — never copied. Each
// source is limited to what the reader may already open: PJM items only for projects the reader
// may view, CRM activities only for someone who works the account, invoices and payments only for
// someone who reads receivables. Every item links to its own record.
import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { activityLink } from "./activities";

export const TIMELINE_KINDS = [
  "activity",
  "deal_opened",
  "deal_won",
  "deal_lost",
  "quote_sent",
  "contract_signed",
  "project_opened",
  "project_closed",
  "status_update",
  "client_decision",
  "delivery",
  "acceptance_signed",
  "client_meeting",
  "change_approved",
  "invoice",
  "payment",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineItem = {
  key: string;
  kind: TimelineKind;
  at: string;
  title: string;
  /** A second line: an outcome, a health, a decision, a stage. A key the page translates where it says so. */
  detail: string | null;
  actorName: string | null;
  projectName: string | null;
  link: string | null;
};

export type TimelineScope = {
  /** The account and its brands. */
  clientIds: readonly string[];
  /** The account's client id (CRM rows are recorded on it). */
  accountId: string;
  /** Projects of the account the reader may open. */
  projectIds: readonly string[];
  worksAccount: boolean;
  seesReceivables: boolean;
  /** Only this deal's items (the deal page). */
  dealId?: string;
};

const iso = (value: Date | string | null): string => (value instanceof Date ? value.toISOString() : value ? new Date(`${value}T12:00:00+07:00`).toISOString() : new Date(0).toISOString());

/** The newest `limit` items across every source the reader may read, newest first. */
export async function accountTimeline(scope: TimelineScope, limit = 60): Promise<TimelineItem[]> {
  const projectIds = scope.dealId ? [] : [...scope.projectIds];
  const actor = alias(schema.person, "timeline_actor");
  const each = Math.max(10, limit);
  const sources: Promise<TimelineItem[]>[] = [];

  if (scope.worksAccount) {
    sources.push(
      db()
        .select({ activity: schema.crmActivity, actorName: actor.fullName })
        .from(schema.crmActivity)
        .leftJoin(actor, eq(actor.id, schema.crmActivity.ownerPersonId))
        .where(and(eq(schema.crmActivity.clientId, scope.accountId), isNotNull(schema.crmActivity.doneAt), scope.dealId ? eq(schema.crmActivity.dealId, scope.dealId) : undefined))
        .orderBy(desc(schema.crmActivity.doneAt))
        .limit(each)
        .then((rows) =>
          rows.map(({ activity, actorName }) => ({ key: `a:${activity.id}`, kind: "activity" as const, at: iso(activity.occurredAt ?? activity.doneAt), title: activity.subject, detail: activity.outcome ?? activity.kind, actorName, projectName: null, link: activityLink(activity) })),
        ),
    );
    sources.push(
      db()
        .select({ deal: schema.crmDeal, actorName: actor.fullName })
        .from(schema.crmDeal)
        .leftJoin(actor, eq(actor.id, schema.crmDeal.ownerPersonId))
        .where(and(eq(schema.crmDeal.clientId, scope.accountId), scope.dealId ? eq(schema.crmDeal.id, scope.dealId) : undefined))
        .orderBy(desc(schema.crmDeal.createdAt))
        .limit(each)
        .then((rows) =>
          rows.flatMap(({ deal, actorName }) => {
            const link = `/crm/deals/${deal.id}`;
            const items: TimelineItem[] = [{ key: `do:${deal.id}`, kind: "deal_opened", at: iso(deal.createdAt), title: deal.title, detail: deal.code, actorName, projectName: null, link }];
            if (deal.wonAt) items.push({ key: `dw:${deal.id}`, kind: "deal_won", at: iso(deal.wonAt), title: deal.title, detail: deal.code, actorName, projectName: null, link });
            if (deal.lostAt) items.push({ key: `dl:${deal.id}`, kind: "deal_lost", at: iso(deal.lostAt), title: deal.title, detail: deal.lostReason, actorName, projectName: null, link });
            return items;
          }),
        ),
    );
    sources.push(
      db()
        .select({ id: schema.crmQuote.id, dealId: schema.crmQuote.dealId, number: schema.crmQuote.number, version: schema.crmQuote.version, title: schema.crmQuote.title, sentAt: schema.crmQuote.sentAt, status: schema.crmQuote.status })
        .from(schema.crmQuote)
        .innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmQuote.dealId))
        .where(and(eq(schema.crmDeal.clientId, scope.accountId), isNotNull(schema.crmQuote.sentAt), scope.dealId ? eq(schema.crmDeal.id, scope.dealId) : undefined))
        .orderBy(desc(schema.crmQuote.sentAt))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `q:${row.id}`, kind: "quote_sent" as const, at: iso(row.sentAt), title: `${row.number} v${row.version} · ${row.title}`, detail: row.status, actorName: null, projectName: null, link: `/crm/deals/${row.dealId}/quotes/${row.id}` }))),
    );
    if (!scope.dealId)
      sources.push(
        db()
          .select({ id: schema.crmContract.id, number: schema.crmContract.number, title: schema.crmContract.title, signedOn: schema.crmContract.signedOn })
          .from(schema.crmContract)
          .where(and(eq(schema.crmContract.clientId, scope.accountId), isNotNull(schema.crmContract.signedOn)))
          .orderBy(desc(schema.crmContract.signedOn))
          .limit(each)
          .then((rows) => rows.map((row) => ({ key: `c:${row.id}`, kind: "contract_signed" as const, at: iso(row.signedOn), title: `${row.number} · ${row.title}`, detail: null, actorName: null, projectName: null, link: `/crm/contracts/${row.id}` }))),
      );
  }

  if (projectIds.length) {
    const inProjects = inArray(schema.workProject.id, projectIds);
    sources.push(
      db()
        .select({ id: schema.workProject.id, name: schema.workProject.name, createdAt: schema.workProject.createdAt, closedAt: schema.projectPlan.closedAt, jobNumber: schema.projectPlan.jobNumber })
        .from(schema.workProject)
        .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
        .where(inProjects)
        .then((rows) =>
          rows.flatMap((row) => {
            const items: TimelineItem[] = [{ key: `po:${row.id}`, kind: "project_opened", at: iso(row.createdAt), title: row.name, detail: row.jobNumber, actorName: null, projectName: row.name, link: `/projects/${row.id}` }];
            if (row.closedAt) items.push({ key: `pc:${row.id}`, kind: "project_closed", at: iso(row.closedAt), title: row.name, detail: row.jobNumber, actorName: null, projectName: row.name, link: `/projects/${row.id}/close` });
            return items;
          }),
        ),
      db()
        .select({ id: schema.projectStatusUpdate.id, projectId: schema.projectStatusUpdate.projectId, health: schema.projectStatusUpdate.health, summary: schema.projectStatusUpdate.summary, at: schema.projectStatusUpdate.createdAt, projectName: schema.workProject.name, actorName: actor.fullName })
        .from(schema.projectStatusUpdate)
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectStatusUpdate.projectId))
        .leftJoin(actor, eq(actor.id, schema.projectStatusUpdate.authorPersonId))
        .where(inProjects)
        .orderBy(desc(schema.projectStatusUpdate.createdAt))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `s:${row.id}`, kind: "status_update" as const, at: iso(row.at), title: noteToPlainText(row.summary).replace(/\n/g, " ").slice(0, 200), detail: row.health, actorName: row.actorName, projectName: row.projectName, link: `/projects/${row.projectId}/updates` }))),
      db()
        .select({ id: schema.workDeliverableDecision.id, decision: schema.workDeliverableDecision.decision, at: schema.workDeliverableDecision.createdAt, taskId: schema.workTask.taskId, taskTitle: schema.task.title, projectName: schema.workProject.name, actorName: actor.fullName })
        .from(schema.workDeliverableDecision)
        .innerJoin(schema.workDeliverable, eq(schema.workDeliverable.id, schema.workDeliverableDecision.deliverableId))
        .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workDeliverable.taskId))
        .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
        .leftJoin(actor, eq(actor.id, schema.workDeliverableDecision.decidedByPersonId))
        .where(and(inProjects, eq(schema.workDeliverableDecision.isClient, true)))
        .orderBy(desc(schema.workDeliverableDecision.createdAt))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `cd:${row.id}`, kind: "client_decision" as const, at: iso(row.at), title: row.taskTitle, detail: row.decision, actorName: row.actorName, projectName: row.projectName, link: `/work/tasks/${row.taskId}` }))),
      db()
        .select({ id: schema.workDelivery.id, at: schema.workDelivery.deliveredOn, createdAt: schema.workDelivery.createdAt, taskId: schema.workDelivery.taskId, taskTitle: schema.task.title, projectName: schema.workProject.name, actorName: actor.fullName })
        .from(schema.workDelivery)
        .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workDelivery.taskId))
        .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
        .leftJoin(actor, eq(actor.id, schema.workDelivery.deliveredByPersonId))
        .where(inProjects)
        .orderBy(desc(schema.workDelivery.deliveredOn))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `dv:${row.id}`, kind: "delivery" as const, at: iso(row.at), title: row.taskTitle, detail: null, actorName: row.actorName, projectName: row.projectName, link: `/work/tasks/${row.taskId}` }))),
      db()
        .select({ id: schema.projectAcceptance.id, projectId: schema.projectAcceptance.projectId, number: schema.projectAcceptance.number, signedOn: schema.projectAcceptance.signedOn, projectName: schema.workProject.name })
        .from(schema.projectAcceptance)
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectAcceptance.projectId))
        .where(and(inProjects, eq(schema.projectAcceptance.status, "signed")))
        .orderBy(desc(schema.projectAcceptance.signedOn))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `ac:${row.id}`, kind: "acceptance_signed" as const, at: iso(row.signedOn), title: `#${row.number}`, detail: null, actorName: null, projectName: row.projectName, link: `/projects/${row.projectId}/acceptance` }))),
      db()
        .select({ id: schema.projectMeeting.id, projectId: schema.projectMeeting.projectId, title: schema.projectMeeting.title, heldOn: schema.projectMeeting.heldOn, projectName: schema.workProject.name })
        .from(schema.projectMeeting)
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectMeeting.projectId))
        .where(and(inProjects, inArray(schema.projectMeeting.kind, ["client", "kickoff"])))
        .orderBy(desc(schema.projectMeeting.heldOn))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `m:${row.id}`, kind: "client_meeting" as const, at: iso(row.heldOn), title: row.title, detail: null, actorName: null, projectName: row.projectName, link: `/projects/${row.projectId}/meetings/${row.id}` }))),
      db()
        .select({ id: schema.projectChangeRequest.id, projectId: schema.projectChangeRequest.projectId, title: schema.projectChangeRequest.title, appliedAt: schema.projectChangeRequest.appliedAt, projectName: schema.workProject.name })
        .from(schema.projectChangeRequest)
        .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectChangeRequest.projectId))
        .where(and(inProjects, eq(schema.projectChangeRequest.status, "approved")))
        .orderBy(desc(schema.projectChangeRequest.appliedAt))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `cr:${row.id}`, kind: "change_approved" as const, at: iso(row.appliedAt), title: row.title, detail: null, actorName: null, projectName: row.projectName, link: `/projects/${row.projectId}/changes` }))),
    );
  }

  if (scope.seesReceivables && !scope.dealId) {
    sources.push(
      db()
        .select({ id: schema.crmInvoice.id, number: schema.crmInvoice.number, issuedOn: schema.crmInvoice.issuedOn })
        .from(schema.crmInvoice)
        .where(eq(schema.crmInvoice.clientId, scope.accountId))
        .orderBy(desc(schema.crmInvoice.issuedOn))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `i:${row.id}`, kind: "invoice" as const, at: iso(row.issuedOn), title: row.number, detail: null, actorName: null, projectName: null, link: `/crm/invoices/${row.id}` }))),
      db()
        .select({ id: schema.crmPayment.id, invoiceId: schema.crmPayment.invoiceId, number: schema.crmInvoice.number, receivedOn: schema.crmPayment.receivedOn })
        .from(schema.crmPayment)
        .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
        .where(eq(schema.crmInvoice.clientId, scope.accountId))
        .orderBy(desc(schema.crmPayment.receivedOn))
        .limit(each)
        .then((rows) => rows.map((row) => ({ key: `p:${row.id}`, kind: "payment" as const, at: iso(row.receivedOn), title: row.number, detail: null, actorName: null, projectName: null, link: `/crm/invoices/${row.invoiceId}` }))),
    );
  }

  const all = (await Promise.all(sources)).flat();
  return all.sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : b.at.localeCompare(a.at))).slice(0, limit);
}

/** Minutes logged on these projects per month over the last `months` months — totals only, never per person. */
export async function hoursByMonth(projectIds: readonly string[], fromMonth: string): Promise<{ month: string; minutes: number; people: number }[]> {
  if (projectIds.length === 0) return [];
  const projectOfEntry = sql`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId})`;
  const month = sql<string>`to_char(${schema.timeEntry.date}, 'YYYY-MM')`;
  const rows = await db()
    .select({ month, minutes: sql<number>`sum(${schema.timeEntry.minutes})`, people: sql<number>`count(distinct ${schema.timeEntry.personId})` })
    .from(schema.timeEntry)
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .where(and(sql`${projectOfEntry} in (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`, sql`${schema.timeEntry.deletedAt} is null`, sql`${month} >= ${fromMonth}`))
    .groupBy(month)
    .orderBy(month);
  return rows.map((row) => ({ month: row.month, minutes: Number(row.minutes), people: Number(row.people) }));
}

/** Client decisions on these projects in a window: how often the client approved, and how often they asked for changes. */
export async function clientDecisionCounts(projectIds: readonly string[], since: Date): Promise<{ approved: number; approvedWithChanges: number; changesRequired: number }> {
  if (projectIds.length === 0) return { approved: 0, approvedWithChanges: 0, changesRequired: 0 };
  const [row] = await db()
    .select({
      approved: sql<number>`count(*) filter (where ${schema.workDeliverableDecision.decision} = 'approved')`,
      approvedWithChanges: sql<number>`count(*) filter (where ${schema.workDeliverableDecision.decision} = 'approved_with_changes')`,
      changesRequired: sql<number>`count(*) filter (where ${schema.workDeliverableDecision.decision} = 'changes_required')`,
    })
    .from(schema.workDeliverableDecision)
    .innerJoin(schema.workDeliverable, eq(schema.workDeliverable.id, schema.workDeliverableDecision.deliverableId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workDeliverable.taskId))
    .where(and(inArray(schema.workTask.projectId, [...projectIds]), eq(schema.workDeliverableDecision.isClient, true), sql`${schema.workDeliverableDecision.createdAt} >= ${since.toISOString()}::timestamptz`));
  return { approved: Number(row?.approved ?? 0), approvedWithChanges: Number(row?.approvedWithChanges ?? 0), changesRequired: Number(row?.changesRequired ?? 0) };
}
