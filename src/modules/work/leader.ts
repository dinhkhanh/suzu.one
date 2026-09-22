// The leader's view (FR-WRK-07) and the work half of "My work" (FR-WRK-06).
import "server-only";
import { and, asc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { type Risk, riskOf } from "./engine/risk";
import type { StateCategory } from "./enums";
import type { WorkViewer } from "./policy";
import { type LoadedTask, listItems, loadTask, logActivity, type TaskListItem, taskKey, WORK_KIND } from "./tasks";

const open = inArray(schema.task.status, ["todo", "in_progress"]);
// Work still waiting in triage (FR-PJM-32) is nobody's yet: it is on the triage page, not here.
const notInTriage = or(isNull(schema.workTask.triageStatus), notInArray(schema.workTask.triageStatus, ["pending", "snoozed"]));

export type LeaderTask = TaskListItem & { stateName: string; category: StateCategory; projectName: string | null; risk: Risk; mine: "requested" | "led" };
export type LeaderView = { people: { personId: string | null; name: string | null; tasks: LeaderTask[]; counts: Record<"todo" | "in_progress" | "in_review", number>; overdue: number; atRisk: number; blocked: number }[]; totals: { open: number; overdue: number; atRisk: number; blocked: number } };

/**
 * Open tasks other people are doing for this viewer: those they asked for or created, and
 * everything in the teams and projects they lead. All of it is visible to them by the policy
 * (a lead sees the team's work; a requester sees their task), so no further filter is needed.
 */
export async function getLeaderView(viewer: WorkViewer, today: IsoDate): Promise<LeaderView> {
  const self = viewer.principal.personId;
  if (!self) return { people: [], totals: { open: 0, overdue: 0, atRisk: 0, blocked: 0 } };
  const ledTeams = [...viewer.teamRoles].filter(([, role]) => role === "lead").map(([id]) => id);
  const ledProjects = [...viewer.projectRoles].filter(([, role]) => role === "lead").map(([id]) => id);
  const asked = or(eq(schema.task.requesterPersonId, self), eq(schema.task.createdByPersonId, self));
  const scope = or(asked, ledTeams.length ? inArray(schema.workTask.teamId, ledTeams) : undefined, ledProjects.length ? inArray(schema.workTask.projectId, ledProjects) : undefined);
  // Work the viewer does themselves is on "My work", not here.
  const items = await listItems(and(open, scope, notInTriage, or(isNull(schema.task.assigneePersonId), ne(schema.task.assigneePersonId, self))), db(), 1000);
  if (items.length === 0) return { people: [], totals: { open: 0, overdue: 0, atRisk: 0, blocked: 0 } };

  const [states, projects, requested] = await Promise.all([
    db().select({ id: schema.workState.id, name: schema.workState.name, category: schema.workState.category }).from(schema.workState).where(inArray(schema.workState.id, [...new Set(items.map((item) => item.stateId))])),
    db().select({ id: schema.workProject.id, name: schema.workProject.name }).from(schema.workProject).where(inArray(schema.workProject.id, [...new Set(items.map((item) => item.projectId).filter((id): id is string => !!id))].concat("00000000-0000-0000-0000-000000000000"))),
    db().select({ id: schema.task.id }).from(schema.task).where(and(inArray(schema.task.id, items.map((item) => item.id)), asked)),
  ]);
  const tasks: LeaderTask[] = items.map((item) => {
    const state = states.find((row) => row.id === item.stateId);
    const category = (state?.category ?? "todo") as StateCategory;
    return { ...item, stateName: state?.name ?? "", category, projectName: projects.find((project) => project.id === item.projectId)?.name ?? null, risk: riskOf({ category, dueDate: item.dueDate, blockedBy: item.blockedBy }, today), mine: requested.some((row) => row.id === item.id) ? "requested" : "led" };
  });

  // A task someone flagged blocked (FR-PJM-28) comes first: it needs the leader, not the doer.
  const rank = (task: LeaderTask) => (task.blocker ? -1 : task.risk === "overdue" ? 0 : task.risk === "at_risk" ? 1 : 2);
  const people = [...Map.groupBy(tasks, (task) => task.assigneePersonId)].map(([personId, own]) => ({
    personId,
    name: own[0].assigneeName,
    tasks: own.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    counts: { todo: own.filter((task) => task.category === "backlog" || task.category === "todo").length, in_progress: own.filter((task) => task.category === "in_progress").length, in_review: own.filter((task) => task.category === "in_review").length },
    overdue: own.filter((task) => task.risk === "overdue").length,
    atRisk: own.filter((task) => task.risk === "at_risk").length,
    blocked: own.filter((task) => task.blocker).length,
  }));
  // Whoever has the most trouble first; unassigned work last.
  people.sort((a, b) => Number(a.personId === null) - Number(b.personId === null) || b.blocked - a.blocked || b.overdue - a.overdue || b.atRisk - a.atRisk || (a.name ?? "").localeCompare(b.name ?? "", "vi"));
  return { people, totals: { open: tasks.length, overdue: tasks.filter((task) => task.risk === "overdue").length, atRisk: tasks.filter((task) => task.risk === "at_risk").length, blocked: tasks.filter((task) => task.blocker).length } };
}

/** "How is this going?" — once per task per day, whoever asks (the table's key is task + assignee + kind + day). */
export async function nudgeTask(taskId: string, actor: { personId: string; fullName: string }, today: IsoDate): Promise<{ loaded: LoadedTask; assigneePersonId: string }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const assigneePersonId = loaded.task.assigneePersonId;
    if (loaded.task.status === "done" || loaded.task.status === "cancelled") throw new ActionError("nudge_task_closed");
    if (!assigneePersonId || assigneePersonId === actor.personId) throw new ActionError("nudge_nobody");
    const [fresh] = await tx.insert(schema.workReminderSent).values({ taskId, personId: assigneePersonId, kind: "nudge", sentOn: today }).onConflictDoNothing().returning();
    if (!fresh) throw new ActionError("nudge_already_sent");
    await notify({ recipients: [assigneePersonId], kind: "tasks.nudge", params: { name: actor.fullName, key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, dueDate: loaded.task.dueDate ? loaded.task.dueDate.split("-").reverse().join("/") : "none" }, link: `/work/tasks/${taskId}` }, tx);
    await logActivity(tx, taskId, actor.personId, [{ type: "nudged" }]);
    return { loaded, assigneePersonId };
  });
}

