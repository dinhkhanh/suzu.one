// Change requests (FR-PJM-11): numbered per project, drafted by the account manager or whoever
// runs the project, approved through the approval engine, applied in the decision's transaction.
//
// The flow: the project's lead (or the owning team's leads) approves; a change that moves the fee
// also needs a `pjm:commercial` holder over the project's entity — a second step whose condition
// is the fee. The engine falls back to the owners when a step finds nobody, and an administrator's
// configured flow for the type replaces both, as for every other request type.
//
// Applied: register lines added (marked with the change) or cancelled, the hours budget, the fee
// and the project's due date moved, a retainer's monthly scope replaced — and the figures the
// change found and the figures it left are kept on the change itself, so the history reads
// original + changes = current from each change's own record. After the kick-off this is the only
// way scope, hours and fee change (`engine/gates.ts`); what was edited directly before that rule
// shows in the ledger as a difference no change explains.
import "server-only";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestTypeDefinition, type RequestView, resubmitRequest, submitRequest, withdrawRequest } from "../platform/approvals/service";
import { notify } from "../platform/notifications/service";
import { can, type Principal } from "../platform/rbac/policy";
import {
  applyChange,
  type ChangeLedger,
  changeLedger,
  changeProblems,
  type ChangeRequester,
  type ChangeStatus,
  changeEditable,
  hasFeeChange,
  hasRetainerChange,
  ledgerWithoutFee,
  type PlanFigures,
  withoutFee,
} from "./engine/change-request";
import { monthlyQuotaChanged } from "./engine/gates";
import { ensurePlan, readPlan } from "./plans";
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
  // Nobody else reads a change for holding an ordinary permission: a private project's requests stay
  // with its people, its requester and its approvers. The one exception is `pjm:oversee` — the
  // owner's view of every project (decision of 2026-09-28) — which reads and decides nothing. The
  // engine hands over the requester, not the project, so the grant must reach them; the owner's
  // group grant reaches everybody.
  canView: (viewer, subject) => can(viewer, "pjm:oversee", subject ?? {}),
});

/**
 * The type with the project's leads — else the owning team's — named on the first step. With none,
 * a private project's first step names nobody, so the engine asks the owners — never the
 * `work:manage` holders of the default flow, who may not open a private project.
 */
const changeFlowFor = (leadIds: readonly string[], isPrivate: boolean): RequestTypeDefinition => ({
  ...changeRequestType,
  flow: {
    steps: changeRequestType.flow.steps.map((step, index) => {
      if (index !== 0) return step;
      if (leadIds.length) return { ...step, approvers: leadIds.map((personId) => ({ rule: "person" as const, personId })) };
      return isPrivate ? { ...step, approvers: [] } : step;
    }),
  },
});

export const findChange = async (changeId: string): Promise<ChangeRow | undefined> => (await db().select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, changeId)).limit(1))[0];

async function lockChange(tx: Tx, changeId: string): Promise<ChangeRow> {
  const [row] = await tx.select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, changeId)).limit(1).for("update");
  if (!row) throw new ActionError("change_not_found");
  return row;
}

/**
 * The same for the author's own moves (drafting, submitting, withdrawing): a request withdrawn,
 * cancelled or returned from the approvals inbox leaves the change "submitted" until something
 * writes it back, and reads no longer do — so this does, under the row's lock.
 */
