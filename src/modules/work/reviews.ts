// The review step on a task (FR-WRK-08): the people doing the work hand in a deliverable — a file
// already on the task, or a link — and a reviewer approves it or asks for changes. Every hand-in is
// a new version that stays on the record with its decision; each "changes requested" is a round.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { TASK_FILE_OWNER } from "./attachments";
import { pickReviewer, stateOnApproval, stateOnChangesRequested, stateOnSubmit } from "./engine/review";
import type { StateCategory } from "./enums";
import { autoFollow, notifyFollowers } from "./followers";
import { type LoadedTask, loadTask, logActivity, taskKey, updateWorkTaskIn, WORK_KIND } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
export type DeliverableRow = typeof schema.workDeliverable.$inferSelect;
export type ReviewDecision = "approved" | "changes_requested";
export type DeliverableInput = { kind: "file"; fileId: string; note: string | null } | { kind: "link"; url: string; note: string | null };

const reviewStates = async (tx: Executor, teamId: string) => (await tx.select().from(schema.workState).where(eq(schema.workState.teamId, teamId))).map((state) => ({ id: state.id, category: state.category as StateCategory, sortOrder: state.sortOrder, isActive: state.isActive }));

/** The task's own reviewer, else the project's lead, else the team's leads — the first who is active and is not the submitter. */
async function resolveReviewer(tx: Executor, loaded: LoadedTask, submitterId: string): Promise<string | null> {
  const leads = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, loaded.team.id), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.personId));
  const candidates = [loaded.work.reviewerPersonId, loaded.project?.leadPersonId, ...leads.map((lead) => lead.personId)].filter((id): id is string => !!id);
  if (candidates.length === 0) return null;
  const active = await tx.select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, candidates), inArray(schema.person.status, ["active", "preboarding"])));
  return pickReviewer(candidates.filter((id) => active.some((person) => person.id === id)), submitterId);
}

export async function pendingDeliverable(taskId: string, executor: Executor = db()): Promise<DeliverableRow | undefined> {
  const [row] = await executor.select().from(schema.workDeliverable).where(and(eq(schema.workDeliverable.taskId, taskId), eq(schema.workDeliverable.decision, "pending"))).orderBy(desc(schema.workDeliverable.version)).limit(1);
  return row;
}

