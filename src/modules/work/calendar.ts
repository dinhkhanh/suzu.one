// The content calendar across projects (FR-WRK-05): every dated task the viewer may see in a range,
// with the project's name and whether this viewer may drag it to another day.
import "server-only";
import { and, between, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canContributeToProject, canContributeToTeam, type WorkViewer } from "./policy";
import { projectFacts } from "./projects";
import { listItems, type TaskListItem, visibleTaskCondition } from "./tasks";
import { teamFacts } from "./teams";

export type CalendarItem = TaskListItem & { projectName: string | null; editable: boolean };

/** Who may move a task's date without opening it: the people working in its project (or team backlog), and its assignee. */
export async function withEditable(viewer: WorkViewer, items: TaskListItem[]): Promise<CalendarItem[]> {
  const [projects, teams] = await Promise.all([
    db().select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)),
    db().select().from(schema.workTeam),
  ]);
  const projectNames = new Map(projects.map((row) => [row.project.id, row.project.name]));
  const openProjects = new Set(projects.filter((row) => row.project.status !== "archived" && canContributeToProject(viewer, projectFacts(row.project, row.team))).map((row) => row.project.id));
  const openTeams = new Set(teams.filter((team) => canContributeToTeam(viewer, teamFacts(team))).map((team) => team.id));
  const self = viewer.principal.personId;
  return items.map((item) => ({
    ...item,
    projectName: item.projectId ? (projectNames.get(item.projectId) ?? null) : null,
    editable: (!!self && item.assigneePersonId === self) || (item.projectId ? openProjects.has(item.projectId) : openTeams.has(item.teamId)),
  }));
}

export async function listCalendarTasks(viewer: WorkViewer, range: { from: string; to: string }): Promise<CalendarItem[]> {
  const items = await listItems(and(between(schema.task.dueDate, range.from, range.to), await visibleTaskCondition(viewer)), db(), 3000);
  return withEditable(viewer, items);
}