const lockOwnChange = async (tx: Tx, changeId: string): Promise<ChangeRow> => reconcileChange(tx, await lockChange(tx, changeId));

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
      const owned = await tx
        .select({ id: schema.projectDeliverable.id })
        .from(schema.projectDeliverable)
        .where(and(eq(schema.projectDeliverable.projectId, projectId), inArray(schema.projectDeliverable.id, cancelIds)));
      if (owned.length !== cancelIds.length) throw new ActionError("deliverable_not_found");
    }
    const before = changeId ? await lockOwnChange(tx, changeId) : null;
    if (before && (before.projectId !== projectId || !changeEditable(before.status as ChangeStatus))) throw new ActionError("change_locked");
    const { feeDeltaVnd, retainer: askedTerms, ...rest } = input.impact;
    const fee = options.withFee ? feeDeltaVnd : before?.impact.feeDeltaVnd;
    const retainer = await retainerTermsOf(tx, projectId, askedTerms, before?.impact.retainer, options.withFee);
    const impact: ChangeImpact = { ...rest, cancelDeliverableIds: cancelIds.length ? cancelIds : undefined, ...(fee ? { feeDeltaVnd: fee } : {}), ...(retainer ? { retainer } : {}) };
    const values = {
      title: input.title,
      description: input.description,
      requestedBy: input.requestedBy,
      impact: JSON.parse(JSON.stringify(impact)) as ChangeImpact,
      evidenceFileId: input.evidenceFileId,
      evidenceUrl: input.evidenceUrl,
      updatedAt: new Date(),
    };
    if (before) {
      const [after] = await tx.update(schema.projectChangeRequest).set(values).where(eq(schema.projectChangeRequest.id, before.id)).returning();
      return { before, after };
    }
    const [top] = await tx
      .select({ value: max(schema.projectChangeRequest.number) })
      .from(schema.projectChangeRequest)
      .where(eq(schema.projectChangeRequest.projectId, projectId));
    const [after] = await tx
      .insert(schema.projectChangeRequest)
      .values({ projectId, number: (top?.value ?? 0) + 1, ...values, createdByPersonId: actorPersonId })
      .returning();
    return { before: null, after };
  });
}

/**
 * The retainer part of a change, cut down to what it really changes: the form posts the whole
 * monthly scope, and only the terms that differ from the retainer as it stands are kept — a change
 * that repeats the current quota changes nothing. The monthly fee is money: taken from the input
 * only for an author who may write fees, kept as the draft had it otherwise.
 */
async function retainerTermsOf(tx: Tx, projectId: string, asked: ChangeImpact["retainer"], drafted: ChangeImpact["retainer"], withFee: boolean): Promise<ChangeImpact["retainer"]> {
  if (!asked) return undefined;
  const [current] = await tx.select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, projectId)).limit(1);
  if (!current) throw new ActionError("retainer_not_retainer_project");
  const terms: NonNullable<ChangeImpact["retainer"]> = {};
  if (asked.lines !== undefined && monthlyQuotaChanged({ lines: current.lines, minutesPerMonth: null }, { lines: asked.lines, minutesPerMonth: null })) {
    const titles = asked.lines.map((line) => line.title.trim().toLowerCase());
    if (asked.lines.length === 0) throw new ActionError("retainer_lines_required");
    // Lines are matched month to month by title: two lines of one title would share a carry.
    if (new Set(titles).size !== titles.length) throw new ActionError("retainer_lines_duplicate");
    terms.lines = asked.lines;
  }
  if (asked.minutesPerMonth !== undefined && (asked.minutesPerMonth ?? null) !== (current.minutesPerMonth ?? null)) terms.minutesPerMonth = asked.minutesPerMonth ?? null;
  const feePerMonth = withFee ? asked.feePerMonthVnd : drafted?.feePerMonthVnd;
  if (feePerMonth !== undefined && (!withFee || (feePerMonth ?? null) !== (current.feePerMonthVnd ?? null))) terms.feePerMonthVnd = feePerMonth ?? null;
  return Object.keys(terms).length ? terms : undefined;
}

// ── Approval ────────────────────────────────────────────────────────────────────────────────

/** The project's leads, else the owning team's leads — whoever answers for the plan, the author aside. */
async function leadsFor(tx: Tx, project: { id: string; teamId: string }, authorPersonId: string): Promise<string[]> {
  const projectLeads = await tx
    .select({ personId: schema.workProjectMember.personId })
    .from(schema.workProjectMember)
    .where(and(eq(schema.workProjectMember.projectId, project.id), eq(schema.workProjectMember.role, "lead")));
  const own = projectLeads.map((row) => row.personId).filter((id) => id !== authorPersonId);
  if (own.length) return own;
  const teamLeads = await tx
    .select({ personId: schema.workTeamMember.personId })
    .from(schema.workTeamMember)
    .where(and(eq(schema.workTeamMember.teamId, project.teamId), eq(schema.workTeamMember.role, "lead")))
    .orderBy(asc(schema.workTeamMember.createdAt));
  return teamLeads.map((row) => row.personId).filter((id) => id !== authorPersonId);
}