export async function submitDeliverable(taskId: string, input: DeliverableInput, actor: { personId: string; fullName: string }): Promise<{ deliverable: DeliverableRow; reviewerPersonId: string; loaded: LoadedTask }> {
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

    const reviewerPersonId = await resolveReviewer(tx, loaded, actor.personId);
    if (!reviewerPersonId) throw new ActionError("review_no_reviewer");

    // A version handed in again before anyone looked at it replaces the waiting one; it is no round.
    await tx.update(schema.workDeliverable).set({ decision: "superseded", decidedAt: new Date() }).where(and(eq(schema.workDeliverable.taskId, taskId), eq(schema.workDeliverable.decision, "pending")));
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${schema.workDeliverable.version}), 0)` }).from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, taskId));
    const version = Number(last) + 1;
    const [deliverable] = await tx
      .insert(schema.workDeliverable)
      .values({ taskId, version, kind: input.kind, fileId: input.kind === "file" ? input.fileId : null, url: input.kind === "link" ? input.url : null, note: input.note, submittedByPersonId: actor.personId })
      .returning();

    await tx.update(schema.workTask).set({ reviewStatus: "submitted", reviewerPersonId }).where(eq(schema.workTask.taskId, taskId));
    const target = stateOnSubmit(await reviewStates(tx, loaded.team.id), loaded.work.stateId);
    if (target) await updateWorkTaskIn(tx, taskId, { stateId: target }, actor.personId, { quiet: true });
    else await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await logActivity(tx, taskId, actor.personId, [{ type: "review_submitted", to: { version, kind: input.kind, name: label, note: input.note } }]);

    await autoFollow(tx, taskId, [reviewerPersonId]);
    const params = { name: actor.fullName, version };
    const told = await notifyFollowers(tx, (await loadTask(taskId, tx))!, actor.personId, "tasks.review_requested", params, [reviewerPersonId]);
    if (!told.includes(reviewerPersonId)) await notify({ recipients: [reviewerPersonId], kind: "tasks.review_requested", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: `/work/tasks/${taskId}` }, tx);
    return { deliverable, reviewerPersonId, loaded };
  });
}

export async function decideReview(taskId: string, decision: ReviewDecision, comment: string | null, actor: { personId: string; fullName: string }): Promise<{ deliverable: DeliverableRow; revisionRounds: number; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const pending = await pendingDeliverable(taskId, tx);
    if (!pending || loaded.work.reviewStatus !== "submitted") throw new ActionError("review_not_pending");
    // Checked by the policy too; here so that no caller can forget it.
    if (pending.submittedByPersonId === actor.personId) throw new ActionError("review_own_work");
    if (decision === "changes_requested" && !comment) throw new ActionError("review_comment_required");

    const [deliverable] = await tx.update(schema.workDeliverable).set({ decision, decidedByPersonId: actor.personId, decidedAt: new Date(), decisionComment: comment }).where(eq(schema.workDeliverable.id, pending.id)).returning();
    const revisionRounds = loaded.work.revisionRounds + (decision === "changes_requested" ? 1 : 0);
    await tx.update(schema.workTask).set({ reviewStatus: decision, revisionRounds }).where(eq(schema.workTask.taskId, taskId));
    const states = await reviewStates(tx, loaded.team.id);
    const target = decision === "approved" ? stateOnApproval(states, loaded.work.stateId) : stateOnChangesRequested(states, loaded.work.stateId);
    if (target) await updateWorkTaskIn(tx, taskId, { stateId: target }, actor.personId, { quiet: true });
    else await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await logActivity(tx, taskId, actor.personId, [{ type: decision === "approved" ? "review_approved" : "review_changes_requested", to: { version: deliverable.version, comment, round: revisionRounds } }]);

    await autoFollow(tx, taskId, [actor.personId]);
    const params = { name: actor.fullName, version: deliverable.version, decision };
    const told = await notifyFollowers(tx, (await loadTask(taskId, tx))!, actor.personId, "tasks.review_decided", params);
    // The person who handed it in hears even if they muted the task: it is their work that came back.
    if (!told.includes(pending.submittedByPersonId)) await notify({ recipients: [pending.submittedByPersonId], kind: "tasks.review_decided", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: `/work/tasks/${taskId}` }, tx);
    return { deliverable, revisionRounds, loaded };
  });
}

export type DeliverableView = Pick<DeliverableRow, "id" | "version" | "kind" | "fileId" | "url" | "note" | "submittedAt" | "decision" | "decidedAt" | "decisionComment" | "submittedByPersonId"> & { fileName: string | null; submittedByName: string | null; decidedByName: string | null };

/** Newest first. */
export async function listDeliverables(taskId: string): Promise<DeliverableView[]> {
  const submitter = alias(schema.person, "submitter");
  const decider = alias(schema.person, "decider");
  return db()
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
      fileName: schema.storedFile.fileName,
      submittedByName: submitter.fullName,
      decidedByName: decider.fullName,
    })
    .from(schema.workDeliverable)
    .leftJoin(schema.storedFile, eq(schema.storedFile.id, schema.workDeliverable.fileId))
    .leftJoin(submitter, eq(submitter.id, schema.workDeliverable.submittedByPersonId))
    .leftJoin(decider, eq(decider.id, schema.workDeliverable.decidedByPersonId))
    .where(eq(schema.workDeliverable.taskId, taskId))
    .orderBy(desc(schema.workDeliverable.version));
}

export type ReviewWaiting = { taskId: string; key: string; title: string; dueDate: string | null; priority: number | null; projectName: string | null; version: number; submittedByName: string | null; submittedAt: Date };

/** Deliverables waiting for this person's decision — a section of My work (FR-WRK-06). */
export async function listReviewsWaitingFor(personId: string): Promise<ReviewWaiting[]> {
  const rows = await db()
    .select({ taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, dueDate: schema.task.dueDate, priority: schema.task.priority, projectName: schema.workProject.name, version: schema.workDeliverable.version, submittedByName: schema.person.fullName, submittedAt: schema.workDeliverable.submittedAt })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .innerJoin(schema.workDeliverable, and(eq(schema.workDeliverable.taskId, schema.task.id), eq(schema.workDeliverable.decision, "pending")))
    .leftJoin(schema.person, eq(schema.person.id, schema.workDeliverable.submittedByPersonId))
    .where(and(eq(schema.workTask.reviewerPersonId, personId), eq(schema.workTask.reviewStatus, "submitted"), eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt)))
    .orderBy(asc(schema.workDeliverable.submittedAt));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}

export const countReviewsWaitingFor = async (personId: string): Promise<number> => (await listReviewsWaitingFor(personId)).length;
