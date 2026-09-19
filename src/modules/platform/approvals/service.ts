// The approval engine's use-cases (FR-PLT-20..22). A module that needs approvals defines a request
// type (`defineRequestType`), submits requests through `submitRequest` and — because the *effect*
// of an approval is its own business — owns the action that decides them: inside one transaction
// it calls `decideRequest` and, when the outcome is "approved", applies the change. Everything
// here takes that transaction, so a request is never approved without its effect or the reverse.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../notifications/service";
import type { Principal, Target } from "../rbac/policy";
import { type Permission, type Role, ROLES } from "../rbac/roles";
import { listOwnerPersonIds, listPeopleHolding, listPeopleWithRole } from "../rbac/service";
import { canOpenRequest } from "./policy";
import { applyDecision, type ApproverRule, conditionHolds, type DecisionAction, type DecisionResult, type FlowDefinition, type RequestState, type RequestStatus, type ResolvedStep, resubmit, startFlow, waitingFor } from "./engine/flow";

type Executor = Tx | ReturnType<typeof db>;
export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;
export type SubjectTarget = Target & { personId: string };

export type RequestTypeDefinition = {
  /** Stored on every request; also the key of its name in messages (`approvals.types.<type>`). */
  type: string;
  flow: FlowDefinition;
  /** Who may open a request of this type besides its requester and its approvers. */
  canView?: (viewer: Principal, subject: SubjectTarget | null) => boolean;
};

export const defineRequestType = (definition: RequestTypeDefinition): RequestTypeDefinition => definition;

// ── Turning approver rules into people ──────────────────────────────────────────────────────

async function subjectTarget(executor: Executor, personId: string | null): Promise<SubjectTarget | null> {
  if (!personId) return null;
  const [row] = await executor.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return row ? { personId: row.id, entityId: row.primaryEntityId, departmentId: row.departmentId, teamId: row.teamId, managerId: row.managerId } : null;
}

async function managerAt(executor: Executor, personId: string, level: number): Promise<string | null> {
  let cursor: string | null = personId;
  for (let step = 0; cursor && step < level; step++) {
    const [row]: { managerId: string | null }[] = await executor.select({ managerId: schema.person.managerId }).from(schema.person).where(eq(schema.person.id, cursor)).limit(1);
    cursor = row?.managerId ?? null;
  }
  return cursor === personId ? null : cursor;
}

async function peopleFor(executor: Executor, rule: ApproverRule, subject: SubjectTarget | null): Promise<string[]> {
  switch (rule.rule) {
    case "person":
      return [rule.personId];
    case "line_manager":
      return subject?.managerId ? [subject.managerId] : [];
    case "manager_level": {
      const manager = subject ? await managerAt(executor, subject.personId, rule.level) : null;
      return manager ? [manager] : [];
    }
    case "department_head":
      return subject ? listPeopleWithRole("department_head", subject, executor) : [];
    case "role":
      if (!(ROLES as readonly string[]).includes(rule.role)) throw new Error(`unknown role in approval flow: ${rule.role}`);
      return listPeopleWithRole(rule.role as Role, subject ?? {}, executor);
    case "permission":
      // Owners hold everything; routine requests go to the people whose job it is, and reach the
      // owners only when there is nobody else (below).
      return listPeopleHolding(rule.permission as Exclude<Permission, "*">, subject ?? {}, { includeWildcard: false, executor });
  }
}

async function resolveFlow(executor: Executor, flow: FlowDefinition, context: { requesterId: string; subject: SubjectTarget | null; data: Record<string, unknown> }): Promise<ResolvedStep[]> {
  const resolved: ResolvedStep[] = [];
  for (const step of flow.steps) {
    if (!conditionHolds(step.condition, context.data)) {
      resolved.push({ key: step.key, mode: step.mode, applies: false, approverIds: [] });
      continue;
    }
    const named = (await Promise.all(step.approvers.map((rule) => peopleFor(executor, rule, context.subject)))).flat();
    const usable = async (ids: string[]) => {
      const candidates = [...new Set(ids)].filter((id) => id !== context.requesterId);
      if (candidates.length === 0) return [];
      // Someone who has left, or has not started, cannot answer.
      const rows = await executor.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, candidates), eq(schema.person.status, "active")));
      return rows.map((row) => row.id);
    };
    let approverIds = await usable(named);
    if (approverIds.length === 0) approverIds = await usable(await listOwnerPersonIds(executor));
    if (approverIds.length === 0) throw new ActionError("approval_no_approver");
    resolved.push({ key: step.key, mode: step.mode, applies: true, approverIds });
  }
  return resolved;
}