/**
 * Sends a draft to approval — or, after a return, the same request round again. A lead who is
 * also the author is not asked about their own change: the step falls to the team's leads, then
 * the owners.
 */
export async function submitChange(changeId: string, actorPersonId: string): Promise<{ change: ChangeRow; requestId: string; resubmitted: boolean }> {
  return db().transaction(async (tx) => {
    const change = await lockOwnChange(tx, changeId);
    if (!changeEditable(change.status as ChangeStatus)) throw new ActionError("change_locked");
    const problems = changeProblems({ title: change.title, requestedBy: change.requestedBy as ChangeRequester, impact: change.impact, evidenceFileId: change.evidenceFileId, evidenceUrl: change.evidenceUrl });
    if (problems.length) throw new ActionError(problems[0], { problems });
    const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, change.projectId)).limit(1);
    const plan = await ensurePlan(change.projectId, tx);
    const payload: ChangeRequestPayload = { projectId: change.projectId, changeId: change.id, number: change.number, title: change.title, feeChange: hasFeeChange(change.impact) };
    const summary = [plan.jobNumber, `CR-${change.number}`, change.title].filter(Boolean).join(" · ").slice(0, 300);

    const [returned] = change.approvalRequestId
      ? await tx
          .select()
          .from(schema.approvalRequest)
          .where(and(eq(schema.approvalRequest.id, change.approvalRequestId), eq(schema.approvalRequest.status, "returned"), eq(schema.approvalRequest.requesterPersonId, actorPersonId)))
          .limit(1)
      : [];
    if (returned) {
      await resubmitRequest(tx, changeRequestType, returned.id, actorPersonId, { summary, payload });
      const [after] = await tx.update(schema.projectChangeRequest).set({ status: "submitted", updatedAt: new Date() }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
      return { change: after, requestId: returned.id, resubmitted: true };
    }

    const leads = await leadsFor(tx, project, actorPersonId);
    const { request, outcome } = await submitRequest(tx, changeFlowFor(leads, project.visibility === "private"), {
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
    await tx
      .insert(schema.projectDeliverable)
      .values(lines.map((line, index) => ({ projectId: change.projectId, changeRequestId: change.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: next.dueDate, sortOrder: 900 + index })));
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

  // A retainer's monthly scope: the terms named replace the retainer's own, from the next month
  // made — a month already made keeps the lines it promised. What they replaced stays on the change.
  let replaced: NonNullable<ChangeImpact["applied"]>["retainer"];
  const terms = change.impact.retainer;
  if (terms && hasRetainerChange(change.impact)) {
    const [retainer] = await tx.select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, change.projectId)).limit(1).for("update");
    if (!retainer) throw new ActionError("retainer_not_retainer_project");
    replaced = { lines: retainer.lines, minutesPerMonth: retainer.minutesPerMonth, feePerMonthVnd: retainer.feePerMonthVnd };
    await tx
      .update(schema.projectRetainer)
      .set({
        ...(terms.lines !== undefined ? { lines: terms.lines } : {}),
        ...(terms.minutesPerMonth !== undefined ? { minutesPerMonth: terms.minutesPerMonth } : {}),
        ...(terms.feePerMonthVnd !== undefined ? { feePerMonthVnd: terms.feePerMonthVnd } : {}),
        updatedAt: now,
      })
      .where(eq(schema.projectRetainer.id, retainer.id));
  }

  // Both ends are kept: the ledger is rebuilt from each change's own before and after.
  const impact: ChangeImpact = { ...change.impact, applied: { budgetMinutesBefore: found.budgetMinutes, feeVndBefore: found.feeVnd, dueDateBefore: found.dueDate, ...(replaced ? { retainer: replaced } : {}) } };
  const [after] = await tx.update(schema.projectChangeRequest).set({ status: "approved", impact, figuresBefore: found, figuresAfter: next, appliedAt: now, updatedAt: now }).where(eq(schema.projectChangeRequest.id, change.id)).returning();
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
      if (change.createdByPersonId !== actorPersonId)
        await notify({ recipients: [change.createdByPersonId], kind: "projects.change_decided", params: { title: change.title, project: project?.name ?? "" }, link: `/projects/${change.projectId}/changes` }, tx);
    }
    return { change, outcome, entityId: request.entityId, before: { status: before.status } };
  });
}

