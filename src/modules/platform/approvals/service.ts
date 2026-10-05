// The approval engine's use-cases (FR-PLT-20..22). A module that needs approvals defines a request
// type (`defineRequestType`), submits requests through `submitRequest` and — because the *effect*
// of an approval is its own business — owns the action that decides them: inside one transaction
// it calls `decideRequest` and, when the outcome is "approved", applies the change. Everything
// here takes that transaction, so a request is never approved without its effect or the reverse.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, getTableColumns, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { cachedLive } from "@/lib/cache/live";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../notifications/service";
import { canReadTier, type entityReach, type Principal, type Target } from "../rbac/policy";
import { type Permission, type Role, ROLES } from "../rbac/roles";
import { listOwnerPersonIds, loadGrants, type RoleHolders, roleHolders } from "../rbac/service";
import { issueActionTokens, voidActionTokens } from "./action-tokens";
import { standIns } from "./delegations";
import { effectiveFlow } from "./flows";
import { canOpenRequest, canOverseeRequests, canReassignTurns } from "./policy";
import { applyDecision, type ApproverRule, conditionHolds, type DecisionAction, type DecisionResult, delegate, type FlowDefinition, type RequestState, type RequestStatus, type ResolvedStep, resubmit, startFlow, waitingFor } from "./engine/flow";

type Executor = Tx | ReturnType<typeof db>;
export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;
export type SubjectTarget = Target & { personId: string };

export type RequestTypeDefinition = {
  /** Stored on every request; also the key of its name in messages (`approvals.types.<type>`). */
  type: string;
  /** The default flow; `approval_flow` rows override it per entity or for the group (FR-PLT-20). */
  flow: FlowDefinition;
  /** Fields of the condition data an administrator can test in a configured flow, e.g. ["days"]. */
  conditionFields?: readonly string[];
  /** May this request be approved from the inbox without opening it? Default: no. */
  bulkApprovable?: (request: ApprovalRequestRow) => boolean;
  /** Who may open a request of this type besides its requester and its approvers. */
  canView?: (viewer: Principal, subject: SubjectTarget | null) => boolean;
  /**
   * What to call the type in a notification when `approvals.types.<type>` is not a message key —
   * the request builder's types are named in the database (FR-REQ-01).
   */
  name?: string;
  /**
   * The flow in code is the only flow: a configured `approval_flow` row for the type is ignored.
   * For decisions whose approver is the point of the request — the owner deciding a rule
   * (FR-PLT-39) — which an administrator of flows must not be able to route to somebody else.
   */
  fixedFlow?: boolean;
};

export const defineRequestType = (definition: RequestTypeDefinition): RequestTypeDefinition => definition;

/**
 * Has an administrator saved a flow for this type that covers this entity — its own, or the
 * group's? For the types that are asked only where somebody chose to (FR-CHR-09: a transfer, a
 * promotion, a termination): without a saved flow the change applies at once, as it always did.
 */
export async function hasConfiguredFlow(definition: RequestTypeDefinition, entityId: string | null, executor: Executor = db()): Promise<boolean> {
  return (await effectiveFlow(executor, definition.type, entityId, definition.flow)).source !== "default";
}

// ── Turning approver rules into people ──────────────────────────────────────────────────────

async function subjectTarget(executor: Executor, personId: string | null): Promise<SubjectTarget | null> {
  if (!personId) return null;
  const [row] = await executor.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return row ? { personId: row.id, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId } : null;
}

async function managerAt(executor: Executor, personId: string, level: number): Promise<string | null> {
  let cursor: string | null = personId;
  for (let step = 0; cursor && step < level; step++) {
    const [row]: { managerId: string | null }[] = await executor.select({ managerId: schema.person.managerId }).from(schema.person).where(eq(schema.person.id, cursor)).limit(1);
    cursor = row?.managerId ?? null;
  }
  return cursor === personId ? null : cursor;
}

/** Who holds what, read once for all the rules of a flow (or of a preview), and only when a rule asks. */
function holdersOnce(executor: Executor): () => Promise<RoleHolders> {
  let lookup: Promise<RoleHolders> | undefined;
  return () => (lookup ??= roleHolders({ executor }));
}

async function peopleFor(executor: Executor, rule: ApproverRule, subject: SubjectTarget | null, where: Target = subject ?? {}, holders = holdersOnce(executor)): Promise<string[]> {
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
      return subject ? (await holders()).withRole("department_head", subject) : [];
    case "role":
      if (!(ROLES as readonly string[]).includes(rule.role)) throw new Error(`unknown role in approval flow: ${rule.role}`);
      return (await holders()).withRole(rule.role as Role, where);
    case "permission":
      // Owners hold everything; routine requests go to the people whose job it is, and reach the
      // owners only when there is nobody else (below).
      return (await holders()).holding(rule.permission as Exclude<Permission, "*">, where, { includeWildcard: false });
  }
}

/**
 * One approver rule turned into people, resolved against a subject person — for callers outside a
 * flow, such as the SLA job asking who a silent approver escalates to (FR-PLT-23).
 */
export async function resolveApprovers(executor: Executor, rule: ApproverRule, subjectPersonId: string, where: Target = {}, holders = holdersOnce(executor)): Promise<string[]> {
  const subject = await subjectTarget(executor, subjectPersonId);
  const named = await peopleFor(executor, rule, subject, subject ?? where, holders);
  if (named.length === 0) return [];
  const rows = await executor.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, [...new Set(named)]), eq(schema.person.status, "active")));
  return rows.map((row) => row.id);
}

export type ApproverStep = { /** The step's key in the flow, e.g. "manager" — also its message key. */ key: string; names: string[] };

/**
 * Who would be asked if this request were filed now, step by step — the entity's own flow, its
 * conditions evaluated against `data`, standing delegations left out (they are about a particular
 * day, and this is a question about the shape of the flow).
 *
 * For the assistant's approver lookup (FR-AI-02: "who approves my overtime?") and for telling a
 * requester what will happen before they file. **Names only** — no ids, no state, no request. It
 * decides nothing about access: the caller has already decided who may ask about whom, which for
 * the assistant means the asker and nobody else.
 */
