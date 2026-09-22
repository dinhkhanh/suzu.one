// Change requests (FR-PJM-11): numbered per project, drafted by the account manager or whoever
// runs the project, approved through the approval engine, applied in the decision's transaction.
//
// The flow: the project's lead (or the owning team's leads) approves; a change that moves the fee
// also needs a `pjm:commercial` holder over the project's entity — a second step whose condition
// is the fee. The engine falls back to the owners when a step finds nobody, and an administrator's
// configured flow for the type replaces both, as for every other request type.
//
// Applied: register lines added (marked with the change) or cancelled, the hours budget, the fee
// and the project's due date moved — and the figures found just before are kept on the change, so
// the history reads original + changes = current.
import "server-only";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestTypeDefinition, type RequestView, resubmitRequest, submitRequest, withdrawRequest } from "../platform/approvals/service";
import { notify } from "../platform/notifications/service";
import { can, type Principal } from "../platform/rbac/policy";
import { applyChange, type ChangeLedger, changeLedger, changeProblems, type ChangeRequester, type ChangeStatus, changeEditable, hasFeeChange, withoutFee } from "./engine/change-request";
import { ensurePlan } from "./plans";
import type { ChangeImpact } from "./schema";

export type ChangeRow = typeof schema.projectChangeRequest.$inferSelect;
export type ChangeRequestPayload = { projectId: string; changeId: string; number: number; title: string; feeChange: boolean };

export const changeRequestType = defineRequestType({
  type: "project_change",
  flow: {
    steps: [
      { key: "project_lead", mode: "any", approvers: [{ rule: "permission", permission: "work:manage" }] },
      { key: "commercial", mode: "any", approvers: [{ rule: "permission", permission: "pjm:commercial" }], condition: { field: "feeChange", op: "eq", value: true } },
    ],
  },
  conditionFields: ["feeChange"],
  // A change moves scope, hours and perhaps the fee: it is read before it is approved.
  bulkApprovable: () => false,
  canView: (viewer: Principal) => can(viewer, "work:manage", {}),
});

/** The type with the project's leads — else the owning team's — named on the first step. */
const changeFlowFor = (leadIds: readonly string[]): RequestTypeDefinition => ({
  ...changeRequestType,
  flow: { steps: changeRequestType.flow.steps.map((step, index) => (index === 0 && leadIds.length ? { ...step, approvers: leadIds.map((personId) => ({ rule: "person" as const, personId })) } : step)) },
});

export const findChange = async (changeId: string): Promise<ChangeRow | undefined> => (await db().select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, changeId)).limit(1))[0];

async function lockChange(tx: Tx, changeId: string): Promise<ChangeRow> {
  const [row] = await tx.select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, changeId)).limit(1).for("update");
  if (!row) throw new ActionError("change_not_found");
  return row;
}

// ── Drafting ────────────────────────────────────────────────────────────────────────────────

export type ChangeInput = {
  title: string;
  description: string | null;
  requestedBy: ChangeRequester;
  impact: Omit<ChangeImpact, "applied">;
  evidenceFileId: string | null;
  evidenceUrl: string | null;
};

/**
 * A new draft (numbered under the plan's lock, so two drafts never share a number) or an edit of
 * one still in draft. `withFee` false = the author may not touch money: a fee delta already on the
 * change is kept as it was, and none is taken from the input.
 */
export async function saveChange(projectId: string, changeId: string | null, input: ChangeInput, actorPersonId: string, options: { withFee: boolean }): Promise<{ before: ChangeRow | null; after: ChangeRow }> {
  return db().transaction(async (tx) => {
    await ensurePlan(projectId, tx);
    await tx.select({ id: schema.projectPlan.projectId }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).for("update");
    const cancelIds = [...new Set(input.impact.cancelDeliverableIds ?? [])];
    if (cancelIds.length) {
      const owned = await tx.select({ id: schema.projectDeliverable.id }).from(schema.projectDeliverable).where(and(eq(schema.projectDeliverable.projectId, projectId), inArray(schema.projectDeliverable.id, cancelIds)));
      if (owned.length !== cancelIds.length) throw new ActionError("deliverable_not_found");
    }
    const before = changeId ? await lockChange(tx, changeId) : null;
    if (before && (before.projectId !== projectId || !changeEditable(before.status as ChangeStatus))) throw new ActionError("change_locked");
    const { feeDeltaVnd, ...rest } = input.impact;
    const fee = options.withFee ? feeDeltaVnd : before?.impact.feeDeltaVnd;
    const impact: ChangeImpact = { ...rest, cancelDeliverableIds: cancelIds.length ? cancelIds : undefined, ...(fee ? { feeDeltaVnd: fee } : {}) };
    const values = { title: input.title, description: input.description, requestedBy: input.requestedBy, impact: JSON.parse(JSON.stringify(impact)) as ChangeImpact, evidenceFileId: input.evidenceFileId, evidenceUrl: input.evidenceUrl, updatedAt: new Date() };
    if (before) {
      const [after] = await tx.update(schema.projectChangeRequest).set(values).where(eq(schema.projectChangeRequest.id, before.id)).returning();
      return { before, after };
    }
    const [top] = await tx.select({ value: max(schema.projectChangeRequest.number) }).from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.projectId, projectId));
    const [after] = await tx
      .insert(schema.projectChangeRequest)
      .values({ projectId, number: (top?.value ?? 0) + 1, ...values, createdByPersonId: actorPersonId })
      .returning();
    return { before: null, after };
  });
}