/** The author takes a change back while it waits (or after a return). */
export async function withdrawChange(changeId: string, actorPersonId: string): Promise<{ before: ChangeRow; after: ChangeRow }> {
  return db().transaction(async (tx) => {
    const before = await lockOwnChange(tx, changeId);
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
 * The engine's own inbox can withdraw, cancel or return a request without this module hearing: a
 * submitted change whose request is no longer pending is withdrawn (or, returned, a draft again).
 * null = nothing to change.
 */
export function changeStatusNow(row: Pick<ChangeRow, "status" | "approvalRequestId">, requestStatus: string | null | undefined): ChangeStatus | null {
  if (row.status !== "submitted" || !row.approvalRequestId) return null;
  return requestStatus === "withdrawn" || requestStatus === "cancelled" ? "withdrawn" : requestStatus === "returned" ? "draft" : null;
}

/** `changeStatusNow` written back, inside a change that holds the row's lock. */
async function reconcileChange(tx: Tx, row: ChangeRow): Promise<ChangeRow> {
  if (row.status !== "submitted" || !row.approvalRequestId) return row;
  const [request] = await tx.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, row.approvalRequestId)).limit(1);
  const next = changeStatusNow(row, request?.status);
  if (!next) return row;
  const [after] = await tx.update(schema.projectChangeRequest).set({ status: next, updatedAt: new Date() }).where(eq(schema.projectChangeRequest.id, row.id)).returning();
  return after;
}

/** Reading never writes: the changes as they stand, each status as the engine now has it. */
async function asTheyStand(rows: ChangeRow[]): Promise<ChangeRow[]> {
  const waiting = rows.filter((row) => row.status === "submitted" && row.approvalRequestId);
  if (waiting.length === 0) return rows;
  const requests = await db()
    .select({ id: schema.approvalRequest.id, status: schema.approvalRequest.status })
    .from(schema.approvalRequest)
    .where(
      inArray(
        schema.approvalRequest.id,
        waiting.map((row) => row.approvalRequestId!),
      ),
    );
  const statusOf = new Map(requests.map((row) => [row.id, row.status]));
  return rows.map((row) => {
    const next = changeStatusNow(row, row.approvalRequestId ? statusOf.get(row.approvalRequestId) : null);
    return next ? { ...row, status: next } : row;
  });
}

/** The nightly job's half of the same: every change left "submitted" behind a request that moved on, stored. */
export async function reconcileChanges(): Promise<{ changes: number }> {
  const rows = await db().select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.status, "submitted"));
  const stale = (await asTheyStand(rows)).filter((row) => row.status !== "submitted");
  for (const row of stale) await db().transaction((tx) => lockOwnChange(tx, row.id));
  return { changes: stale.length };
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type ChangeView = ChangeRow & { authorName: string | null; cancelTitles: string[] };

/** A project's changes, newest first. The fee — the delta, the fee found and the fee left — is taken out for a reader without `pjm:commercial`. */
export async function listChanges(projectId: string, seesFees: boolean): Promise<ChangeView[]> {
  const rows = await db()
    .select({ change: schema.projectChangeRequest, authorName: schema.person.fullName })
    .from(schema.projectChangeRequest)
    .leftJoin(schema.person, eq(schema.person.id, schema.projectChangeRequest.createdByPersonId))
    .where(eq(schema.projectChangeRequest.projectId, projectId))
    .orderBy(desc(schema.projectChangeRequest.number));
  const synced = await asTheyStand(rows.map((row) => row.change));
  const cancelIds = [...new Set(synced.flatMap((row) => row.impact.cancelDeliverableIds ?? []))];
  const titles = cancelIds.length
    ? new Map((await db().select({ id: schema.projectDeliverable.id, title: schema.projectDeliverable.title }).from(schema.projectDeliverable).where(inArray(schema.projectDeliverable.id, cancelIds))).map((row) => [row.id, row.title]))
    : new Map<string, string>();
  const noFee = (figures: PlanFigures | null) => (figures && !seesFees ? { ...figures, feeVnd: null } : figures);
  return synced.map((change, index) => ({
    ...change,
    impact: seesFees ? change.impact : withoutFee(change.impact),
    figuresBefore: noFee(change.figuresBefore),
    figuresAfter: noFee(change.figuresAfter),
    authorName: rows[index].authorName,
    cancelTitles: (change.impact.cancelDeliverableIds ?? []).map((id) => titles.get(id) ?? "—"),
  }));
}