export async function previewApprovers(definition: RequestTypeDefinition, subjectPersonId: string, data: Record<string, unknown> = {}): Promise<ApproverStep[]> {
  const executor = db();
  const subject = await subjectTarget(executor, subjectPersonId);
  const { flow } = definition.fixedFlow ? { flow: definition.flow } : await effectiveFlow(executor, definition.type, subject?.entityId ?? null, definition.flow);
  const steps: ApproverStep[] = [];
  const holders = holdersOnce(executor);
  for (const step of flow.steps) {
    if (!conditionHolds(step.condition, data)) continue;
    const resolved = (await Promise.all(step.approvers.map((rule) => resolveApprovers(executor, rule, subjectPersonId, subject ?? {}, holders)))).flat();
    // Nobody asks themselves; `resolveApprovers` has already dropped anyone who has left.
    const unique = [...new Set(resolved)].filter((id) => id !== subjectPersonId);
    if (unique.length === 0) continue;
    const rows = await executor.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, unique));
    const byId = new Map(rows.map((row) => [row.id, row.fullName]));
    const names = unique.map((id) => byId.get(id)).filter((name): name is string => !!name);
    if (names.length > 0) steps.push({ key: step.key, names });
  }
  return steps;
}

type StepContext = { requestType: string; requesterId: string; subject: SubjectTarget | null; /** Where the request sits when it is about no person (a page of an entity's space). */ target?: Target };

/** The people a step's rules name, before anyone is ruled out. */
const namedBy = async (executor: Executor, rules: readonly ApproverRule[], context: StepContext, holders = holdersOnce(executor)): Promise<string[]> =>
  (await Promise.all(rules.map((rule) => peopleFor(executor, rule, context.subject, context.subject ?? context.target ?? {}, holders)))).flat();

/** Of these people, the ones who can answer the request. `without` rules out someone who is on their way out. */
async function usableApprovers(executor: Executor, ids: readonly string[], context: StepContext, without: readonly string[] = []): Promise<string[]> {
  // Nobody answers a request they filed or one about themselves (HR filing a department head's leave).
  const candidates = [...new Set(ids)].filter((id) => id !== context.requesterId && id !== context.subject?.personId && !without.includes(id));
  if (candidates.length === 0) return [];
  // Someone who has left, or has not started, cannot answer.
  const rows = await executor.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, candidates), eq(schema.person.status, "active")));
  return rows.map((row) => row.id);
}

/** Standing delegations: whoever stands in for an approver today is asked instead, and the request keeps who they stand in for. */
async function withStandIns(executor: Executor, approverIds: readonly string[], context: StepContext): Promise<{ asked: string[]; delegatedFrom: Record<string, string> }> {
  const substitutes = await standIns(executor, approverIds, { requestType: context.requestType, requesterId: context.requesterId, subjectId: context.subject?.personId ?? null });
  const delegatedFrom: Record<string, string> = {};
  const asked: string[] = [];
  for (const approverId of approverIds) {
    const standIn = substitutes.get(approverId);
    // Already on the step in their own right: nothing to hand over.
    if (standIn && !approverIds.includes(standIn) && !asked.includes(standIn)) {
      asked.push(standIn);
      delegatedFrom[standIn] = approverId;
    } else if (!standIn && !asked.includes(approverId)) asked.push(approverId);
  }
  if (asked.length === 0) asked.push(...approverIds);
  return { asked, delegatedFrom };
}

