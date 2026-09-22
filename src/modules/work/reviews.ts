// The review step on a task (FR-WRK-08): the people doing the work hand in a deliverable — a file
// already on the task, or a link — and a reviewer approves it or asks for changes. Every hand-in is
// a new version that stays on the record with its decision; each "changes requested" is a round.
//
// Review chains (FR-PJM-50) extend it: when a chain applies to the task, the version passes its
// stages in order — each decision a `work_deliverable_decision` row, approval moving it on by
// itself, "changes required" sending it back to work as a round. A client stage is the client's
// decision, recorded by the account side with evidence (FR-PJM-51); the client's approval freezes
// the version. A task no chain applies to keeps the single step, exactly as before.
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { TASK_FILE_OWNER } from "./attachments";
import { runTaskAutomations } from "./automations";
import { chainForTask, findReviewChain } from "./chains";
import { freezesVersion, isClientStage, parseReviewerRule, type ReviewerFacts, resolveStageReviewer, type StageDecision, stageDueAt, stageOutcome } from "./engine/delivery";
import { pickReviewer, stateOnApproval, stateOnChangesRequested, stateOnSubmit } from "./engine/review";
import type { StateCategory } from "./enums";
import { autoFollow, notifyFollowers } from "./followers";
import { publishBlocks } from "./publish-gate";
import type { ClientDecisionFacts, ReviewStage } from "./schema";
import { type LoadedTask, loadTask, logActivity, taskKey, updateWorkTaskIn, WORK_KIND } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
export type DeliverableRow = typeof schema.workDeliverable.$inferSelect;
export type ReviewDecision = "approved" | "changes_requested";
export type DeliverableInput = { kind: "file"; fileId: string; note: string | null } | { kind: "link"; url: string; note: string | null };
type Actor = { personId: string; fullName: string };

const reviewStates = async (tx: Executor, teamId: string) => (await tx.select().from(schema.workState).where(eq(schema.workState.teamId, teamId))).map((state) => ({ id: state.id, name: state.name, category: state.category as StateCategory, sortOrder: state.sortOrder, isActive: state.isActive }));

/** The task's own reviewer, else the project's lead, else the team's leads — the first who is active and is not the submitter. */
async function resolveReviewer(tx: Executor, loaded: LoadedTask, submitterId: string): Promise<string | null> {
  const leads = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, loaded.team.id), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.personId));
  const candidates = [loaded.work.reviewerPersonId, loaded.project?.leadPersonId, ...leads.map((lead) => lead.personId)].filter((id): id is string => !!id);
  if (candidates.length === 0) return null;
  const active = await tx.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, candidates), inArray(schema.person.status, ["active", "preboarding"])));
  return pickReviewer(candidates.filter((id) => active.some((person) => person.id === id)), submitterId);
}

/** The client of a task: its own, else its project's. The account manager on it records client decisions outside a project. */
export async function clientOfTask(loaded: LoadedTask, executor: Executor = db()): Promise<{ id: string | null; name: string | null; accountManagerPersonId: string | null }> {
  const clientId = loaded.work.clientId ?? loaded.project?.clientId ?? null;
  if (!clientId) return { id: null, name: null, accountManagerPersonId: null };
  const [client] = await executor.select({ name: schema.workClient.name, accountManagerPersonId: schema.workClient.accountManagerPersonId }).from(schema.workClient).where(eq(schema.workClient.id, clientId)).limit(1);
  return { id: clientId, name: client?.name ?? null, accountManagerPersonId: client?.accountManagerPersonId ?? null };
}

/**
 * Everyone a stage's reviewer rule could name, in the order each rule tries them. `rule` is the
 * stage's: a stage naming one person needs that person checked as still here too.
 */