export type MyWorkItem = { id: string; key: string; title: string; status: "todo" | "in_progress" | "done" | "cancelled"; stateName: string; dueDate: string | null; priority: number | null; projectName: string | null; reviewStatus: string; blockedBy: number; /** The reason of the open blocker raised on it (FR-PJM-28). */ blocker: string | null };

/** The signed-in person's open work tasks, for "My work". */
export async function listMyWorkItems(personId: string): Promise<MyWorkItem[]> {
  const rows = await db()
    .select({
      id: schema.task.id,
      number: schema.workTask.number,
      teamKey: schema.workTeam.key,
      title: schema.task.title,
      status: schema.task.status,
      stateName: schema.workState.name,
      dueDate: schema.task.dueDate,
      priority: schema.task.priority,
      projectName: schema.workProject.name,
      reviewStatus: schema.workTask.reviewStatus,
      blockedBy: sql<number>`(select count(*)::int from work_task_dependency d join task b on b.id = d.blocker_task_id where d.blocked_task_id = ${schema.task.id} and d.type = 'blocks' and b.deleted_at is null and b.status in ('todo', 'in_progress'))`,
      blocker: sql<string | null>`(select wb.reason from work_blocker wb where wb.task_id = ${schema.task.id} and wb.resolved_at is null)`,
    })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .innerJoin(schema.workState, eq(schema.workState.id, schema.workTask.stateId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(and(eq(schema.task.kind, WORK_KIND), eq(schema.task.assigneePersonId, personId), open, notInTriage, isNull(schema.task.deletedAt)))
    .orderBy(asc(schema.task.dueDate));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number), blockedBy: Number(row.blockedBy) }));
}