async function resolveFlow(executor: Executor, flow: FlowDefinition, context: StepContext & { data: Record<string, unknown> }): Promise<ResolvedStep[]> {
  const resolved: ResolvedStep[] = [];
  const holders = holdersOnce(executor);
  for (const step of flow.steps) {
    if (!conditionHolds(step.condition, context.data)) {
      resolved.push({ key: step.key, mode: step.mode, applies: false, approverIds: [], ...(step.parallel ? { parallel: true } : {}) });
      continue;
    }
    let approverIds = await usableApprovers(executor, await namedBy(executor, step.approvers, context, holders), context);
    if (approverIds.length === 0) approverIds = await usableApprovers(executor, (await holders()).owners(), context);
    if (approverIds.length === 0) throw new ActionError("approval_no_approver");
    const { asked, delegatedFrom } = await withStandIns(executor, approverIds, context);
    // The line manager who is also the department head is asked once: a later step whose only
    // approver is the only approver of an earlier step would be the same person saying yes twice.
    if (asked.length === 1 && resolved.some((earlier) => earlier.applies && earlier.approverIds.length === 1 && earlier.approverIds[0] === asked[0])) {
      resolved.push({ key: step.key, mode: step.mode, applies: false, approverIds: [], ...(step.parallel ? { parallel: true } : {}) });
      continue;
    }
    resolved.push({ key: step.key, mode: step.mode, applies: true, approverIds: asked, ...(step.parallel ? { parallel: true } : {}), ...(Object.keys(delegatedFrom).length ? { delegatedFrom } : {}) });
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
      subjectId: request.subjectPersonId,
      status: request.status,
      currentStep: request.currentStep,
      steps: steps.map((step, index) => ({ key: step.key, mode: step.mode, status: step.status, ...(step.parallel ? { parallel: true } : {}), assignees: perStep[index].map((row) => ({ personId: row.approverPersonId, status: row.status, delegatedFrom: row.delegatedFromPersonId })) })),
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
        // A turn that starts over starts its SLA clock over too (FR-PLT-23).
        .set({ status: assignee.status, approverPersonId: assignee.personId, delegatedFromPersonId: assignee.delegatedFrom ?? null, ...(answered ? { comment: actor.comment, decidedAt: now } : assignee.status === "pending" ? { comment: null, decidedAt: null, remindedAt: null, escalatedAt: null } : {}) })
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

async function personName(tx: Executor, personId: string): Promise<string> {
  const [row] = await tx.select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return row?.fullName ?? "—";
}

/** What to call the request in a notification: its stored name, else its type's message key. */
const typeLabel = (request: ApprovalRequestRow) => request.typeName ?? request.type;

/**
 * Tells the people whose turn it is, and gives each of them a one-shot link that approves this
 * request (FR-PLT-24). Each approver gets their own token: the Chat space is shared, and a button
 * in it must not let the wrong person press it.
 *
 * Only a request its type lets be approved unread gets that link (the redeeming action checks the
 * same rule again): an offer or a hiring request is announced with no button.
 */
async function askApprovers(tx: Executor, request: ApprovalRequestRow, approverIds: string[], definition: RequestTypeDefinition | null): Promise<void> {
  if (approverIds.length === 0) return;
  const requester = await personName(tx, request.requesterPersonId);
  const params = { requester, requestType: typeLabel(request) };
  // No definition (a hand-over, which is the same for every type): no button either.
  const oneClick = !!definition?.bulkApprovable?.(request);
  // Everybody at once: their keys in one insert, and one notice whose chat card carries each
  // approver's own link.
  const tokens = oneClick ? await issueActionTokens(tx, request.id, approverIds) : null;
  const actionPathFor = tokens ? Object.fromEntries([...tokens].map(([personId, { path }]) => [personId, path])) : null;
  await notify({ recipients: approverIds, kind: "approvals.requested", params, link: request.link, chat: actionPathFor ? { actionPathFor, actionLabel: "Duyệt" } : {} }, tx);
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
  /** For a request about no person: where it sits, so "permission" and "role" rules find the people whose scope covers it. Ignored when there is a subject person. */
  target?: Target;
};

export async function submitRequest(tx: Tx, definition: RequestTypeDefinition, input: SubmitInput): Promise<{ request: ApprovalRequestRow; outcome: RequestStatus; approverIds: string[] }> {
  const id = input.id ?? randomUUID();
  const subject = await subjectTarget(tx, input.subjectPersonId);
  const { flow, source } = definition.fixedFlow ? { flow: definition.flow, source: "default" as const } : await effectiveFlow(tx, definition.type, input.entityId, definition.flow);
  const resolved = await resolveFlow(tx, flow, { requestType: definition.type, requesterId: input.requesterPersonId, subject, target: input.target, data: input.conditionData ?? input.payload ?? {} });
  const state = startFlow(input.requesterPersonId, resolved, input.subjectPersonId);

  const [request] = await tx
    .insert(schema.approvalRequest)
    .values({
      id,
      type: definition.type,
      typeName: definition.name ?? null,
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
      flowSnapshot: { definition: flow, source, resolved },
      link: typeof input.link === "function" ? input.link(id) : (input.link ?? null),
      decidedAt: state.status === "pending" ? null : new Date(),
    })
    .returning();
  for (const [index, step] of state.steps.entries()) {
    const [row] = await tx.insert(schema.approvalStep).values({ requestId: id, stepIndex: index, key: step.key, mode: step.mode, status: step.status, parallel: !!step.parallel }).returning({ id: schema.approvalStep.id });
    if (step.assignees.length) await tx.insert(schema.approvalAssignee).values(step.assignees.map((assignee) => ({ stepId: row.id, requestId: id, approverPersonId: assignee.personId, delegatedFromPersonId: assignee.delegatedFrom ?? null })));
  }
  await tx.insert(schema.approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: input.requesterPersonId, stepIndex: state.currentStep });
  const approverIds = waitingFor(state);
  await askApprovers(tx, request, approverIds, definition);
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

  // Whatever was outstanding is spent: the request has moved on, and a stale link must do nothing.
  await voidActionTokens(tx, requestId);
  await askApprovers(tx, request, result.nowWaitingFor, definition);
  if (result.outcome !== "pending") {
    await notify({ recipients: [request.requesterPersonId], kind: "approvals.decided", params: { requestType: typeLabel(request), outcome: result.outcome, approver: await personName(tx, actorPersonId) }, link: request.link }, tx);
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
  await voidActionTokens(tx, requestId);
  await tx.insert(schema.approvalEvent).values({ requestId, type: "withdrawn", actorPersonId, stepIndex: loaded.state.currentStep });
  return { request, before: loaded.request };
}

/** After "return for changes": the requester sends the corrected request round again. */
export async function resubmitRequest(tx: Tx, definition: RequestTypeDefinition, requestId: string, actorPersonId: string, changes: { summary?: string; payload?: Record<string, unknown>; payloadEnc?: string | null }): Promise<{ request: ApprovalRequestRow; before: ApprovalRequestRow }> {
  const loaded = await load(tx, requestId, definition.type);
  const result = resubmit(loaded.state, actorPersonId);
  if (!result.ok) throw new ActionError(REFUSALS[result.reason]);
  const edits = { ...(changes.summary === undefined ? {} : { summary: changes.summary }), ...(changes.payload === undefined ? {} : { payload: changes.payload }), ...(changes.payloadEnc === undefined ? {} : { payloadEnc: changes.payloadEnc }) };
  // Sent round again unchanged is allowed (the approver asked a question, not for an edit); an
  // UPDATE with nothing to set is not.
  if (Object.keys(edits).length > 0) await tx.update(schema.approvalRequest).set(edits).where(eq(schema.approvalRequest.id, requestId));
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment: null });
  await voidActionTokens(tx, requestId);
  await tx.insert(schema.approvalEvent).values({ requestId, type: "resubmitted", actorPersonId, stepIndex: result.state.currentStep });
  // The round starts over with everyone who was asked the first time — and one of them may have
  // left since. Their turn moves on before anybody is asked (PLT-02).
  const gone = await tx
    .selectDistinct({ personId: schema.approvalAssignee.approverPersonId })
    .from(schema.approvalAssignee)
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalAssignee.approverPersonId))
    .where(and(eq(schema.approvalAssignee.requestId, requestId), eq(schema.approvalAssignee.status, "pending"), eq(schema.person.status, "offboarded")));
  for (const { personId } of gone) await reassignTurnsOfLeaver(tx, personId, { requestId });
  await askApprovers(tx, request, result.nowWaitingFor.filter((personId) => !gone.some((row) => row.personId === personId)), definition);
  return { request, before: loaded.request };
}

// Only someone who works here answers: a collaborator sees no directory, so cannot judge a request.
async function eligibleApprover(tx: Tx, personId: string) {
  const [to] = await tx.select({ id: schema.person.id, fullName: schema.person.fullName, workforceType: schema.person.workforceType }).from(schema.person).where(and(eq(schema.person.id, personId), eq(schema.person.status, "active"), ne(schema.person.workforceType, "collaborator"))).limit(1);
  if (!to) throw new ActionError("delegation_person_unknown");
  return to;
}