async function reviewerFacts(tx: Executor, loaded: LoadedTask, rule: string): Promise<ReviewerFacts> {
  const parsed = parseReviewerRule(rule);
  const named = parsed?.kind === "person" ? parsed.personId : null;
  const projectId = loaded.work.projectId;
  const [leads, projectRoles, client] = await Promise.all([
    tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, loaded.team.id), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.personId)),
    projectId
      ? tx.select({ personId: schema.workProjectMember.personId, role: schema.workProjectMember.role }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), inArray(schema.workProjectMember.role, ["lead", "account_manager"]))).orderBy(asc(schema.workProjectMember.createdAt))
      : Promise.resolve([] as { personId: string; role: string }[]),
    clientOfTask(loaded, tx),
  ]);
  const projectLeadIds = [...new Set([loaded.project?.leadPersonId, ...projectRoles.filter((row) => row.role === "lead").map((row) => row.personId)].filter((id): id is string => !!id))];
  const accountManagerIds = [...new Set([...projectRoles.filter((row) => row.role === "account_manager").map((row) => row.personId), client.accountManagerPersonId].filter((id): id is string => !!id))];
  const everyone = [...new Set([named, loaded.work.reviewerPersonId, ...projectLeadIds, ...leads.map((lead) => lead.personId), ...accountManagerIds].filter((id): id is string => !!id))];
  const active = everyone.length ? await tx.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, everyone), inArray(schema.person.status, ["active", "preboarding"]))) : [];
  return { taskReviewerId: loaded.work.reviewerPersonId, projectLeadIds, teamLeadIds: leads.map((lead) => lead.personId), accountManagerIds, active: new Set(active.map((row) => row.id)) };
}

export async function pendingDeliverable(taskId: string, executor: Executor = db()): Promise<DeliverableRow | undefined> {
  const [row] = await executor.select().from(schema.workDeliverable).where(and(eq(schema.workDeliverable.taskId, taskId), eq(schema.workDeliverable.decision, "pending"))).orderBy(desc(schema.workDeliverable.version)).limit(1);
  return row;
}

export async function findDeliverable(deliverableId: string, executor: Executor = db()): Promise<DeliverableRow | undefined> {
  const [row] = await executor.select().from(schema.workDeliverable).where(eq(schema.workDeliverable.id, deliverableId)).limit(1);
  return row;
}

/** The stage a pending chain version waits at, as the chain reads now; null = not in a chain. */
export async function currentStage(deliverable: Pick<DeliverableRow, "chainId" | "stageIndex">, executor: Executor = db()): Promise<{ index: number; count: number; stage: ReviewStage } | null> {
  if (!deliverable.chainId) return null;
  const chain = await findReviewChain(deliverable.chainId, executor);
  const stages = chain?.stages ?? [];
  if (stages.length === 0) return null;
  // A stage removed from the chain under a running version: it waits at the last one left.
  const index = Math.min(deliverable.stageIndex, stages.length - 1);
  return { index, count: stages.length, stage: stages[index] };
}

const notifyReviewer = async (tx: Executor, loaded: LoadedTask, reviewerPersonId: string, actor: Actor, version: number) => {
  await autoFollow(tx, loaded.task.id, [reviewerPersonId]);
  const params = { name: actor.fullName, version };
  const told = await notifyFollowers(tx, (await loadTask(loaded.task.id, tx))!, actor.personId, "tasks.review_requested", params, [reviewerPersonId]);
  if (!told.includes(reviewerPersonId)) await notify({ recipients: [reviewerPersonId], kind: "tasks.review_requested", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: `/work/tasks/${loaded.task.id}` }, tx);
};