/**
 * Original + changes = current, for the project's figures, with a row for every difference no
 * change explains. The original is the kick-off's baseline when it was taken before the first
 * change (the baseline keeps no fee, so the fee starts from what the first change found); a
 * project re-baselined since, or never kicked off, starts from what its first change found. The
 * fee is left out entirely without `pjm:commercial`.
 */
export async function getChangeLedger(projectId: string, seesFees: boolean): Promise<ChangeLedger> {
  const plan = (await readPlan(projectId)) ?? { budgetMinutes: null, feeVnd: null, baseline: null };
  const [project] = await db().select({ dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  const applied = await db()
    .select()
    .from(schema.projectChangeRequest)
    .where(and(eq(schema.projectChangeRequest.projectId, projectId), eq(schema.projectChangeRequest.status, "approved")))
    .orderBy(asc(schema.projectChangeRequest.appliedAt), asc(schema.projectChangeRequest.number));
  const current: PlanFigures = { budgetMinutes: plan.budgetMinutes, feeVnd: plan.feeVnd, dueDate: project?.dueDate ?? null };
  const [first] = applied;
  const firstFee = first ? (first.figuresBefore ?? (first.impact.applied ? { feeVnd: first.impact.applied.feeVndBefore } : null)) : null;
  const atKickoff =
    plan.baseline && (!first?.appliedAt || new Date(plan.baseline.takenAt) <= first.appliedAt) ? { budgetMinutes: plan.baseline.budgetMinutes, dueDate: plan.baseline.dueDate, feeVnd: firstFee ? firstFee.feeVnd : plan.feeVnd } : null;
  const ledger = changeLedger(
    current,
    applied.map((change) => ({ number: change.number, title: change.title, impact: change.impact, before: change.figuresBefore, after: change.figuresAfter })),
    atKickoff,
  );
  return seesFees ? ledger : ledgerWithoutFee(ledger);
}

/** The change request as the viewer may see it; null = none, or none of their business. */
export async function getChangeRequest(viewer: { personId: string; principal: Principal }, change: Pick<ChangeRow, "approvalRequestId">): Promise<RequestView | null> {
  return change.approvalRequestId ? getRequest(viewer, changeRequestType, change.approvalRequestId) : null;
}

/** A project's change whose evidence file this is — for opening it. */
export async function changeWithEvidence(projectId: string, fileId: string): Promise<ChangeRow | undefined> {
  const [row] = await db()
    .select()
    .from(schema.projectChangeRequest)
    .where(and(eq(schema.projectChangeRequest.projectId, projectId), eq(schema.projectChangeRequest.evidenceFileId, fileId)))
    .limit(1);
  return row;
}

/**
 * For an approver who may not open the project itself — the commercial step's finance approver,
 * or the owners asked on a private project — and for whoever oversees projects (`pjm:oversee`): the
 * changes, nothing else. The fee is there only for a reader with `pjm:commercial` over the project's
 * entity. null = neither.
 */
export async function openChangesForApprover(
  viewer: { personId: string; principal: Principal },
  projectId: string,
): Promise<{ projectName: string; jobNumber: string | null; seesFees: boolean; changes: (ChangeView & { request: RequestView })[] } | null> {
  const [project] = await db()
    .select({ name: schema.workProject.name, entityId: schema.workProject.entityId, jobNumber: schema.projectPlan.jobNumber })
    .from(schema.workProject)
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
    .where(eq(schema.workProject.id, projectId))
    .limit(1);
  if (!project) return null;
  const seesFees = can(viewer.principal, "pjm:commercial", { entityId: project.entityId });
  const changes: (ChangeView & { request: RequestView })[] = [];
  for (const change of await listChanges(projectId, seesFees)) {
    const request = await getChangeRequest(viewer, change);
    if (request) changes.push({ ...change, request });
  }
  return changes.length ? { projectName: project.name, jobNumber: project.jobNumber, seesFees, changes } : null;
}