// ── Approval ────────────────────────────────────────────────────────────────────────────────

/** The project's leads, else the owning team's leads — whoever answers for the plan, the author aside. */
async function leadsFor(tx: Tx, project: { id: string; teamId: string }, authorPersonId: string): Promise<string[]> {
  const projectLeads = await tx.select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, project.id), eq(schema.workProjectMember.role, "lead")));
  const own = projectLeads.map((row) => row.personId).filter((id) => id !== authorPersonId);
  if (own.length) return own;
  const teamLeads = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, project.teamId), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.createdAt));
  return teamLeads.map((row) => row.personId).filter((id) => id !== authorPersonId);
}

/**
 * Sends a draft to approval — or, after a return, the same request round again. A lead who is
 * also the author is not asked about their own change: the step falls to the team's leads, then
 * the owners.
 */
export async function submitChange(changeId: string, actorPersonId: string): Promise<{ change: ChangeRow; requestId: string; resubmitted: boolean }> {
  return db().transaction(async (tx) => {
    const change = await lockChange(tx, changeId);
    if (!changeEditable(change.status as ChangeStatus)) throw new ActionError("change_locked");
    const problems = changeProblems({ title: change.title, requestedBy: change.requestedBy as ChangeRequester, impact: change.impact, evidenceFileId: change.evidenceFileId, evidenceUrl: change.evidenceUrl });
    if (problems.length) throw new ActionError(problems[0], { problems });
    const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, change.projectId)).limit(1);
    const plan = await ensurePlan(change.projectId, tx);
    const payload: ChangeRequestPayload = { projectId: change.projectId, changeId: change.id, number: change.number, title: change.title, feeChange: hasFeeChange(change.impact) };
    const summary = [plan.jobNumber, `CR-${change.number}`, change.title].filter(Boolean).join(" · ").slice(0, 300);

    const [returned] = change.approvalRequestId ? await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, change.approvalRequestId), eq(schema.approvalRequest.status, "returned"), eq(schema.approvalRequest.requesterPersonId, actorPersonId))).limit(1) : [];
    if (returned) {
      await resubmitRequest(tx, changeRequestType, returned.id, actorPersonId, { summary, payload });
      const [after] = await tx.update(schema.projectChangeRequest).set({ status: "submitted", updatedAt: new Date() }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
      return { change: after, requestId: returned.id, resubmitted: true };
    }

    const leads = await leadsFor(tx, project, actorPersonId);
    const { request, outcome } = await submitRequest(tx, changeFlowFor(leads), {
      entityId: project.entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: null,
      subjectType: "project_change_request",
      subjectId: change.id,
      summary,
      payload,
      conditionData: { feeChange: payload.feeChange },
      link: `/projects/${change.projectId}/changes`,
      target: { entityId: project.entityId },
    });
    let [after] = await tx.update(schema.projectChangeRequest).set({ status: "submitted", approvalRequestId: request.id, updatedAt: new Date() }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
    // A configured flow with no step that applies approves at once.
    if (outcome === "approved") after = await applyApproved(tx, after, new Date());
    return { change: after, requestId: request.id, resubmitted: false };
  });
}

