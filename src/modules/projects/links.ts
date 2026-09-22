// The project's tasks with what each one works towards (`project_task_link`): the plan pages list
// them under their milestone and register line, and offer the rest for linking.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listProjectTasks } from "../work/service";

export type TaskLinkView = {
  taskId: string;
  key: string;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
  milestoneId: string | null;
  deliverableId: string | null;
  phaseId: string | null;
  baselineDue: string | null;
};

/** Every live task of the project, linked or not. The caller has checked the viewer may read the plan. */
export async function listTaskLinks(projectId: string): Promise<TaskLinkView[]> {
  const [tasks, links] = await Promise.all([
    listProjectTasks(projectId),
    db().select({ link: schema.projectTaskLink }).from(schema.projectTaskLink).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.projectTaskLink.taskId)).where(eq(schema.workTask.projectId, projectId)),
  ]);
  const linkOf = new Map(links.map(({ link }) => [link.taskId, link]));
  return tasks.map((task) => {
    const link = linkOf.get(task.id);
    return { taskId: task.id, key: task.key, title: task.title, status: task.status, dueDate: task.dueDate, assigneeName: task.assigneeName, milestoneId: link?.milestoneId ?? null, deliverableId: link?.deliverableId ?? null, phaseId: link?.phaseId ?? null, baselineDue: link?.baselineDue ?? null };
  });
}