// ── State in and out of the tables ──────────────────────────────────────────────────────────

type Loaded = { request: ApprovalRequestRow; state: RequestState; stepIds: string[]; assigneeIds: string[][] };

async function load(tx: Tx, requestId: string, type: string): Promise<Loaded> {
  // The row lock serialises two approvers answering at the same moment.
  const [request] = await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, type))).limit(1).for("update");
  if (!request) throw new ActionError("approval_not_found");
  const steps = await tx.select().from(schema.approvalStep).where(eq(schema.approvalStep.requestId, requestId)).orderBy(asc(schema.approvalStep.stepIndex));
  const assignees = await tx.select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, requestId)).orderBy(asc(schema.approvalAssignee.id));
  const perStep = steps.map((step) => assignees.filter((assignee) => assignee.stepId === step.id));
  return {
    request,
    stepIds: steps.map((step) => step.id),
    assigneeIds: perStep.map((rows) => rows.map((row) => row.id)),
    state: {
      requesterId: request.requesterPersonId,
      status: request.status,
      currentStep: request.currentStep,
      steps: steps.map((step, index) => ({ key: step.key, mode: step.mode, status: step.status, assignees: perStep[index].map((row) => ({ personId: row.approverPersonId, status: row.status, delegatedFrom: row.delegatedFromPersonId })) })),
    },
  };
}

// Writes back whatever the state machine changed. Steps and assignees keep their order, so
// position identifies the row.
async function persist(tx: Tx, loaded: Loaded, next: RequestState, actor: { personId: string; comment: string | null }): Promise<ApprovalRequestRow> {
  const now = new Date();
  const decided = next.status !== "pending" && next.status !== "returned";
  for (const [index, step] of next.steps.entries()) {
    const before = loaded.state.steps[index];
    if (before.status !== step.status) await tx.update(schema.approvalStep).set({ status: step.status }).where(eq(schema.approvalStep.id, loaded.stepIds[index]));
    for (const [position, assignee] of step.assignees.entries()) {
      const previous = before.assignees[position];
      if (previous.status === assignee.status && previous.personId === assignee.personId) continue;
      const answered = assignee.status !== "pending" && assignee.personId === actor.personId;
      await tx
        .update(schema.approvalAssignee)
        .set({ status: assignee.status, approverPersonId: assignee.personId, delegatedFromPersonId: assignee.delegatedFrom ?? null, ...(answered ? { comment: actor.comment, decidedAt: now } : assignee.status === "pending" ? { comment: null, decidedAt: null } : {}) })
        .where(eq(schema.approvalAssignee.id, loaded.assigneeIds[index][position]));
    }
  }
  const [request] = await tx
    .update(schema.approvalRequest)
    .set({ status: next.status, currentStep: next.currentStep, decidedAt: decided ? now : null, updatedAt: now })
    .where(eq(schema.approvalRequest.id, loaded.request.id))
    .returning();
  return request;
}

const REFUSALS: Record<Extract<DecisionResult, { ok: false }>["reason"], string> = {
  not_pending: "approval_not_pending",
  not_assignee: "approval_not_assignee",
  not_requester: "approval_not_requester",
  own_request: "approval_own_request",
};

async function personName(tx: Tx, personId: string): Promise<string> {
  const [row] = await tx.select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return row?.fullName ?? "—";
}