/**
 * A request with a sealed payload carries restricted values (a new bank account, a tax code). When
 * somebody other than its approver moves the turn, it goes only to a person who reads the
 * restricted tier of whoever the request is about. What else the new approver needs to answer it
 * stays the owning module's rule, checked when they decide.
 */
async function assertReadsRequest(tx: Tx, request: ApprovalRequestRow, to: { id: string; workforceType: Principal["workforceType"] }): Promise<void> {
  if (!request.payloadEnc) return;
  const subject = await subjectTarget(tx, request.subjectPersonId);
  const principal: Principal = { personId: to.id, workforceType: to.workforceType, grants: await loadGrants(to.id, todayInVietnam(), tx) };
  if (!subject || !canReadTier(principal, subject, "restricted")) throw new ActionError("approval_reassign_tier");
}

/**
 * Hands the actor's turn on one request to someone else (FR-PLT-22). The same for every type; what
 * the new approver needs besides the turn (a permission, a tier) stays the owning module's rule.
 *
 * `onBehalfBy`: an administrator hands the turn over for an approver who is away (a delegation set
 * for them, FR-ACL-06). They are the event's actor, and the tier rule of a reassignment applies.
 */
export async function delegateRequest(tx: Tx, requestId: string, actorPersonId: string, input: { toPersonId: string; comment?: string | null; onBehalfBy?: string }): Promise<{ request: ApprovalRequestRow; toName: string }> {
  const [row] = await tx.select({ type: schema.approvalRequest.type }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!row) throw new ActionError("approval_not_found");
  const loaded = await load(tx, requestId, row.type);
  // The engine refuses the requester and the person the request is about.
  const to = await eligibleApprover(tx, input.toPersonId);
  if (input.onBehalfBy) await assertReadsRequest(tx, loaded.request, to);
  const result = delegate(loaded.state, actorPersonId, input.toPersonId);
  if (!result.ok) throw new ActionError(result.reason === "not_assignee" ? "approval_delegate_refused" : REFUSALS[result.reason]);
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment: null });
  // The turn moved: the link the previous approver was given must stop working.
  await voidActionTokens(tx, requestId);
  await tx.insert(schema.approvalEvent).values({
    requestId,
    type: "delegated",
    actorPersonId: input.onBehalfBy ?? actorPersonId,
    stepIndex: loaded.state.currentStep,
    comment: input.comment?.trim() || null,
    meta: { toPersonId: to.id, toName: to.fullName, ...(input.onBehalfBy ? { fromPersonId: actorPersonId, fromName: await personName(tx, actorPersonId) } : {}) },
  });
  await askApprovers(tx, request, [to.id], null);
  return { request, toName: to.fullName };
}

/**
 * An administrator moves somebody's open turn to another person (PLT-02): the approver is away,
 * suspended, or not answering. Who may do it is `canReassignTurns`, asked by the action; here the
 * engine's own rules hold — nobody answers a request they filed or one about themselves, nobody
 * sits on a step twice — and a request carrying restricted values goes only to someone who reads
 * them. The reason is kept with the event; the approver who lost the turn is told.
 */
export async function reassignRequest(tx: Tx, requestId: string, actorPersonId: string, input: { fromPersonId: string; toPersonId: string; reason: string }): Promise<{ request: ApprovalRequestRow; fromName: string; toName: string }> {
  const [row] = await tx.select({ type: schema.approvalRequest.type }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!row) throw new ActionError("approval_not_found");
  const loaded = await load(tx, requestId, row.type);
  const to = await eligibleApprover(tx, input.toPersonId);
  await assertReadsRequest(tx, loaded.request, to);
  const result = delegate(loaded.state, input.fromPersonId, input.toPersonId);
  if (!result.ok) throw new ActionError(result.reason === "not_assignee" ? "approval_reassign_refused" : REFUSALS[result.reason]);
  const request = await persist(tx, loaded, result.state, { personId: actorPersonId, comment: null });
  // Only the link of the approver who lost the turn: the others on the step keep theirs.
  await voidActionTokens(tx, requestId, input.fromPersonId);
  const fromName = await personName(tx, input.fromPersonId);
  await tx.insert(schema.approvalEvent).values({ requestId, type: "reassigned", actorPersonId, stepIndex: loaded.state.currentStep, comment: input.reason.trim(), meta: { reason: "administrator", fromPersonId: input.fromPersonId, fromName, toPersonId: to.id, toName: to.fullName } });
  await askApprovers(tx, request, [to.id], null);
  await notify({ recipients: [input.fromPersonId], kind: "approvals.turn_reassigned", params: { actor: await personName(tx, actorPersonId), to: to.fullName, requestType: typeLabel(request) }, link: request.link }, tx);
  return { request, fromName, toName: to.fullName };
}

export type MovedTurns = { /** Turns that now wait for somebody else, or that the others on the step answer without the leaver. */ moved: number; /** Turns nobody could take (the requester is the only owner left): they wait for an administrator. */ stranded: number };

/**
 * Someone has left the company: every turn they had not answered — on the step that is open and on
 * the ones still to come — is resolved again without them (PLT-02). The step's approver rule, as
 * the request snapshotted it, is run once more; whoever it names today and is not already on the
 * step takes the leaver's place (standing delegations applied, as at submission). When the rule
 * names nobody new, the others still to answer the step answer it without the leaver; when there
 * are none, the owners do — the same fallback as a request filed with no approver.
 *
 * It never finishes a step by itself: an approval has an effect that belongs to the owning module,
 * and only a person's answer applies it. Each move is an `approval_event` naming the leaver and the
 * new approvers; whoever's turn it is now is told. Runs in the caller's transaction, which is the
 * one that makes the person a leaver.
 */