export async function submitDeliverable(taskId: string, input: DeliverableInput, actor: Actor): Promise<{ deliverable: DeliverableRow; reviewerPersonId: string; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (loaded.task.status === "cancelled") throw new ActionError("review_task_closed");

    let label: string;
    if (input.kind === "file") {
      const [file] = await tx.select().from(schema.storedFile).where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, TASK_FILE_OWNER), eq(schema.storedFile.ownerId, taskId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).limit(1);
      if (!file) throw new ActionError("file_not_found");
      label = file.fileName;
    } else label = input.url;

    // A chain applies by project, team and format (FR-PJM-50); none = the single step, as it always was.
    const chain = await chainForTask(tx, { teamId: loaded.team.id, projectId: loaded.work.projectId, contentFormat: loaded.work.contentFormat });
    const firstStage = chain?.stages[0];
    const reviewerPersonId = firstStage ? resolveStageReviewer(firstStage.reviewer, await reviewerFacts(tx, loaded, firstStage.reviewer), actor.personId) : await resolveReviewer(tx, loaded, actor.personId);
    if (!reviewerPersonId) throw new ActionError("review_no_reviewer");

    // A version handed in again before anyone looked at it replaces the waiting one; it is no round.
    await tx.update(schema.workDeliverable).set({ decision: "superseded", decidedAt: new Date() }).where(and(eq(schema.workDeliverable.taskId, taskId), eq(schema.workDeliverable.decision, "pending")));
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${schema.workDeliverable.version}), 0)` }).from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, taskId));
    const version = Number(last) + 1;
    const now = new Date();
    const [deliverable] = await tx
      .insert(schema.workDeliverable)
      .values({
        taskId,
        version,
        kind: input.kind,
        fileId: input.kind === "file" ? input.fileId : null,
        url: input.kind === "link" ? input.url : null,
        note: input.note,
        submittedByPersonId: actor.personId,
        submittedAt: now,
        ...(chain && firstStage ? { chainId: chain.id, stageIndex: 0, stageReviewerPersonId: reviewerPersonId, stageDueAt: stageDueAt(now, firstStage.dueHours) } : {}),
      })
      .returning();

    // In a chain the stage's reviewer is on the version; the task's own reviewer stays what it was set to.
    await tx
      .update(schema.workTask)
      .set(chain ? { reviewStatus: "submitted" } : { reviewStatus: "submitted", reviewerPersonId })
      .where(eq(schema.workTask.taskId, taskId));
    const target = stateOnSubmit(await reviewStates(tx, loaded.team.id), loaded.work.stateId);
    if (target) await updateWorkTaskIn(tx, taskId, { stateId: target }, actor.personId, { quiet: true });
    else await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await logActivity(tx, taskId, actor.personId, [{ type: "review_submitted", to: { version, kind: input.kind, name: label, note: input.note, ...(firstStage ? { stage: firstStage.name } : {}) } }]);

    await notifyReviewer(tx, loaded, reviewerPersonId, actor, version);
    return { deliverable, reviewerPersonId, loaded };
  });
}

export async function decideReview(taskId: string, decision: ReviewDecision, comment: string | null, actor: Actor): Promise<{ deliverable: DeliverableRow; revisionRounds: number; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const pending = await pendingDeliverable(taskId, tx);
    if (!pending || loaded.work.reviewStatus !== "submitted") throw new ActionError("review_not_pending");
    // A version on its way through a chain is decided stage by stage (`decideStage`), never around it.
    if (pending.chainId) throw new ActionError("review_in_chain");
    // Checked by the policy too; here so that no caller can forget it.
    if (pending.submittedByPersonId === actor.personId) throw new ActionError("review_own_work");
    if (decision === "changes_requested" && !comment) throw new ActionError("review_comment_required");

    const [deliverable] = await tx.update(schema.workDeliverable).set({ decision, decidedByPersonId: actor.personId, decidedAt: new Date(), decisionComment: comment }).where(eq(schema.workDeliverable.id, pending.id)).returning();
    const revisionRounds = loaded.work.revisionRounds + (decision === "changes_requested" ? 1 : 0);
    await tx.update(schema.workTask).set({ reviewStatus: decision, revisionRounds }).where(eq(schema.workTask.taskId, taskId));
    const states = await reviewStates(tx, loaded.team.id);
    let target = decision === "approved" ? stateOnApproval(states, loaded.work.stateId) : stateOnChangesRequested(states, loaded.work.stateId);
    // An approval does not publish anything: a "Published" next step waits for the post (FR-PJM-54).
    const targetState = states.find((state) => state.id === target);
    if (target && targetState && (await publishBlocks(tx, { id: taskId, channel: loaded.work.channel }, targetState))) target = null;
    // The reviewer's decision moves the task; it is no stage hand-off of theirs (FR-PJM-40). Handing
    // the work in, above, is the doer's move and does pass the gate.
    if (target) await updateWorkTaskIn(tx, taskId, { stateId: target }, actor.personId, { quiet: true, handoff: "system" });
    else await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await logActivity(tx, taskId, actor.personId, [{ type: decision === "approved" ? "review_approved" : "review_changes_requested", to: { version: deliverable.version, comment, round: revisionRounds } }]);

    await autoFollow(tx, taskId, [actor.personId]);
    const params = { name: actor.fullName, version: deliverable.version, decision };
    const told = await notifyFollowers(tx, (await loadTask(taskId, tx))!, actor.personId, "tasks.review_decided", params);
    // The person who handed it in hears even if they muted the task: it is their work that came back.
    if (!told.includes(pending.submittedByPersonId)) await notify({ recipients: [pending.submittedByPersonId], kind: "tasks.review_decided", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: `/work/tasks/${taskId}` }, tx);
    await runTaskAutomations(tx, taskId, { type: decision === "approved" ? "deliverable_approved" : "changes_requested" });
    return { deliverable, revisionRounds, loaded };
  });
}

// ── Review chains and client decisions (FR-PJM-50, 51) ──────────────────────────────────────

/** What the account person enters for the client's decision. Evidence is a file on the task or an https link. */
export type ClientFactsInput = { channel: string; decidedByName: string; decidedOn: string; evidenceFileId: string | null; evidenceUrl: string | null };

async function checkEvidence(tx: Executor, taskId: string, facts: ClientFactsInput): Promise<ClientDecisionFacts> {
  if (!facts.evidenceFileId && !facts.evidenceUrl) throw new ActionError("client_evidence_required");
  if (facts.evidenceFileId) {
    const [file] = await tx.select({ id: schema.storedFile.id }).from(schema.storedFile).where(and(eq(schema.storedFile.id, facts.evidenceFileId), eq(schema.storedFile.ownerType, TASK_FILE_OWNER), eq(schema.storedFile.ownerId, taskId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).limit(1);
    if (!file) throw new ActionError("file_not_found");
  }
  return { channel: facts.channel, decidedByName: facts.decidedByName, decidedOn: facts.decidedOn, evidenceFileId: facts.evidenceFileId, evidenceUrl: facts.evidenceUrl };
}

type Decided = { deliverable: DeliverableRow; outcome: "next" | "approved" | "changes" | "recorded"; revisionRounds: number; loaded: LoadedTask };

/**
 * A decision that ends the version's review: approved (the next step of the workflow, unless that is
 * a "Published" state the post has not reached) or changes required (back to work, one more round).
 */
async function closeReview(tx: Executor, loaded: LoadedTask, deliverable: DeliverableRow, decision: StageDecision, comment: string | null, actor: Actor, options: { freeze: boolean }): Promise<{ deliverable: DeliverableRow; revisionRounds: number }> {
  const approved = decision !== "changes_required";
  const now = new Date();
  const [updated] = await tx
    .update(schema.workDeliverable)
    .set({ decision: approved ? "approved" : "changes_requested", decidedByPersonId: actor.personId, decidedAt: now, decisionComment: comment, stageDueAt: null, ...(options.freeze ? { frozenAt: now } : {}) })
    .where(eq(schema.workDeliverable.id, deliverable.id))
    .returning();
  const revisionRounds = loaded.work.revisionRounds + (approved ? 0 : 1);
  await tx.update(schema.workTask).set({ reviewStatus: approved ? "approved" : "changes_requested", revisionRounds }).where(eq(schema.workTask.taskId, loaded.task.id));
  const states = await reviewStates(tx, loaded.team.id);
  let target = approved ? stateOnApproval(states, loaded.work.stateId) : stateOnChangesRequested(states, loaded.work.stateId);
  const targetState = states.find((state) => state.id === target);
  if (target && targetState && (await publishBlocks(tx, { id: loaded.task.id, channel: loaded.work.channel }, targetState))) target = null;
  if (target) await updateWorkTaskIn(tx, loaded.task.id, { stateId: target }, actor.personId, { quiet: true, handoff: "system" });
  else await tx.update(schema.task).set({ updatedAt: now }).where(eq(schema.task.id, loaded.task.id));
  await logActivity(tx, loaded.task.id, actor.personId, [{ type: approved ? "review_approved" : "review_changes_requested", to: { version: updated.version, comment, round: revisionRounds, ...(decision === "approved_with_changes" ? { withChanges: true } : {}) } }]);

  await autoFollow(tx, loaded.task.id, [actor.personId]);
  const params = { name: actor.fullName, version: updated.version, decision: approved ? "approved" : "changes_requested" };
  const told = await notifyFollowers(tx, (await loadTask(loaded.task.id, tx))!, actor.personId, "tasks.review_decided", params);
  if (!told.includes(deliverable.submittedByPersonId) && deliverable.submittedByPersonId !== actor.personId) await notify({ recipients: [deliverable.submittedByPersonId], kind: "tasks.review_decided", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: `/work/tasks/${loaded.task.id}` }, tx);
  await runTaskAutomations(tx, loaded.task.id, { type: approved ? "deliverable_approved" : "changes_requested" });
  return { deliverable: updated, revisionRounds };
}

/** `tasks.client_decision` to the assignee and the project's lead — whoever recorded it excepted. */
async function tellClientDecision(tx: Executor, loaded: LoadedTask, actor: Actor) {
  const recipients = [...new Set([loaded.task.assigneePersonId, loaded.project?.leadPersonId].filter((id): id is string => !!id && id !== actor.personId))];
  await notify({ recipients, kind: "tasks.client_decision", params: { actor: actor.fullName, task: `${taskKey(loaded.team.key, loaded.work.number)} ${loaded.task.title}` }, link: `/work/tasks/${loaded.task.id}` }, tx);
}

export type StageDecisionInput = { decision: StageDecision; comment: string | null; client: ClientFactsInput | null };

/**
 * Decides the stage a chain version waits at. Approved (with or without changes) moves it to the
 * next stage — or, at the last, approves it as the single step would; changes required sends it
 * back to work as a round. The client's approval freezes the version.
 */
export async function decideStage(taskId: string, input: StageDecisionInput, actor: Actor): Promise<Decided> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const pending = await pendingDeliverable(taskId, tx);
    if (!pending || !pending.chainId || loaded.work.reviewStatus !== "submitted") throw new ActionError("review_not_pending");
    const current = await currentStage(pending, tx);
    if (!current) throw new ActionError("review_not_pending");
    const client = isClientStage(current.stage);
    // A client stage records the client's decision; everywhere else nobody passes their own work.
    if (!client && pending.submittedByPersonId === actor.personId) throw new ActionError("review_own_work");
    if (client && !input.client) throw new ActionError("client_evidence_required");
    if (input.decision !== "approved" && !input.comment) throw new ActionError("review_comment_required");
    const clientFacts = client ? await checkEvidence(tx, taskId, input.client!) : null;

    await tx.insert(schema.workDeliverableDecision).values({ deliverableId: pending.id, stageIndex: current.index, stageName: current.stage.name, decision: input.decision, decidedByPersonId: actor.personId, comment: input.comment, isClient: client, client: clientFacts });
    const outcome = stageOutcome(current.count, current.index, input.decision);

    if (outcome.kind === "next") {
      const next = (await findReviewChain(pending.chainId, tx))!.stages[outcome.stageIndex];
      const reviewerPersonId = resolveStageReviewer(next.reviewer, await reviewerFacts(tx, loaded, next.reviewer), pending.submittedByPersonId);
      if (!reviewerPersonId) throw new ActionError("review_no_reviewer");
      const now = new Date();
      const [deliverable] = await tx.update(schema.workDeliverable).set({ stageIndex: outcome.stageIndex, stageReviewerPersonId: reviewerPersonId, stageDueAt: stageDueAt(now, next.dueHours) }).where(eq(schema.workDeliverable.id, pending.id)).returning();
      // Internal review → Client review: the workflow's next review state follows the stage, when there is one.
      const states = await reviewStates(tx, loaded.team.id);
      const onward = stateOnApproval(states, loaded.work.stateId);
      if (onward && states.find((state) => state.id === onward)?.category === "in_review") await updateWorkTaskIn(tx, taskId, { stateId: onward }, actor.personId, { quiet: true, handoff: "system" });
      else await tx.update(schema.task).set({ updatedAt: now }).where(eq(schema.task.id, taskId));
      await logActivity(tx, taskId, actor.personId, [{ type: "review_stage_passed", to: { version: pending.version, name: current.stage.name, next: next.name, decision: input.decision, comment: input.comment } }]);
      await notifyReviewer(tx, loaded, reviewerPersonId, actor, pending.version);
      if (client) {
        await tellClientDecision(tx, loaded, actor);
        await runTaskAutomations(tx, taskId, { type: "client_decision", decision: input.decision });
      }
      return { deliverable, outcome: "next", revisionRounds: loaded.work.revisionRounds, loaded };
    }

    const closed = await closeReview(tx, loaded, pending, input.decision, input.comment, actor, { freeze: client && freezesVersion(input.decision) });
    if (client) {
      await logActivity(tx, taskId, actor.personId, [{ type: "review_client_decided", to: { version: pending.version, name: clientFacts!.decidedByName, decision: input.decision, channel: clientFacts!.channel } }]);
      await tellClientDecision(tx, loaded, actor);
      await runTaskAutomations(tx, taskId, { type: "client_decision", decision: input.decision });
    }
    return { deliverable: closed.deliverable, outcome: outcome.kind, revisionRounds: closed.revisionRounds, loaded };
  });
}

/**
 * The client's decision on any version, outside a chain's client stage (FR-PJM-51): after the
 * internal review, a comment on a version sent by email, a meeting. A version waiting at a client
 * stage is decided through that stage. Approval freezes the version — and, if it was still under
 * internal review, closes that review as approved: the client has the last word. Changes required
 * apply to the latest version only and send it back to work as a client round.
 */
export async function recordClientDecision(deliverableId: string, input: { decision: StageDecision; comment: string | null; client: ClientFactsInput }, actor: Actor): Promise<Decided> {
  const found = await findDeliverable(deliverableId);
  if (!found) throw new ActionError("deliverable_not_found");
  const stage = found.decision === "pending" ? await currentStage(found) : null;
  if (stage && isClientStage(stage.stage)) return decideStage(found.taskId, input, actor);

  return db().transaction(async (tx) => {
    const deliverable = (await findDeliverable(deliverableId, tx))!;
    const loaded = await loadTask(deliverable.taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (deliverable.frozenAt) throw new ActionError("deliverable_frozen");
    if (deliverable.decision === "superseded") throw new ActionError("deliverable_superseded");
    if (input.decision === "changes_required" && !input.comment) throw new ActionError("review_comment_required");
    const [{ latest }] = await tx.select({ latest: sql<number>`max(${schema.workDeliverable.version})` }).from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, deliverable.taskId));
    if (input.decision === "changes_required" && deliverable.version !== Number(latest)) throw new ActionError("client_decision_not_latest");
    const clientFacts = await checkEvidence(tx, deliverable.taskId, input.client);

    await tx.insert(schema.workDeliverableDecision).values({ deliverableId, stageIndex: deliverable.stageIndex, stageName: null, decision: input.decision, decidedByPersonId: actor.personId, comment: input.comment, isClient: true, client: clientFacts });
    let result: Decided;
    if (deliverable.decision === "pending" || (deliverable.decision === "approved" && input.decision === "changes_required")) {
      // Still in review, or approved internally and now sent back by the client: the version's review ends here.
      const closed = await closeReview(tx, loaded, deliverable, input.decision, input.comment, actor, { freeze: freezesVersion(input.decision) });
      result = { deliverable: closed.deliverable, outcome: freezesVersion(input.decision) ? "approved" : "changes", revisionRounds: closed.revisionRounds, loaded };
    } else {
      // Approved already, or sent back already: the client's word is recorded; an approval freezes the version.
      const [updated] = freezesVersion(input.decision) ? await tx.update(schema.workDeliverable).set({ frozenAt: new Date() }).where(eq(schema.workDeliverable.id, deliverableId)).returning() : [deliverable];
      result = { deliverable: updated, outcome: "recorded", revisionRounds: loaded.work.revisionRounds, loaded };
    }
    await logActivity(tx, deliverable.taskId, actor.personId, [{ type: "review_client_decided", to: { version: deliverable.version, name: clientFacts.decidedByName, decision: input.decision, channel: clientFacts.channel } }]);
    await tellClientDecision(tx, loaded, actor);
    await runTaskAutomations(tx, deliverable.taskId, { type: "client_decision", decision: input.decision });
    return result;
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type DecisionView = { id: string; deliverableId: string; stageIndex: number; stageName: string | null; decision: string; comment: string | null; isClient: boolean; client: ClientDecisionFacts | null; decidedByName: string | null; createdAt: Date; evidenceFileName: string | null };

export type DeliverableView = Pick<DeliverableRow, "id" | "version" | "kind" | "fileId" | "url" | "note" | "submittedAt" | "decision" | "decidedAt" | "decisionComment" | "submittedByPersonId" | "chainId" | "stageIndex" | "stageReviewerPersonId" | "stageDueAt" | "frozenAt"> & {
  fileName: string | null;
  contentType: string | null;
  submittedByName: string | null;
  decidedByName: string | null;
  stageReviewerName: string | null;
  /** The chain's stage names as it reads now, for a version that went through one. */
  stages: string[];
  /** Which of those stages is the client's. */
  clientStageIndex: number | null;
  decisions: DecisionView[];
};

/** Newest first, each version with its stage decisions and the client's (oldest first). */
export async function listDeliverables(taskId: string): Promise<DeliverableView[]> {
  const submitter = alias(schema.person, "submitter");
  const decider = alias(schema.person, "decider");
  const stageReviewer = alias(schema.person, "stage_reviewer");
  const rows = await db()
    .select({
      id: schema.workDeliverable.id,
      version: schema.workDeliverable.version,
      kind: schema.workDeliverable.kind,
      fileId: schema.workDeliverable.fileId,
      url: schema.workDeliverable.url,
      note: schema.workDeliverable.note,
      submittedAt: schema.workDeliverable.submittedAt,
      decision: schema.workDeliverable.decision,
      decidedAt: schema.workDeliverable.decidedAt,
      decisionComment: schema.workDeliverable.decisionComment,
      submittedByPersonId: schema.workDeliverable.submittedByPersonId,
      chainId: schema.workDeliverable.chainId,
      stageIndex: schema.workDeliverable.stageIndex,
      stageReviewerPersonId: schema.workDeliverable.stageReviewerPersonId,
      stageDueAt: schema.workDeliverable.stageDueAt,
      frozenAt: schema.workDeliverable.frozenAt,
      fileName: schema.storedFile.fileName,
      contentType: schema.storedFile.contentType,
      submittedByName: submitter.fullName,
      decidedByName: decider.fullName,
      stageReviewerName: stageReviewer.fullName,
      stages: schema.workReviewChain.stages,
    })
    .from(schema.workDeliverable)
    .leftJoin(schema.storedFile, eq(schema.storedFile.id, schema.workDeliverable.fileId))
    .leftJoin(submitter, eq(submitter.id, schema.workDeliverable.submittedByPersonId))
    .leftJoin(decider, eq(decider.id, schema.workDeliverable.decidedByPersonId))
    .leftJoin(stageReviewer, eq(stageReviewer.id, schema.workDeliverable.stageReviewerPersonId))
    .leftJoin(schema.workReviewChain, eq(schema.workReviewChain.id, schema.workDeliverable.chainId))
    .where(eq(schema.workDeliverable.taskId, taskId))
    .orderBy(desc(schema.workDeliverable.version));
  const ids = rows.map((row) => row.id);
  const evidence = alias(schema.storedFile, "evidence");
  const decisions = ids.length
    ? await db()
        .select({ decision: schema.workDeliverableDecision, decidedByName: schema.person.fullName, evidenceFileName: evidence.fileName })
        .from(schema.workDeliverableDecision)
        .leftJoin(schema.person, eq(schema.person.id, schema.workDeliverableDecision.decidedByPersonId))
        .leftJoin(evidence, eq(evidence.id, sql`(${schema.workDeliverableDecision.client} ->> 'evidenceFileId')::uuid`))
        .where(inArray(schema.workDeliverableDecision.deliverableId, ids))
        .orderBy(asc(schema.workDeliverableDecision.createdAt))
    : [];
  const byVersion = Map.groupBy(decisions, (row) => row.decision.deliverableId);
  return rows.map(({ stages, ...row }) => ({
    ...row,
    stages: (stages ?? []).map((stage) => stage.name),
    clientStageIndex: (() => {
      const index = (stages ?? []).findIndex((stage) => isClientStage(stage));
      return index >= 0 ? index : null;
    })(),
    decisions: (byVersion.get(row.id) ?? []).map(({ decision, decidedByName, evidenceFileName }) => ({ id: decision.id, deliverableId: decision.deliverableId, stageIndex: decision.stageIndex, stageName: decision.stageName, decision: decision.decision, comment: decision.comment, isClient: decision.isClient, client: decision.client, decidedByName, createdAt: decision.createdAt, evidenceFileName })),
  }));
}

export type ReviewWaiting = { taskId: string; key: string; title: string; dueDate: string | null; priority: number | null; projectName: string | null; version: number; submittedByName: string | null; submittedAt: Date; deliverableId: string; stageName: string | null; stageDueAt: Date | null; isClient: boolean };

/**
 * Who a pending version waits for: the task's reviewer for a single-step review, the stage's
 * reviewer for a version in a chain.
 */
const waitingFor = (personId: string) =>
  or(
    and(isNull(schema.workDeliverable.chainId), eq(schema.workTask.reviewerPersonId, personId)),
    and(isNotNull(schema.workDeliverable.chainId), eq(schema.workDeliverable.stageReviewerPersonId, personId)),
  );

/** Deliverables waiting for this person's decision — a section of My work (FR-WRK-06), with the stage it waits at. */
export async function listReviewsWaitingFor(personId: string): Promise<ReviewWaiting[]> {
  const rows = await db()
    .select({ taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, dueDate: schema.task.dueDate, priority: schema.task.priority, projectName: schema.workProject.name, version: schema.workDeliverable.version, submittedByName: schema.person.fullName, submittedAt: schema.workDeliverable.submittedAt, deliverableId: schema.workDeliverable.id, stageIndex: schema.workDeliverable.stageIndex, stageDueAt: schema.workDeliverable.stageDueAt, stages: schema.workReviewChain.stages })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .innerJoin(schema.workDeliverable, and(eq(schema.workDeliverable.taskId, schema.task.id), eq(schema.workDeliverable.decision, "pending")))
    .leftJoin(schema.workReviewChain, eq(schema.workReviewChain.id, schema.workDeliverable.chainId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workDeliverable.submittedByPersonId))
    .where(and(waitingFor(personId), eq(schema.workTask.reviewStatus, "submitted"), eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt)))
    .orderBy(asc(schema.workDeliverable.submittedAt));
  return rows.map(({ number, teamKey, stages, stageIndex, ...row }) => {
    const stage = stages?.length ? stages[Math.min(stageIndex, stages.length - 1)] : undefined;
    return { ...row, key: taskKey(teamKey, number), stageName: stage?.name ?? null, isClient: isClientStage(stage) };
  });
}

export async function countReviewsWaitingFor(personId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .innerJoin(schema.workDeliverable, and(eq(schema.workDeliverable.taskId, schema.task.id), eq(schema.workDeliverable.decision, "pending")))
    .where(and(waitingFor(personId), eq(schema.workTask.reviewStatus, "submitted"), eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt)));
  return row?.value ?? 0;
}

/**
 * A chain stage past its due time (FR-PJM-50): the stage's reviewer is reminded once per stage — the
 * reminder is keyed by the stage's due day, so the morning job repeating, or the next morning's,
 * says nothing more. A notice of its own (`tasks.review_overdue`), naming the stage: a second
 * "ready for review" would read as a new version.
 */
export async function sendReviewOverdueReminders(now: Date = new Date()): Promise<{ overdueReviews: number }> {
  const rows = await db()
    .select({ taskId: schema.task.id, title: schema.task.title, number: schema.workTask.number, teamKey: schema.workTeam.key, reviewerId: schema.workDeliverable.stageReviewerPersonId, dueAt: schema.workDeliverable.stageDueAt, stageIndex: schema.workDeliverable.stageIndex, stages: schema.workReviewChain.stages })
    .from(schema.workDeliverable)
    .innerJoin(schema.task, eq(schema.task.id, schema.workDeliverable.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workReviewChain, eq(schema.workReviewChain.id, schema.workDeliverable.chainId))
    .where(and(eq(schema.workDeliverable.decision, "pending"), isNotNull(schema.workDeliverable.chainId), isNotNull(schema.workDeliverable.stageReviewerPersonId), lt(schema.workDeliverable.stageDueAt, now), isNull(schema.task.deletedAt)));
  let overdueReviews = 0;
  for (const row of rows) {
    await db().transaction(async (tx) => {
      const [fresh] = await tx.insert(schema.workReminderSent).values({ taskId: row.taskId, personId: row.reviewerId!, kind: "review_overdue", sentOn: todayInVietnam(row.dueAt!) }).onConflictDoNothing().returning({ taskId: schema.workReminderSent.taskId });
      if (!fresh) return;
      const stage = row.stages?.length ? row.stages[Math.min(row.stageIndex, row.stages.length - 1)] : undefined;
      await notify({ recipients: [row.reviewerId!], kind: "tasks.review_overdue", params: { task: `${taskKey(row.teamKey, row.number)} ${row.title}`, stage: stage?.name ?? "" }, link: `/work/tasks/${row.taskId}` }, tx);
      overdueReviews += 1;
    });
  }
  return { overdueReviews };
}
