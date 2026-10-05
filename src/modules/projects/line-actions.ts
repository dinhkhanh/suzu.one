"use server";
// The register line a task fills, set from the task's own page and from a retainer month
// (FR-PJM-05, 06). The rule is the one the plan page's link control has: whoever may edit the plan
// of the task's project (`canEditPlan`) — re-checked here, whatever the page showed.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { optional } from "./form-inputs";
import { canEditPlan } from "./policy";
import { projectOfTask } from "./structure";
import { setTaskLine } from "./task-line";
import { planProjectFor } from "./views";

const taskLinePipeline = createAction({
  name: "projects.task.line",
  input: z.object({ taskId: z.uuid(), deliverableId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const found = await planProjectFor(user, await projectOfTask(input.taskId));
    return !!found && canEditPlan(found.viewer, found.facts);
  },
  run: async ({ input }) => {
    const { projectId, before, after } = await setTaskLine(input.taskId, input.deliverableId);
    for (const tab of ["", "/plan", "/deliverables", "/retainer", "/acceptance"]) revalidatePath(`/projects/${projectId}${tab}`);
    revalidatePath(`/work/tasks/${input.taskId}`);
    return { data: after, audit: { resource: { type: "task:work", id: input.taskId }, summary: after.deliverableId ? "register line" : "register line removed", before, after } };
  },
});
export async function setTaskLineAction(input: unknown) {
  return taskLinePipeline(input);
}