async function askApprovers(tx: Tx, request: ApprovalRequestRow, approverIds: string[]): Promise<void> {
  if (approverIds.length === 0) return;
  await notify({ recipients: approverIds, kind: "approvals.requested", params: { requester: await personName(tx, request.requesterPersonId), requestType: request.type }, link: request.link }, tx);
}

// ── Use-cases ───────────────────────────────────────────────────────────────────────────────

export type SubmitInput = {
  /** Supply the id when something must be bound to it before the row exists (an encrypted payload). */
  id?: string;
  entityId: string | null;
  requesterPersonId: string;
  subjectPersonId: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  summary: string;
  payload?: Record<string, unknown>;
  payloadEnc?: string | null;
  link?: string | ((requestId: string) => string);
  /** What the flow's conditions are tested against; defaults to the payload. */
  conditionData?: Record<string, unknown>;
};

export async function submitRequest(tx: Tx, definition: RequestTypeDefinition, input: SubmitInput): Promise<{ request: ApprovalRequestRow; outcome: RequestStatus; approverIds: string[] }> {
  const id = input.id ?? randomUUID();
  const subject = await subjectTarget(tx, input.subjectPersonId);
  const resolved = await resolveFlow(tx, definition.flow, { requesterId: input.requesterPersonId, subject, data: input.conditionData ?? input.payload ?? {} });
  const state = startFlow(input.requesterPersonId, resolved);

  const [request] = await tx
    .insert(schema.approvalRequest)
    .values({
      id,
      type: definition.type,
      entityId: input.entityId,
      requesterPersonId: input.requesterPersonId,
      subjectPersonId: input.subjectPersonId,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      summary: input.summary,
      payload: input.payload ?? {},
      payloadEnc: input.payloadEnc ?? null,
      status: state.status,
      currentStep: state.currentStep,
      flowSnapshot: { definition: definition.flow, resolved },
      link: typeof input.link === "function" ? input.link(id) : (input.link ?? null),
      decidedAt: state.status === "pending" ? null : new Date(),
    })
    .returning();
  for (const [index, step] of state.steps.entries()) {
    const [row] = await tx.insert(schema.approvalStep).values({ requestId: id, stepIndex: index, key: step.key, mode: step.mode, status: step.status }).returning({ id: schema.approvalStep.id });
    if (step.assignees.length) await tx.insert(schema.approvalAssignee).values(step.assignees.map((assignee) => ({ stepId: row.id, requestId: id, approverPersonId: assignee.personId })));
  }
  await tx.insert(schema.approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: input.requesterPersonId, stepIndex: state.currentStep });
  const approverIds = waitingFor(state);
  await askApprovers(tx, request, approverIds);
  return { request, outcome: state.status, approverIds };
}

export type DecideInput = { action: Exclude<DecisionAction, "withdraw">; comment?: string | null; /** Kept with the decision, e.g. { verifiedSecondChannel: true }. */ meta?: Record<string, unknown> };

/**
 * One approver's answer. `outcome` is "approved" only when the whole request is: that is the
 * caller's cue to apply the effect, in this same transaction.
 */
export async function decideRequest(tx: Tx, definition: RequestTypeDefinition, requestId: string, actorPersonId: string, input: DecideInput): Promise<{ request: ApprovalRequestRow; before: ApprovalRequestRow; outcome: RequestStatus }> {
  const loaded = await load(tx, requestId, definition.type);
  const result = applyDecision(loaded.state, { actorId: actorPersonId, action: input.action });
  if (!result.ok) throw new ActionError(REFUSALS[result.reason]);
  // Sending something back without saying why helps nobody.
  if (input.action !== "approve" && !input.comment?.trim()) throw new ActionError("approval_comment_required");

  const comment = input.comment?.trim() || null;
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment });
  const eventType = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "returned";
  await tx.insert(schema.approvalEvent).values({ requestId, type: eventType, actorPersonId, stepIndex: loaded.state.currentStep, comment, meta: input.meta ?? null });

  await askApprovers(tx, request, result.nowWaitingFor);
  if (result.outcome !== "pending") {
    await notify({ recipients: [request.requesterPersonId], kind: "approvals.decided", params: { requestType: request.type, outcome: result.outcome, approver: await personName(tx, actorPersonId) }, link: request.link }, tx);
  }
  return { request, before: loaded.request, outcome: result.outcome };
}

