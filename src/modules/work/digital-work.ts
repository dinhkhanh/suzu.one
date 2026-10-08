// The work aimed at one digital asset (FR-AST-09): the open tasks whose output is for it, the posts
// planned and published on it, and the projects that produce for it — each narrowed to what this
// reader may already open on the work screens. The asset's page shows it; work decides what is in it.
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectsWithTeams, workDirectory } from "./directory";
import { canViewProject, type WorkViewer } from "./policy";
import { projectFacts } from "./projects";
import { taskKey, visibleTaskCondition, WORK_KIND } from "./tasks";

/** How far back a published post still counts as the asset's recent work. */
const RECENT_DAYS = 30;
const LIMIT = 50;

export type DigitalAssetWork = {
  tasks: { id: string; key: string; title: string; stateName: string; status: string; assigneePersonId: string | null; assigneeName: string | null; dueDate: string | null; projectName: string | null }[];
  posts: { id: string; taskId: string; key: string; title: string; status: string; plannedAt: Date | null; publishedAt: Date | null; url: string | null }[];
  projects: { id: string; name: string; status: string }[];
};

export async function listWorkOfDigitalAsset(viewer: WorkViewer, digitalAssetId: string, now: Date = new Date()): Promise<DigitalAssetWork> {
  const visible = await visibleTaskCondition(viewer);
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const live = isNull(schema.task.deletedAt);
  const [tasks, posts, links, directory] = await Promise.all([
    db()
      .select({
        id: schema.task.id,
        title: schema.task.title,
        status: schema.task.status,
        dueDate: schema.task.dueDate,
        assigneePersonId: schema.task.assigneePersonId,
        assigneeName: schema.person.fullName,
        number: schema.workTask.number,
        teamKey: schema.workTeam.key,
        stateName: schema.workState.name,
        projectName: schema.workProject.name,
      })
      .from(schema.workTaskDigitalAsset)
      .innerJoin(schema.task, eq(schema.task.id, schema.workTaskDigitalAsset.taskId))
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .innerJoin(schema.workState, eq(schema.workState.id, schema.workTask.stateId))
      .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
      .leftJoin(schema.person, eq(schema.person.id, schema.task.assigneePersonId))
      .where(and(eq(schema.workTaskDigitalAsset.digitalAssetId, digitalAssetId), eq(schema.task.kind, WORK_KIND), live, inArray(schema.task.status, ["todo", "in_progress"]), visible))
      .orderBy(sql`${schema.task.dueDate} asc nulls last`, asc(schema.workTask.number))
      .limit(LIMIT),
    db()
      .select({
        id: schema.workPublish.id,
        taskId: schema.workPublish.taskId,
        status: schema.workPublish.status,
        plannedAt: schema.workPublish.plannedAt,
        publishedAt: schema.workPublish.publishedAt,
        url: schema.workPublish.url,
        title: schema.task.title,
        number: schema.workTask.number,
        teamKey: schema.workTeam.key,
      })
      .from(schema.workPublish)
      .innerJoin(schema.task, eq(schema.task.id, schema.workPublish.taskId))
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .where(
        and(
          eq(schema.workPublish.digitalAssetId, digitalAssetId),
          ne(schema.workPublish.status, "cancelled"),
          // Everything still to go out, and what went out lately.
          or(eq(schema.workPublish.status, "planned"), gte(schema.workPublish.publishedAt, since)),
          eq(schema.task.kind, WORK_KIND),
          live,
          visible,
        ),
      )
      .orderBy(desc(sql`coalesce(${schema.workPublish.publishedAt}, ${schema.workPublish.plannedAt})`))
      .limit(LIMIT),
    db().select({ projectId: schema.workProjectDigitalAsset.projectId }).from(schema.workProjectDigitalAsset).where(eq(schema.workProjectDigitalAsset.digitalAssetId, digitalAssetId)),
    workDirectory(),
  ]);
  const linked = new Set(links.map((row) => row.projectId));
  const projects = projectsWithTeams(directory)
    .filter(({ project, team }) => linked.has(project.id) && project.status !== "archived" && canViewProject(viewer, projectFacts(project, team)))
    .map(({ project }) => ({ id: project.id, name: project.name, status: project.status }));
  return {
    tasks: tasks.map(({ number, teamKey, ...task }) => ({ ...task, key: taskKey(teamKey, number) })),
    posts: posts.map(({ number, teamKey, ...post }) => ({ ...post, key: taskKey(teamKey, number) })),
    projects,
  };
}