/** The effect of an approved change, inside the decision's transaction. */
async function applyApproved(tx: Tx, change: ChangeRow, now: Date): Promise<ChangeRow> {
  const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, change.projectId)).limit(1).for("update");
  await ensurePlan(change.projectId, tx);
  const [plan] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, change.projectId)).limit(1).for("update");
  const found = { budgetMinutes: plan.budgetMinutes, feeVnd: plan.feeVnd, dueDate: project.dueDate };
  const next = applyChange(found, change.impact);

  const lines = change.impact.deliverables ?? [];
  if (lines.length) {
    await tx.insert(schema.projectDeliverable).values(lines.map((line, index) => ({ projectId: change.projectId, changeRequestId: change.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: next.dueDate, sortOrder: 900 + index })));
  }
  const cancel = change.impact.cancelDeliverableIds ?? [];
  if (cancel.length) {
    await tx
      .update(schema.projectDeliverable)
      .set({ cancelledAt: now, updatedAt: now })
      .where(and(eq(schema.projectDeliverable.projectId, change.projectId), inArray(schema.projectDeliverable.id, cancel)));
  }
  // A budget that moved can warn again at 80% and 100% of its new size.
  const budgetMoved = next.budgetMinutes !== found.budgetMinutes;
  await tx
    .update(schema.projectPlan)
    .set({ budgetMinutes: next.budgetMinutes, feeVnd: next.feeVnd, ...(budgetMoved ? { budgetAlerted: [] } : {}), updatedAt: now })
    .where(eq(schema.projectPlan.projectId, change.projectId));
  if (next.dueDate !== found.dueDate) await tx.update(schema.workProject).set({ dueDate: next.dueDate, updatedAt: now }).where(eq(schema.workProject.id, change.projectId));

  const impact: ChangeImpact = { ...change.impact, applied: { budgetMinutesBefore: found.budgetMinutes, feeVndBefore: found.feeVnd, dueDateBefore: found.dueDate } };
  const [after] = await tx.update(schema.projectChangeRequest).set({ status: "approved", impact, appliedAt: now, updatedAt: now }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
  return after;
}

export type ChangeDecision = { action: "approve" | "reject" | "return"; comment: string | null };

/**
 * An approver's answer. Approved at the last step → applied now. Rejected → closed; returned →
 * the author's draft again, and the same request goes round when they send it back. The author
 * hears the outcome of a decided change.
 */
export async function decideChange(actorPersonId: string, requestId: string, decision: ChangeDecision): Promise<{ change: ChangeRow; outcome: string; entityId: string | null; before: { status: string } }> {
  return db().transaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, changeRequestType, requestId, actorPersonId, decision);
    const { changeId } = request.payload as ChangeRequestPayload;
    let change = await lockChange(tx, changeId);
    if (change.approvalRequestId !== request.id) throw new ActionError("approval_not_found");
    const now = new Date();
    if (outcome === "approved") change = await applyApproved(tx, change, now);
    else if (outcome === "rejected") [change] = await tx.update(schema.projectChangeRequest).set({ status: "rejected", updatedAt: now }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
    else if (outcome === "returned") [change] = await tx.update(schema.projectChangeRequest).set({ status: "draft", updatedAt: now }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
    if (outcome === "approved" || outcome === "rejected") {
      const [project] = await tx.select({ name: schema.workProject.name }).from(schema.workProject).where(eq(schema.workProject.id, change.projectId)).limit(1);
      if (change.createdByPersonId !== actorPersonId) await notify({ recipients: [change.createdByPersonId], kind: "projects.change_decided", params: { title: change.title, project: project?.name ?? "" }, link: `/projects/${change.projectId}/changes` }, tx);
    }
    return { change, outcome, entityId: request.entityId, before: { status: before.status } };
  });
}

/** The author takes a change back while it waits (or after a return). */
export async function withdrawChange(changeId: string, actorPersonId: string): Promise<{ before: ChangeRow; after: ChangeRow }> {
  return db().transaction(async (tx) => {
    const before = await lockChange(tx, changeId);
    if (before.status !== "submitted" && before.status !== "draft") throw new ActionError("change_locked");
    if (before.approvalRequestId) {
      const [request] = await tx.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, before.approvalRequestId)).limit(1);
      if (request?.status === "pending" || request?.status === "returned") await withdrawRequest(tx, before.approvalRequestId, actorPersonId);
    }
    const [after] = await tx.update(schema.projectChangeRequest).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(schema.projectChangeRequest.id, changeId)).returning();
    return { before, after };
  });
}

/**
 * The engine's own inbox can withdraw or cancel a request without this module hearing: a change
 * whose request is no longer pending, and was not decided here, is brought in line when read.
 */
async function syncChanges(rows: ChangeRow[]): Promise<ChangeRow[]> {
  const waiting = rows.filter((row) => row.status === "submitted" && row.approvalRequestId);
  if (waiting.length === 0) return rows;
  const requests = await db().select({ id: schema.approvalRequest.id, status: schema.approvalRequest.status }).from(schema.approvalRequest).where(inArray(schema.approvalRequest.id, waiting.map((row) => row.approvalRequestId!)));
  const statusOf = new Map(requests.map((row) => [row.id, row.status]));
  const synced = new Map<string, ChangeRow>();
  for (const row of waiting) {
    const status = statusOf.get(row.approvalRequestId!);
    const next = status === "withdrawn" || status === "cancelled" ? "withdrawn" : status === "returned" ? "draft" : null;
    if (!next) continue;
    const [after] = await db()
      .update(schema.projectChangeRequest)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(schema.projectChangeRequest.id, row.id), eq(schema.projectChangeRequest.status, "submitted")))
      .returning();
    if (after) synced.set(after.id, after);
  }
  return rows.map((row) => synced.get(row.id) ?? row);
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type ChangeView = ChangeRow & { authorName: string | null; cancelTitles: string[] };