export async function reassignTurnsOfLeaver(tx: Executor, leaverPersonId: string, options: { /** Who ended the employment; nobody when the daily roll-over did. */ actorPersonId?: string | null; requestId?: string } = {}): Promise<MovedTurns> {
  const result: MovedTurns = { moved: 0, stranded: 0 };
  const found = await tx
    .select({ stepId: schema.approvalAssignee.stepId, requestId: schema.approvalAssignee.requestId })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.approvalAssignee.requestId))
    .where(and(eq(schema.approvalAssignee.approverPersonId, leaverPersonId), eq(schema.approvalAssignee.status, "pending"), inArray(schema.approvalStep.status, ["pending", "waiting"]), eq(schema.approvalRequest.status, "pending"), options.requestId ? eq(schema.approvalRequest.id, options.requestId) : undefined));
  if (found.length === 0) return result;

  // The row locks serialise this with an approver answering at the same moment; everything below
  // is read after them, so it is the state the move is made on.
  const requests = await tx.select().from(schema.approvalRequest).where(and(inArray(schema.approvalRequest.id, [...new Set(found.map((row) => row.requestId))]), eq(schema.approvalRequest.status, "pending"))).orderBy(asc(schema.approvalRequest.id)).for("update");
  const subjectIds = [...new Set(requests.flatMap((request) => (request.subjectPersonId ? [request.subjectPersonId] : [])))];
  const [onSteps, subjects, leaverName] = await Promise.all([
    tx
      .select({ id: schema.approvalAssignee.id, stepId: schema.approvalAssignee.stepId, requestId: schema.approvalAssignee.requestId, personId: schema.approvalAssignee.approverPersonId, status: schema.approvalAssignee.status, stepIndex: schema.approvalStep.stepIndex, stepStatus: schema.approvalStep.status, active: sql<boolean>`${schema.person.status} = 'active'` })
      .from(schema.approvalAssignee)
      .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
      .innerJoin(schema.person, eq(schema.person.id, schema.approvalAssignee.approverPersonId))
      .where(inArray(schema.approvalAssignee.stepId, [...new Set(found.map((row) => row.stepId))]))
      .orderBy(asc(schema.approvalStep.stepIndex), asc(schema.approvalAssignee.id)),
    subjectIds.length ? tx.select().from(schema.person).where(inArray(schema.person.id, subjectIds)) : [],
    personName(tx, leaverPersonId),
  ]);
  let owners: string[] | null = null;
  const moves: { requestId: string; stepIndex: number; asked: string[] }[] = [];

  for (const request of requests) {
    const subjectRow = subjects.find((row) => row.id === request.subjectPersonId);
    const context: StepContext = {
      requestType: request.type,
      requesterId: request.requesterPersonId,
      subject: subjectRow ? { personId: subjectRow.id, entityId: subjectRow.primaryEntityId, unitPath: subjectRow.orgUnitPath, managerId: subjectRow.managerId } : null,
      // What a request about no person was filed with: every such type gives its entity.
      target: { entityId: request.entityId },
    };
    const rules = (request.flowSnapshot as { definition?: FlowDefinition }).definition?.steps ?? [];
    const nowAsked: string[] = [];
    const turns = onSteps.filter((row) => row.requestId === request.id && row.personId === leaverPersonId && row.status === "pending" && (row.stepStatus === "pending" || row.stepStatus === "waiting"));
    for (const turn of turns) {
      const others = onSteps.filter((row) => row.stepId === turn.stepId && row.id !== turn.id);
      const named = await usableApprovers(tx, await namedBy(tx, rules[turn.stepIndex]?.approvers ?? [], context), context, [leaverPersonId]);
      const resolved = named.length ? await withStandIns(tx, named, context) : { asked: [], delegatedFrom: {} };
      // Someone already on the step answers it in their own right: there is nothing to give them.
      const fresh = (ids: readonly string[]) => ids.filter((id) => id !== leaverPersonId && !others.some((row) => row.personId === id));
      let asked = fresh(resolved.asked);
      if (asked.length === 0 && !others.some((row) => row.status === "pending" && row.active)) {
        owners ??= await listOwnerPersonIds(tx);
        asked = fresh(await usableApprovers(tx, owners, context, [leaverPersonId]));
        if (asked.length === 0) {
          result.stranded++;
          continue;
        }
      }

      if (asked.length === 0) {
        // The others on the step answer it without the leaver.
        await tx.delete(schema.approvalAssignee).where(eq(schema.approvalAssignee.id, turn.id));
      } else {
        const [first, ...rest] = asked;
        const fromOf = (personId: string) => resolved.delegatedFrom[personId] ?? leaverPersonId;
        // A turn that starts over starts its SLA clock over too (FR-PLT-23).
        await tx.update(schema.approvalAssignee).set({ approverPersonId: first, delegatedFromPersonId: fromOf(first), remindedAt: null, escalatedAt: null }).where(eq(schema.approvalAssignee.id, turn.id));
        if (rest.length) await tx.insert(schema.approvalAssignee).values(rest.map((personId) => ({ stepId: turn.stepId, requestId: request.id, approverPersonId: personId, delegatedFromPersonId: fromOf(personId) })));
        if (turn.stepStatus === "pending") nowAsked.push(...asked);
      }
      moves.push({ requestId: request.id, stepIndex: turn.stepIndex, asked });
    }
    // The link the leaver was given must stop working; the others on the step keep theirs.
    await voidActionTokens(tx, request.id, leaverPersonId);
    await askApprovers(tx, request, [...new Set(nowAsked)], null);
  }

  // What happened, on each request's own history: who left and who answers now.
  if (moves.length) {
    const askedIds = [...new Set(moves.flatMap((move) => move.asked))];
    const names = askedIds.length ? await tx.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, askedIds)) : [];
    const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
    await tx.insert(schema.approvalEvent).values(
      moves.map((move) => ({
        requestId: move.requestId,
        type: "reassigned" as const,
        actorPersonId: options.actorPersonId ?? null,
        stepIndex: move.stepIndex,
        meta: { reason: "offboarded", fromPersonId: leaverPersonId, fromName: leaverName, to: move.asked.map((personId) => ({ personId, name: nameOf.get(personId) ?? "—" })) },
      })),
    );
  }
  result.moved = moves.length;
  return result;
}