/** The requester takes the request back; allowed until it is decided. */
export async function withdrawRequest(tx: Tx, requestId: string, actorPersonId: string): Promise<{ request: ApprovalRequestRow; before: ApprovalRequestRow }> {
  const [row] = await tx.select({ type: schema.approvalRequest.type }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!row) throw new ActionError("approval_not_found");
  const loaded = await load(tx, requestId, row.type);
  const result = applyDecision(loaded.state, { actorId: actorPersonId, action: "withdraw" });
  if (!result.ok) throw new ActionError(REFUSALS[result.reason]);
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment: null });
  await tx.insert(schema.approvalEvent).values({ requestId, type: "withdrawn", actorPersonId, stepIndex: loaded.state.currentStep });
  return { request, before: loaded.request };
}

/** After "return for changes": the requester sends the corrected request round again. */
export async function resubmitRequest(tx: Tx, definition: RequestTypeDefinition, requestId: string, actorPersonId: string, changes: { summary?: string; payload?: Record<string, unknown>; payloadEnc?: string | null }): Promise<{ request: ApprovalRequestRow; before: ApprovalRequestRow }> {
  const loaded = await load(tx, requestId, definition.type);
  const result = resubmit(loaded.state, actorPersonId);
  if (!result.ok) throw new ActionError(REFUSALS[result.reason]);
  await tx.update(schema.approvalRequest).set({ ...(changes.summary === undefined ? {} : { summary: changes.summary }), ...(changes.payload === undefined ? {} : { payload: changes.payload }), ...(changes.payloadEnc === undefined ? {} : { payloadEnc: changes.payloadEnc }) }).where(eq(schema.approvalRequest.id, requestId));
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment: null });
  await tx.insert(schema.approvalEvent).values({ requestId, type: "resubmitted", actorPersonId, stepIndex: result.state.currentStep });
  await askApprovers(tx, request, result.nowWaitingFor);
  return { request, before: loaded.request };
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type RequestListRow = { id: string; type: string; summary: string; status: RequestStatus; link: string | null; createdAt: Date; decidedAt: Date | null; requesterName: string; subjectName: string | null };

const requester = alias(schema.person, "requester");
const subject = alias(schema.person, "subject");
const LIST_COLUMNS = {
  id: schema.approvalRequest.id,
  type: schema.approvalRequest.type,
  summary: schema.approvalRequest.summary,
  status: schema.approvalRequest.status,
  link: schema.approvalRequest.link,
  createdAt: schema.approvalRequest.createdAt,
  decidedAt: schema.approvalRequest.decidedAt,
  requesterName: requester.fullName,
  subjectName: subject.fullName,
};

const listQuery = () =>
  db().select(LIST_COLUMNS).from(schema.approvalRequest).innerJoin(requester, eq(requester.id, schema.approvalRequest.requesterPersonId)).leftJoin(subject, eq(subject.id, schema.approvalRequest.subjectPersonId));

// "My turn": the request is pending, my step is the open one, and I have not answered yet.
const myTurn = (personId: string) =>
  and(eq(schema.approvalAssignee.approverPersonId, personId), eq(schema.approvalAssignee.status, "pending"), eq(schema.approvalStep.status, "pending"), eq(schema.approvalRequest.status, "pending"));

/** Requests waiting for this person's answer, oldest first. */
export async function listInbox(personId: string): Promise<RequestListRow[]> {
  return listQuery()
    .innerJoin(schema.approvalAssignee, eq(schema.approvalAssignee.requestId, schema.approvalRequest.id))
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .where(myTurn(personId))
    .orderBy(asc(schema.approvalRequest.createdAt));
}

export async function countInbox(personId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.approvalAssignee.requestId))
    .where(myTurn(personId));
  return row?.value ?? 0;
}

