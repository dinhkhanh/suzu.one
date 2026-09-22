// What a reader may open among the tasks and projects a report, a week or a timesheet names — the
// `Seen` the redaction engine applies (engine/redact.ts). The work policy decides, as it does on the
// work screens: `canViewTask` for a task, `canViewProject` for a project. The person reading their
// own day sees everything in it (`readsOwn`), including a task they have since left.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canViewProject, canViewTask, loadTasks, projectFacts, taskKey, viewersOfPeople } from "@/modules/work/service";
import type { Seen } from "./engine/redact";

export type Named = { taskIds?: Iterable<string | null>; projectIds?: Iterable<string | null> };

const idsOf = (values: Iterable<string | null> | undefined) => [...new Set([...(values ?? [])].filter((value): value is string => !!value))];

/**
 * The tasks (with their label now) and projects among `named` that the reader may open.
 * `alsoProjectIds` are projects the caller has already decided this reader may read rows of — the
 * projects they lead, whose time they see by the PJM access rule even when they are not in the
 * project's team: the work on them is named, everything else is still weighed by the work policy.
 */
export async function loadSeen(readerPersonId: string | null, named: Named, alsoProjectIds: ReadonlySet<string> = new Set()): Promise<Seen> {
  const taskIds = idsOf(named.taskIds);
  const projectIds = idsOf(named.projectIds);
  const tasks = new Map<string, { title: string; key: string }>();
  const projects = new Set<string>();
  if (!readerPersonId || (taskIds.length === 0 && projectIds.length === 0)) return { tasks, projects };
  const [viewer, loaded, projectRows] = await Promise.all([
    viewersOfPeople([readerPersonId]).then((map) => map.get(readerPersonId) ?? null),
    loadTasks(taskIds),
    projectIds.length
      ? db()
          .select({ project: schema.workProject, team: schema.workTeam })
          .from(schema.workProject)
          .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
          .where(projectIds.length === 1 ? eq(schema.workProject.id, projectIds[0]) : inArray(schema.workProject.id, projectIds))
      : Promise.resolve([]),
  ]);
  if (!viewer) return { tasks, projects };
  for (const [taskId, task] of loaded) if (canViewTask(viewer, task.facts) || (task.work.projectId && alsoProjectIds.has(task.work.projectId))) tasks.set(taskId, { title: task.task.title, key: taskKey(task.team.key, task.work.number) });
  for (const row of projectRows) if (alsoProjectIds.has(row.project.id) || canViewProject(viewer, projectFacts(row.project, row.team))) projects.add(row.project.id);
  return { tasks, projects };
}

/** The person reading their own day: nothing is redacted, and the stored labels stand. */
export const readsOwn = (reader: { personId: string | null }, subjectPersonId: string): boolean => !!reader.personId && reader.personId === subjectPersonId;