/** A remark without a decision, from the requester or anyone asked to approve. The other side is told. */
export async function commentOnRequest(tx: Tx, requestId: string, actorPersonId: string, comment: string): Promise<{ request: ApprovalRequestRow }> {
  const [request] = await tx.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!request) throw new ActionError("approval_not_found");
  const assignees = await tx.select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, requestId));
  const isParty = request.requesterPersonId === actorPersonId || assignees.some((row) => row.approverPersonId === actorPersonId || row.delegatedFromPersonId === actorPersonId);
  if (!isParty) throw new ActionError("approval_not_found");
  await tx.insert(schema.approvalEvent).values({ requestId, type: "commented", actorPersonId, stepIndex: request.currentStep, comment: comment.trim() });
  const others = request.requesterPersonId === actorPersonId ? assignees.filter((row) => row.status === "pending").map((row) => row.approverPersonId) : [request.requesterPersonId];
  await notify({ recipients: [...new Set(others)].filter((id) => id !== actorPersonId), kind: "approvals.commented", params: { author: await personName(tx, actorPersonId), requestType: typeLabel(request) }, link: request.link }, tx);
  return { request };
}

/** Is this person a party to the request (requester, approver, or someone who handed their turn on)? */
export async function isRequestParty(requestId: string, personId: string): Promise<{ party: boolean; canDelegate: boolean }> {
  const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!request) return { party: false, canDelegate: false };
  const rows = await db()
    .select({ approver: schema.approvalAssignee.approverPersonId, from: schema.approvalAssignee.delegatedFromPersonId, status: schema.approvalAssignee.status, stepStatus: schema.approvalStep.status })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .where(eq(schema.approvalAssignee.requestId, requestId));
  return {
    party: request.requesterPersonId === personId || rows.some((row) => row.approver === personId || row.from === personId),
    canDelegate: request.status === "pending" && request.requesterPersonId !== personId && request.subjectPersonId !== personId && rows.some((row) => row.approver === personId && row.status === "pending" && row.stepStatus === "pending"),
  };
}

/**
 * The net under `reassignTurnsOfLeaver`: turns still waiting for someone who left before their
 * turns moved with them — a leaver from before PLT-02, a status set by hand. Runs with the nightly
 * roll-over; a turn nobody can take is counted again each night until an administrator moves it.
 */
export async function reassignStrandedTurns(): Promise<MovedTurns> {
  const gone = await db()
    .selectDistinct({ personId: schema.approvalAssignee.approverPersonId })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.approvalAssignee.requestId))
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalAssignee.approverPersonId))
    .where(and(eq(schema.approvalAssignee.status, "pending"), inArray(schema.approvalStep.status, ["pending", "waiting"]), eq(schema.approvalRequest.status, "pending"), eq(schema.person.status, "offboarded")));
  const total: MovedTurns = { moved: 0, stranded: 0 };
  // One transaction per leaver: each locks the requests it moves.
  for (const { personId } of gone) {
    const result = await db().transaction((tx) => reassignTurnsOfLeaver(tx, personId));
    total.moved += result.moved;
    total.stranded += result.stranded;
  }
  return total;
}

/** Where a person sits, read from their own row — the engine's view of a subject, for the policies asked about one person. */
export const placeOfPerson = (personId: string): Promise<SubjectTarget | null> => subjectTarget(db(), personId);

/** May this person move a turn on this request to somebody else? What the reassign action asks before it runs. */
export async function mayReassignRequest(principal: Principal, requestId: string): Promise<boolean> {
  const [request] = await db().select({ requesterPersonId: schema.approvalRequest.requesterPersonId, subjectPersonId: schema.approvalRequest.subjectPersonId }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  if (!request) return false;
  return canReassignTurns(principal, request, await subjectTarget(db(), request.subjectPersonId ?? request.requesterPersonId));
}

/** The rows behind a bulk action: type and everything a type's `bulkApprovable` looks at. */
export async function getRequestRows(requestIds: readonly string[]): Promise<ApprovalRequestRow[]> {
  if (requestIds.length === 0) return [];
  return db().select().from(schema.approvalRequest).where(inArray(schema.approvalRequest.id, [...requestIds]));
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type RequestListRow = { id: string; type: string; summary: string; status: RequestStatus; link: string | null; createdAt: Date; decidedAt: Date | null; requesterPersonId: string; requesterName: string; subjectName: string | null };

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
  requesterPersonId: schema.approvalRequest.requesterPersonId,
  requesterName: requester.fullName,
  subjectName: subject.fullName,
};

const listQuery = () =>
  db().select(LIST_COLUMNS).from(schema.approvalRequest).innerJoin(requester, eq(requester.id, schema.approvalRequest.requesterPersonId)).leftJoin(subject, eq(subject.id, schema.approvalRequest.subjectPersonId));

// "My turn": the request is pending, my step is the open one, and I have not answered yet.
const myTurn = (personId: string) =>
  and(eq(schema.approvalAssignee.approverPersonId, personId), eq(schema.approvalAssignee.status, "pending"), eq(schema.approvalStep.status, "pending"), eq(schema.approvalRequest.status, "pending"));

/**
 * Requests waiting for this person's answer, oldest first, each with its full row (what a type's
 * `bulkApprovable` looks at). Once per request: the inbox page and the task list share it.
 */
export const listInboxWithRows = cache(async (personId: string): Promise<(RequestListRow & { request: ApprovalRequestRow })[]> =>
  db()
    .select({ ...LIST_COLUMNS, request: getTableColumns(schema.approvalRequest) })
    .from(schema.approvalRequest)
    .innerJoin(requester, eq(requester.id, schema.approvalRequest.requesterPersonId))
    .leftJoin(subject, eq(subject.id, schema.approvalRequest.subjectPersonId))
    .innerJoin(schema.approvalAssignee, eq(schema.approvalAssignee.requestId, schema.approvalRequest.id))
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .where(myTurn(personId))
    .orderBy(asc(schema.approvalRequest.createdAt)),
);

/** Requests waiting for this person's answer, oldest first. */
export async function listInbox(personId: string): Promise<RequestListRow[]> {
  return (await listInboxWithRows(personId)).map(({ id, type, summary, status, link, createdAt, decidedAt, requesterPersonId, requesterName, subjectName }) => ({ id, type, summary, status, link, createdAt, decidedAt, requesterPersonId, requesterName, subjectName }));
}

/** Once per request: the home feed and the dashboard both show it. */
export const countInbox = cache(async (personId: string): Promise<number> => {
  const [row] = await db()
    .select({ value: count() })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.approvalAssignee.requestId))
    .where(myTurn(personId));
  return row?.value ?? 0;
});