export async function listMyRequests(personId: string, limit = 50): Promise<RequestListRow[]> {
  return listQuery().where(eq(schema.approvalRequest.requesterPersonId, personId)).orderBy(desc(schema.approvalRequest.createdAt)).limit(limit);
}

/** Requests of one type about one person — for the owning module's screens, which check access themselves. */
export async function listRequestsAbout(type: string, subjectPersonId: string, status?: RequestStatus): Promise<RequestListRow[]> {
  return listQuery()
    .where(and(eq(schema.approvalRequest.type, type), eq(schema.approvalRequest.subjectPersonId, subjectPersonId), status ? eq(schema.approvalRequest.status, status) : undefined))
    .orderBy(desc(schema.approvalRequest.createdAt));
}

export type RequestView = {
  request: ApprovalRequestRow;
  requesterName: string;
  subjectName: string | null;
  subject: SubjectTarget | null;
  steps: { key: string; mode: "any" | "all"; status: string; assignees: { personId: string; name: string; status: string; comment: string | null; decidedAt: Date | null }[] }[];
  events: { id: number; type: string; actorName: string | null; comment: string | null; meta: Record<string, unknown> | null; at: Date }[];
  isRequester: boolean;
  /** It is this viewer's turn to answer. */
  canDecide: boolean;
};

/** A request with its history. null = not found, or none of the viewer's business. */
export async function getRequest(viewer: { personId: string; principal: Principal }, definition: RequestTypeDefinition, requestId: string): Promise<RequestView | null> {
  const [request] = await db().select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, definition.type))).limit(1);
  if (!request) return null;
  const actor = alias(schema.person, "actor");
  const [steps, assignees, events, target, names] = await Promise.all([
    db().select().from(schema.approvalStep).where(eq(schema.approvalStep.requestId, requestId)).orderBy(asc(schema.approvalStep.stepIndex)),
    db()
      .select({ row: schema.approvalAssignee, name: schema.person.fullName })
      .from(schema.approvalAssignee)
      .innerJoin(schema.person, eq(schema.person.id, schema.approvalAssignee.approverPersonId))
      .where(eq(schema.approvalAssignee.requestId, requestId))
      .orderBy(asc(schema.approvalAssignee.id)),
    db()
      .select({ id: schema.approvalEvent.id, type: schema.approvalEvent.type, actorName: actor.fullName, comment: schema.approvalEvent.comment, meta: schema.approvalEvent.meta, at: schema.approvalEvent.at })
      .from(schema.approvalEvent)
      .leftJoin(actor, eq(actor.id, schema.approvalEvent.actorPersonId))
      .where(eq(schema.approvalEvent.requestId, requestId))
      .orderBy(asc(schema.approvalEvent.id)),
    subjectTarget(db(), request.subjectPersonId),
    db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, [request.requesterPersonId, ...(request.subjectPersonId ? [request.subjectPersonId] : [])])),
  ]);

  const isRequester = request.requesterPersonId === viewer.personId;
  const isApprover = assignees.some(({ row }) => row.approverPersonId === viewer.personId || row.delegatedFromPersonId === viewer.personId);
  if (!canOpenRequest(request, { personId: viewer.personId, isApprover, typeAllows: !!definition.canView?.(viewer.principal, target) })) return null;

  const openStep = steps.find((step) => step.stepIndex === request.currentStep && step.status === "pending");
  return {
    request,
    requesterName: names.find((row) => row.id === request.requesterPersonId)?.fullName ?? "—",
    subjectName: names.find((row) => row.id === request.subjectPersonId)?.fullName ?? null,
    subject: target,
    steps: steps.map((step) => ({
      key: step.key,
      mode: step.mode,
      status: step.status,
      assignees: assignees.filter(({ row }) => row.stepId === step.id).map(({ row, name }) => ({ personId: row.approverPersonId, name, status: row.status, comment: row.comment, decidedAt: row.decidedAt })),
    })),
    events,
    isRequester,
    canDecide: request.status === "pending" && !isRequester && !!openStep && assignees.some(({ row }) => row.stepId === openStep.id && row.approverPersonId === viewer.personId && row.status === "pending"),
  };
}