/** A project's changes, newest first. The fee delta and the fee found are taken out for a reader without `pjm:commercial`. */
export async function listChanges(projectId: string, seesFees: boolean): Promise<ChangeView[]> {
  const rows = await db()
    .select({ change: schema.projectChangeRequest, authorName: schema.person.fullName })
    .from(schema.projectChangeRequest)
    .leftJoin(schema.person, eq(schema.person.id, schema.projectChangeRequest.createdByPersonId))
    .where(eq(schema.projectChangeRequest.projectId, projectId))
    .orderBy(desc(schema.projectChangeRequest.number));
  const synced = await syncChanges(rows.map((row) => row.change));
  const cancelIds = [...new Set(synced.flatMap((row) => row.impact.cancelDeliverableIds ?? []))];
  const titles = cancelIds.length ? new Map((await db().select({ id: schema.projectDeliverable.id, title: schema.projectDeliverable.title }).from(schema.projectDeliverable).where(inArray(schema.projectDeliverable.id, cancelIds))).map((row) => [row.id, row.title])) : new Map<string, string>();
  return synced.map((change, index) => ({
    ...change,
    impact: seesFees ? change.impact : withoutFee(change.impact),
    authorName: rows[index].authorName,
    cancelTitles: (change.impact.cancelDeliverableIds ?? []).map((id) => titles.get(id) ?? "—"),
  }));
}

/** Original + changes = current, for the project's figures. The fee is left out entirely without `pjm:commercial`. */
export async function getChangeLedger(projectId: string, seesFees: boolean): Promise<ChangeLedger> {
  const plan = await ensurePlan(projectId);
  const [project] = await db().select({ dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  const applied = await db().select().from(schema.projectChangeRequest).where(and(eq(schema.projectChangeRequest.projectId, projectId), eq(schema.projectChangeRequest.status, "approved"))).orderBy(asc(schema.projectChangeRequest.appliedAt));
  const ledger = changeLedger({ budgetMinutes: plan.budgetMinutes, feeVnd: plan.feeVnd, dueDate: project?.dueDate ?? null }, applied);
  if (seesFees) return ledger;
  const strip = <Figures extends { feeVnd: number | null }>(figures: Figures) => ({ ...figures, feeVnd: null });
  return { original: strip(ledger.original), current: strip(ledger.current), steps: ledger.steps.map((step) => ({ ...step, impact: withoutFee(step.impact), after: strip(step.after) })) };
}

/** The change request as the viewer may see it; null = none, or none of their business. */
export async function getChangeRequest(viewer: { personId: string; principal: Principal }, change: Pick<ChangeRow, "approvalRequestId">): Promise<RequestView | null> {
  return change.approvalRequestId ? getRequest(viewer, changeRequestType, change.approvalRequestId) : null;
}

/** A project's change whose evidence file this is — for opening it. */
export async function changeWithEvidence(projectId: string, fileId: string): Promise<ChangeRow | undefined> {
  const [row] = await db().select().from(schema.projectChangeRequest).where(and(eq(schema.projectChangeRequest.projectId, projectId), eq(schema.projectChangeRequest.evidenceFileId, fileId))).limit(1);
  return row;
}

/**
 * For an approver who may not open the project itself — the commercial step's finance approver,
 * or the owners asked on a private project: the changes they are asked about, nothing else. The
 * fee is there only for a reader with `pjm:commercial` over the project's entity. null = not a party.
 */
export async function openChangesForApprover(viewer: { personId: string; principal: Principal }, projectId: string): Promise<{ projectName: string; jobNumber: string | null; seesFees: boolean; changes: (ChangeView & { request: RequestView })[] } | null> {
  const [project] = await db().select({ name: schema.workProject.name, entityId: schema.workProject.entityId, jobNumber: schema.projectPlan.jobNumber }).from(schema.workProject).leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id)).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project) return null;
  const seesFees = can(viewer.principal, "pjm:commercial", { entityId: project.entityId });
  const changes: (ChangeView & { request: RequestView })[] = [];
  for (const change of await listChanges(projectId, seesFees)) {
    const request = await getChangeRequest(viewer, change);
    if (request) changes.push({ ...change, request });
  }
  return changes.length ? { projectName: project.name, jobNumber: project.jobNumber, seesFees, changes } : null;
}