export async function listMyRequests(personId: string, limit = 50): Promise<RequestListRow[]> {
  return listQuery().where(eq(schema.approvalRequest.requesterPersonId, personId)).orderBy(desc(schema.approvalRequest.createdAt)).limit(limit);
}

/** How many of this person's own requests are still open (pending, or returned for changes): the Me page's tile. */
export async function countMyOpenRequests(personId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(schema.approvalRequest)
    .where(and(eq(schema.approvalRequest.requesterPersonId, personId), inArray(schema.approvalRequest.status, OPEN_STATUSES)));
  return row?.value ?? 0;
}

export type OversightFilter = { /** "open" = pending or returned to the requester. */ state?: "open" | "decided"; type?: string; /** Filed on or after this day, Vietnam time. */ since?: IsoDate };
export type OversightRow = RequestListRow & {
  /** Whose answer an open request is waiting for, names joined — the requester's when it was returned; null once decided. */
  waitingOn: string | null;
  /** The approvers whose turn is open, one by one: whom an administrator may move the turn from. */
  waiting: { personId: string; name: string }[];
  subjectPersonId: string | null;
  /** Where the person the request is about sits — its requester, when it is about nobody: what `canReassignTurns` is asked against. */
  reassignTarget: SubjectTarget | null;
};

const OPEN_STATUSES: RequestStatus[] = ["pending", "returned"];

// Where a person sits, as the columns of a joined `person`: an authorization target per row
// without a query per row.
const REQUESTER_PLACE = { personId: requester.id, entityId: requester.primaryEntityId, unitPath: requester.orgUnitPath, managerId: requester.managerId };
const SUBJECT_PLACE = { personId: subject.id, entityId: subject.primaryEntityId, unitPath: subject.orgUnitPath, managerId: subject.managerId };

/**
 * Every request in the viewer's reach of `approval:oversee`, newest first, with whom each pending one is waiting for — the owner's "All requests" list. Not
 * cached: a summary can name a salary change or an offer, and restricted data never is.
 */
export async function listAllRequests(reach: ReturnType<typeof entityReach>, filter: OversightFilter = {}, limit = 200): Promise<OversightRow[]> {
  if (!reach.all && reach.entityIds.length === 0) return [];
  const conditions = [
    reach.all ? undefined : inArray(schema.approvalRequest.entityId, reach.entityIds),
    filter.state === "open" ? inArray(schema.approvalRequest.status, OPEN_STATUSES) : filter.state === "decided" ? notInArray(schema.approvalRequest.status, OPEN_STATUSES) : undefined,
    filter.type ? eq(schema.approvalRequest.type, filter.type) : undefined,
    filter.since ? gte(schema.approvalRequest.createdAt, new Date(`${filter.since}T00:00:00+07:00`)) : undefined,
  ];
  const rows = await db()
    .select({
      ...LIST_COLUMNS,
      // A request returned for changes waits on its requester.
      waitingOn: sql<string | null>`case when ${schema.approvalRequest.status} = 'returned' then ${requester.fullName} else (
        select string_agg(${schema.person.fullName}, ', ' order by ${schema.person.fullName})
        from ${schema.approvalAssignee}
        join ${schema.approvalStep} on ${schema.approvalStep.id} = ${schema.approvalAssignee.stepId}
        join ${schema.person} on ${schema.person.id} = ${schema.approvalAssignee.approverPersonId}
        where ${schema.approvalAssignee.requestId} = ${schema.approvalRequest.id}
          and ${schema.approvalAssignee.status} = 'pending' and ${schema.approvalStep.status} = 'pending'
          and ${schema.approvalRequest.status} = 'pending'
      ) end`,
      // The same people one by one, for the "reassign" control.
      waiting: sql<{ personId: string; name: string }[] | null>`(
        select json_agg(json_build_object('personId', ${schema.person.id}, 'name', ${schema.person.fullName}) order by ${schema.person.fullName})
        from ${schema.approvalAssignee}
        join ${schema.approvalStep} on ${schema.approvalStep.id} = ${schema.approvalAssignee.stepId}
        join ${schema.person} on ${schema.person.id} = ${schema.approvalAssignee.approverPersonId}
        where ${schema.approvalAssignee.requestId} = ${schema.approvalRequest.id}
          and ${schema.approvalAssignee.status} = 'pending' and ${schema.approvalStep.status} = 'pending'
          and ${schema.approvalRequest.status} = 'pending'
      )`,
      subjectPersonId: schema.approvalRequest.subjectPersonId,
      requesterPlace: REQUESTER_PLACE,
      subjectPlace: SUBJECT_PLACE,
    })
    .from(schema.approvalRequest)
    .innerJoin(requester, eq(requester.id, schema.approvalRequest.requesterPersonId))
    .leftJoin(subject, eq(subject.id, schema.approvalRequest.subjectPersonId))
    .where(and(...conditions))
    .orderBy(desc(schema.approvalRequest.createdAt), desc(schema.approvalRequest.id))
    .limit(limit);
  return rows.map(({ requesterPlace, subjectPlace, waiting, ...row }) => ({ ...row, waiting: waiting ?? [], reassignTarget: row.subjectPersonId ? (subjectPlace?.personId ? subjectPlace : null) : requesterPlace }));
}

export type TurnRow = RequestListRow & { subjectPersonId: string | null; reassignTarget: SubjectTarget | null };

/**
 * What is waiting for one person's answer, oldest first, each with where its subject sits — for an
 * administrator looking after the turns of someone who is away or suspended (PLT-02). The caller
 * shows only the rows it may reassign: the one-line summary never holds restricted values, but a
 * request is still the business of its parties and of whoever answers for its subject.
 */
