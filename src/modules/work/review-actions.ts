"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canDecideReview, canSubmitDeliverable } from "./policy";
import { decideReview, pendingDeliverable, submitDeliverable } from "./reviews";
import { loadTask } from "./tasks";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));

function refresh(taskId: string, projectId: string | null) {
  revalidatePath(`/work/tasks/${taskId}`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/tasks");
}

const submitPipeline = createAction({
  name: "work.review.submit",
  input: z.object({ taskId: z.uuid(), fileId: optional(z.uuid()), url: optional(z.url({ protocol: /^https$/ }).max(1000)), note: optional(z.string().trim().max(2000)) }).refine((input) => !!input.fileId !== !!input.url, { path: ["url"], message: "one_of" }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    return !!task && canSubmitDeliverable(await loadViewer(user), task.facts);
  },
  run: async ({ user, input }) => {
    const { deliverable, reviewerPersonId, loaded } = await submitDeliverable(input.taskId, input.fileId ? { kind: "file", fileId: input.fileId, note: input.note } : { kind: "link", url: input.url!, note: input.note }, { personId: user.person.id, fullName: user.person.fullName });
    refresh(input.taskId, loaded.work.projectId);
    return { data: { version: deliverable.version }, audit: { resource: { type: "task:work", id: input.taskId, entityId: loaded.task.entityId }, summary: `${loaded.task.title}: v${deliverable.version}`, after: { version: deliverable.version, kind: deliverable.kind, reviewerPersonId } } };
  },
});
export async function submitDeliverableAction(input: unknown) {
  return submitPipeline(input);
}

const decidePipeline = createAction({
  name: "work.review.decide",
  input: z.object({ taskId: z.uuid(), decision: z.enum(["approved", "changes_requested"]), comment: optional(z.string().trim().max(4000)) }),
  authorize: async (user, input) => {
    const task = await loadTask(input.taskId);
    if (!task) return false;
    const pending = await pendingDeliverable(input.taskId);
    return canDecideReview(await loadViewer(user), task.facts, { reviewerPersonId: task.work.reviewerPersonId, submittedByPersonId: pending?.submittedByPersonId ?? null });
  },
  run: async ({ user, input }) => {
    const { deliverable, revisionRounds, loaded } = await decideReview(input.taskId, input.decision, input.comment, { personId: user.person.id, fullName: user.person.fullName });
    refresh(input.taskId, loaded.work.projectId);
    // What was said stays on the task; the audit log records that a decision was made.
    return { data: { version: deliverable.version, revisionRounds }, audit: { resource: { type: "task:work", id: input.taskId, entityId: loaded.task.entityId }, summary: `${loaded.task.title}: v${deliverable.version} ${input.decision}`, after: { version: deliverable.version, decision: input.decision, revisionRounds } } };
  },
});
export async function decideReviewAction(input: unknown) {
  return decidePipeline(input);
}