export async function listTurnsOf(personId: string): Promise<TurnRow[]> {
  const rows = await db()
    .select({ ...LIST_COLUMNS, subjectPersonId: schema.approvalRequest.subjectPersonId, requesterPlace: REQUESTER_PLACE, subjectPlace: SUBJECT_PLACE })
    .from(schema.approvalRequest)
    .innerJoin(requester, eq(requester.id, schema.approvalRequest.requesterPersonId))
    .leftJoin(subject, eq(subject.id, schema.approvalRequest.subjectPersonId))
    .innerJoin(schema.approvalAssignee, eq(schema.approvalAssignee.requestId, schema.approvalRequest.id))
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .where(myTurn(personId))
    .orderBy(asc(schema.approvalRequest.createdAt));
  // Asked on two steps that are open together: one row.
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index).map(({ requesterPlace, subjectPlace, ...row }) => ({ ...row, reassignTarget: row.subjectPersonId ? (subjectPlace?.personId ? subjectPlace : null) : requesterPlace }));
}

/** What was filed in a window and how much of it is still open — the oversight digest's figures, counted in SQL. */
export async function requestsFiledBetween(from: Date, to: Date): Promise<{ filed: number; open: number }> {
  const [row] = await db()
    .select({
      filed: count(),
      open: sql<number>`(count(*) filter (where ${inArray(schema.approvalRequest.status, OPEN_STATUSES)}))::int`,
    })
    .from(schema.approvalRequest)
    .where(and(gte(schema.approvalRequest.createdAt, from), lt(schema.approvalRequest.createdAt, to)));
  return row ?? { filed: 0, open: 0 };
}

/**
 * The approvals page in one entry of the shared cache's live tier (src/lib/cache/live.ts): what
 * waits for the person and what they asked for. Dropped after their every action and every
 * notification to them — a request reaching or leaving their turn is always one of the two.
 */
export function loadApprovalsPage(personId: string): Promise<{ inbox: (RequestListRow & { request: ApprovalRequestRow })[]; mine: RequestListRow[] }> {
  return cachedLive(personId, "approvals", async () => {
    const [inbox, mine] = await Promise.all([listInboxWithRows(personId), listMyRequests(personId)]);
    return { inbox, mine };
  });
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
  steps: { key: string; mode: "any" | "all"; status: string; parallel: boolean; assignees: { personId: string; name: string; status: string; comment: string | null; decidedAt: Date | null; delegatedFromName: string | null }[] }[];
  events: { id: number; type: string; actorPersonId: string | null; actorName: string | null; comment: string | null; meta: Record<string, unknown> | null; at: Date }[];
  isRequester: boolean;
  /** It is this viewer's turn to answer. */
  canDecide: boolean;
  /** The viewer may move an open turn to somebody else (`canReassignTurns`), and there is one to move. */
  canReassign: boolean;
};

/** A request with its history. null = not found, or none of the viewer's business. */
export async function getRequest(viewer: { personId: string; principal: Principal }, definition: RequestTypeDefinition, requestId: string): Promise<RequestView | null> {
  const [request] = await db().select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, definition.type))).limit(1);
  if (!request) return null;
  const actor = alias(schema.person, "actor");
  const delegator = alias(schema.person, "delegator");
  const [steps, assignees, events, target, names, requesterPlace] = await Promise.all([
    db().select().from(schema.approvalStep).where(eq(schema.approvalStep.requestId, requestId)).orderBy(asc(schema.approvalStep.stepIndex)),
    db()
      .select({ row: schema.approvalAssignee, name: schema.person.fullName, delegatedFromName: delegator.fullName })
      .from(schema.approvalAssignee)
      .innerJoin(schema.person, eq(schema.person.id, schema.approvalAssignee.approverPersonId))
      .leftJoin(delegator, eq(delegator.id, schema.approvalAssignee.delegatedFromPersonId))
      .where(eq(schema.approvalAssignee.requestId, requestId))
      .orderBy(asc(schema.approvalAssignee.id)),
    db()
      .select({ id: schema.approvalEvent.id, type: schema.approvalEvent.type, actorPersonId: schema.approvalEvent.actorPersonId, actorName: actor.fullName, comment: schema.approvalEvent.comment, meta: schema.approvalEvent.meta, at: schema.approvalEvent.at })
      .from(schema.approvalEvent)
      .leftJoin(actor, eq(actor.id, schema.approvalEvent.actorPersonId))
      .where(eq(schema.approvalEvent.requestId, requestId))
      .orderBy(asc(schema.approvalEvent.id)),
    subjectTarget(db(), request.subjectPersonId),
    db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, [request.requesterPersonId, ...(request.subjectPersonId ? [request.subjectPersonId] : [])])),
    // A request about nobody is reassigned by whoever answers for its requester.
    request.subjectPersonId ? null : subjectTarget(db(), request.requesterPersonId),
  ]);

  const isRequester = request.requesterPersonId === viewer.personId;
  const isApprover = assignees.some(({ row }) => row.approverPersonId === viewer.personId || row.delegatedFromPersonId === viewer.personId);
  if (!canOpenRequest(request, { personId: viewer.personId, isApprover, typeAllows: !!definition.canView?.(viewer.principal, target) || canOverseeRequests(viewer.principal, { entityId: request.entityId }) })) return null;

  // Steps that are open together are all "pending"; the viewer's turn may be on any of them.
  const openStepIds = new Set(steps.filter((step) => step.status === "pending").map((step) => step.id));
  return {
    request,
    requesterName: names.find((row) => row.id === request.requesterPersonId)?.fullName ?? "—",
    subjectName: names.find((row) => row.id === request.subjectPersonId)?.fullName ?? null,
    subject: target,
    steps: steps.map((step) => ({
      key: step.key,
      mode: step.mode,
      status: step.status,
      parallel: step.parallel,
      assignees: assignees.filter(({ row }) => row.stepId === step.id).map(({ row, name, delegatedFromName }) => ({ personId: row.approverPersonId, name, status: row.status, comment: row.comment, decidedAt: row.decidedAt, delegatedFromName })),
    })),
    events,
    isRequester,
    canDecide: request.status === "pending" && !isRequester && request.subjectPersonId !== viewer.personId && assignees.some(({ row }) => openStepIds.has(row.stepId) && row.approverPersonId === viewer.personId && row.status === "pending"),
    canReassign: request.status === "pending" && assignees.some(({ row }) => openStepIds.has(row.stepId) && row.status === "pending") && canReassignTurns(viewer.principal, request, request.subjectPersonId ? target : requesterPlace),
  };
}
