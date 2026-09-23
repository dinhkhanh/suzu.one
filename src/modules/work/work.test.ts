// Work management against a real Postgres (PGlite): teams and workflows, project privacy in lists
// (the SQL reach against the pure policy for every kind of viewer), tasks with their activity log,
// sub-task and dependency guards, numbering and search.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Grant } from "@/modules/platform/rbac/policy";
import { countMyOpenTasks, listMyTasks } from "@/modules/platform/tasks-engine/service";
import { loadShellCounts } from "@/modules/platform/shell/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { canViewTask } from "./policy";
import { createProject, setProjectMember, visibleProjects } from "./projects";
import { addDependency, createWorkTask, deleteWorkTask, getTaskDetail, listActivity, listProjectTasks, listVisibleTaskIds, loadTask, searchTasks, updateWorkTask } from "./tasks";
import { createTeam, listStates, saveClient, saveState, setTeamMember } from "./teams";
import { getWorkAnalytics } from "./analytics";
import { analyse, type AnalyticsTask } from "./engine/analytics";
import { getPersonTaskStats } from "./stats";
import { loadViewerWith } from "./viewer";

const ids = {} as Record<"szm" | "szc" | "vidDept" | "owner" | "long" | "tam" | "huy" | "khoi" | "bao" | "freelancer" | "head" | "video" | "design" | "teamProject" | "entityProject" | "privateProject" | "designProject", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);

async function addPerson(name: string, entityId: string, workforceType: "employee" | "collaborator" = "employee") {
  const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase().replaceAll(" ", ".")}@suzu.group`, workforceType, status: "active", primaryEntityId: entityId }).returning();
  return row.id;
}
const viewerOf = (personId: string, entityId: string, grants: Grant[] = [], workforceType: "employee" | "collaborator" = "employee") => loadViewerWith(db(), { person: { id: personId, primaryEntityId: entityId }, principal: { personId, workforceType, grants } });
const stateNamed = async (teamId: string, name: string) => (await listStates([teamId])).find((state) => state.name === name)!;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vidDept: vid.id });
  for (const [key, name, entity] of [["owner", "The Owner", szm.id], ["long", "Long Dang", szm.id], ["tam", "Tam Bui", szm.id], ["huy", "Huy Ho", szm.id], ["bao", "Bao Pham", szm.id], ["head", "Other Head", szm.id], ["khoi", "Khoi Ly", szc.id]] as const) ids[key] = await addPerson(name, entity);
  ids.freelancer = await addPerson("Bao Anh", szm.id, "collaborator");

  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: vid.id, defaultVisibility: "team", isActive: true }, "content", { brief: "Brief", edit: "Edit", published: "Published", reported: "Reported", backlog: "Backlog" }, ids.long);
  const design = await createTeam({ key: "DES", name: "Design", description: null, entityId: szc.id, departmentId: null, defaultVisibility: "entity", isActive: true }, "simple", {}, ids.khoi);
  Object.assign(ids, { video: video.id, design: design.id });
  for (const personId of [ids.tam, ids.huy, ids.freelancer]) await setTeamMember(video.id, personId, "member");

  const project = (teamId: string, name: string, visibility: "entity" | "team" | "private", actor: string) => createProject({ teamId, name, description: null, clientId: null, status: "active", visibility, leadPersonId: null, startDate: null, dueDate: null }, actor);
  ids.teamProject = (await project(video.id, "TVC Tet", "team", ids.long)).id;
  ids.entityProject = (await project(video.id, "Company profile video", "entity", ids.long)).id;
  ids.privateProject = (await project(video.id, "Pitch — confidential", "private", ids.tam)).id;
  ids.designProject = (await project(design.id, "Brand refresh", "entity", ids.khoi)).id;
});

describe("teams and workflows", () => {
  it("start with the preset's states, in order, and the creator as lead", async () => {
    const states = await listStates([ids.video]);
    expect(states.map((state) => state.category)).toEqual(["backlog", "todo", "in_progress", "in_progress", "in_progress", "in_progress", "in_review", "in_review", "in_progress", "done", "done", "cancelled"]);
    expect(states[1].name).toBe("Brief");
    expect((await viewerOf(ids.long, ids.szm)).teamRoles.get(ids.video)).toBe("lead");
  });
  it("refuse a second team with the same key, and removing the last lead", async () => {
    expect(await fails(createTeam({ key: "VID", name: "Again", description: null, entityId: null, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.owner))).toBe("team_key_taken");
    expect(await fails(setTeamMember(ids.video, ids.long, "member"))).toBe("team_last_lead");
    expect(await fails(setTeamMember(ids.video, ids.long, null))).toBe("team_last_lead");
  });
  it("will not retire a state that holds tasks, nor leave a workflow without a start or an end", async () => {
    const edit = await stateNamed(ids.video, "Edit");
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Rough cut", stateId: edit.id }, ids.long);
    expect(await fails(saveState(ids.video, edit.id, { name: "Edit", category: "in_progress", sortOrder: edit.sortOrder, isActive: false }))).toBe("state_in_use");
    expect(await fails(saveState(ids.video, edit.id, { name: "Edit", category: "done", sortOrder: edit.sortOrder, isActive: true }))).toBe("state_category_in_use");
    await deleteWorkTask(task.id, ids.long);
    for (const name of ["Published", "Reported"]) {
      const state = await stateNamed(ids.video, name);
      const result = await fails(saveState(ids.video, state.id, { name, category: "done", sortOrder: state.sortOrder, isActive: false }));
      if (name === "Reported") expect(result).toBe("workflow_needs_start_and_done");
    }
    const published = await stateNamed(ids.video, "Published");
    await saveState(ids.video, published.id, { name: "Published", category: "done", sortOrder: published.sortOrder, isActive: true });
  });
});

describe("tasks", () => {
  it("are numbered per team, land in the first to-do state and show in the engine's inbox", async () => {
    const first = await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Write the script", assigneePersonId: ids.huy, dueDate: "2026-09-25", priority: 2 }, ids.long);
    const second = await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Storyboard" }, ids.long);
    expect(second.work.number).toBe(first.work.number + 1);
    expect(first.key).toBe(`VID-${first.work.number}`);
    expect((await listStates([ids.video])).find((state) => state.id === first.work.stateId)?.name).toBe("Brief");
    expect(first.task).toMatchObject({ kind: "work", status: "todo", entityId: ids.szm, contextType: "work_project", contextId: ids.teamProject, requesterPersonId: ids.long });
    // ADR-10: one table, one inbox.
    expect((await listMyTasks(ids.huy)).open.map((task) => task.id)).toContain(first.task.id);
    expect(await countMyOpenTasks(ids.huy)).toBe(1);
    expect((await loadShellCounts(ids.huy)).openTasks).toBe(1);
    const [notice] = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.huy), eq(schema.notification.kind, "tasks.work_assigned")));
    expect(notice).toMatchObject({ link: `/work/tasks/${first.task.id}`, params: { key: first.key, title: "Write the script" } });
  });

  it("log every change field by field, and follow the state's category", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Shoot day 1" }, ids.long);
    const published = await stateNamed(ids.video, "Published");
    const reported = await stateNamed(ids.video, "Reported");
    await updateWorkTask(task.id, { title: "Shoot — day 1", assigneePersonId: ids.tam, dueDate: "2026-10-02", priority: 1, stateId: published.id, checklist: [{ id: "a", text: "Book the studio", done: true }] }, ids.long);
    const done = (await loadTask(task.id))!;
    expect(done.task).toMatchObject({ status: "done", completedByPersonId: ids.long, assigneePersonId: ids.tam });
    const completedAt = done.task.completedAt;
    await updateWorkTask(task.id, { stateId: reported.id }, ids.tam);
    expect((await loadTask(task.id))!.task.completedAt).toEqual(completedAt);

    const activity = await listActivity(task.id);
    expect(activity.filter((entry) => entry.type === "field_changed").map((entry) => entry.field).sort()).toEqual(["assignee", "checklist", "dueDate", "priority", "state", "state", "title"]);
    expect(activity.find((entry) => entry.field === "assignee")?.toValue).toEqual({ id: ids.tam, name: "Tam Bui" });
    expect(activity.at(-1)?.type).toBe("created");
    // Saving the same values again changes nothing and logs nothing.
    const { changes } = await updateWorkTask(task.id, { title: "Shoot — day 1", priority: 1 }, ids.long);
    expect(changes).toEqual([]);

    const brief = await stateNamed(ids.video, "Brief");
    await updateWorkTask(task.id, { stateId: brief.id }, ids.long);
    expect((await loadTask(task.id))!.task).toMatchObject({ status: "todo", completedAt: null, completedByPersonId: null });
  });

  it("refuse another team's state, project or label, and dates the wrong way round", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Backlog idea" }, ids.long);
    const foreign = (await listStates([ids.design]))[0];
    expect(await fails(updateWorkTask(task.id, { stateId: foreign.id }, ids.long))).toBe("state_not_found");
    expect(await fails(updateWorkTask(task.id, { projectId: ids.designProject }, ids.long))).toBe("project_other_team");
    expect(await fails(updateWorkTask(task.id, { startDate: "2026-10-10", dueDate: "2026-10-01" }, ids.long))).toBe("task_dates_invalid");
    const [label] = await db().insert(schema.workLabel).values({ teamId: ids.design, name: "Print" }).returning();
    expect(await fails(updateWorkTask(task.id, { labelIds: [label.id] }, ids.long))).toBe("label_not_found");
  });

  it("keep sub-tasks with their parent and refuse loops in the tree", async () => {
    const parent = await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Post-production" }, ids.long);
    const child = await createWorkTask({ teamId: ids.video, title: "Colour grade", parentTaskId: parent.task.id }, ids.long);
    const grandchild = await createWorkTask({ teamId: ids.video, title: "Export masters", parentTaskId: child.task.id }, ids.long);
    expect(child.work.projectId).toBe(ids.teamProject);
    expect(await fails(updateWorkTask(parent.task.id, { parentTaskId: grandchild.task.id }, ids.long))).toBe("parent_cycle");
    expect(await fails(updateWorkTask(parent.task.id, { parentTaskId: parent.task.id }, ids.long))).toBe("parent_cycle");
    const row = (await listProjectTasks(ids.teamProject)).find((task) => task.id === parent.task.id)!;
    expect(row.subtasks).toEqual({ done: 0, total: 1 });
    const { deleted } = await deleteWorkTask(parent.task.id, ids.long);
    expect(deleted).toBe(3);
    expect(await loadTask(grandchild.task.id)).toBeUndefined();
  });

  it("refuse dependency loops and duplicates, and count open blockers", async () => {
    const make = async (title: string) => (await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title }, ids.long)).task.id;
    const [script, shoot, edit] = [await make("Dep: script"), await make("Dep: shoot"), await make("Dep: edit")];
    await addDependency(script, shoot, "blocks", ids.long);
    await addDependency(shoot, edit, "blocks", ids.long);
    expect(await fails(addDependency(edit, script, "blocks", ids.long))).toBe("dependency_cycle");
    expect(await fails(addDependency(script, shoot, "blocks", ids.long))).toBe("dependency_exists");
    expect(await fails(addDependency(script, script, "relates", ids.long))).toBe("dependency_self");
    const blockedBy = async () => (await listProjectTasks(ids.teamProject)).find((task) => task.id === shoot)!.blockedBy;
    expect(await blockedBy()).toBe(1);
    await updateWorkTask(script, { stateId: (await stateNamed(ids.video, "Published")).id }, ids.long);
    expect(await blockedBy()).toBe(0);
    const detail = (await getTaskDetail(shoot, await viewerOf(ids.long, ids.szm)))!;
    expect(detail.linked.map((link) => link.relation).sort()).toEqual(["blocked_by", "blocks"]);
  });

  it("place a dropped card between its new neighbours", async () => {
    const edit = await stateNamed(ids.video, "Edit");
    const make = async (title: string) => (await createWorkTask({ teamId: ids.video, projectId: ids.entityProject, title, stateId: edit.id }, ids.long)).task.id;
    const [a, b, c] = [await make("Card A"), await make("Card B"), await make("Card C")];
    await updateWorkTask(c, { position: { beforeTaskId: a, afterTaskId: b } }, ids.huy);
    const order = (await listProjectTasks(ids.entityProject)).filter((task) => task.stateId === edit.id).map((task) => task.title);
    expect(order).toEqual(["Card A", "Card C", "Card B"]);
  });
});

describe("privacy in lists (FR-WRK-18)", () => {
  it("shows each viewer exactly the projects the policy allows", async () => {
    const names = async (personId: string, entityId: string, grants: Grant[] = [], type: "employee" | "collaborator" = "employee") => (await visibleProjects(await viewerOf(personId, entityId, grants, type), { today: "2026-09-20" })).map((project) => project.name).sort();
    expect(await names(ids.long, ids.szm)).toEqual(["Company profile video", "Pitch — confidential", "TVC Tet"]);
    expect(await names(ids.tam, ids.szm)).toEqual(["Company profile video", "Pitch — confidential", "TVC Tet"]);
    expect(await names(ids.huy, ids.szm)).toEqual(["Company profile video", "TVC Tet"]);
    expect(await names(ids.bao, ids.szm)).toEqual(["Company profile video"]);
    expect(await names(ids.khoi, ids.szc)).toEqual(["Brand refresh"]);
    // The owner's "*" opens everything, the private project included — to read (the owner's
    // decision of 2026-09-23, Q25); so does a `pjm:portfolio` grant over the owning team's unit.
    expect(await names(ids.owner, ids.szm, [{ role: "owner", scope: { type: "group" } }])).toEqual(["Brand refresh", "Company profile video", "Pitch — confidential", "TVC Tet"]);
    expect(await names(ids.head, ids.szm, [{ role: "department_head", scope: { type: "unit", id: ids.vidDept } }])).toEqual(["Company profile video", "Pitch — confidential", "TVC Tet"]);
    // A collaborator in the team sees its team projects, never the entity-wide ones of others.
    expect(await names(ids.freelancer, ids.szm, [], "collaborator")).toEqual(["Company profile video", "TVC Tet"]);
  });

  it("keeps the SQL reach of task lists in step with canViewTask for every kind of viewer", async () => {
    const secret = await createWorkTask({ teamId: ids.video, projectId: ids.privateProject, title: "Pitch deck numbers", assigneePersonId: ids.tam }, ids.tam);
    // A guest reviewer is brought into the project first: a private project's work goes to nobody else.
    await setProjectMember(ids.privateProject, ids.khoi, "member");
    await createWorkTask({ teamId: ids.video, projectId: ids.privateProject, title: "Pitch: guest review", collaboratorIds: [ids.khoi] }, ids.tam);
    await createWorkTask({ teamId: ids.video, projectId: ids.privateProject, title: "Pitch: asked by Bao", requesterPersonId: ids.bao }, ids.tam);
    await createWorkTask({ teamId: ids.design, title: "Design backlog item" }, ids.khoi);
    await createWorkTask({ teamId: ids.design, projectId: ids.designProject, title: "Logo options" }, ids.khoi);
    await setProjectMember(ids.teamProject, ids.khoi, "member");

    const all = await db().select({ id: schema.task.id }).from(schema.task).where(eq(schema.task.kind, "work"));
    const viewers = [
      await viewerOf(ids.long, ids.szm),
      await viewerOf(ids.tam, ids.szm),
      await viewerOf(ids.huy, ids.szm),
      await viewerOf(ids.bao, ids.szm),
      await viewerOf(ids.khoi, ids.szc),
      await viewerOf(ids.owner, ids.szm, [{ role: "owner", scope: { type: "group" } }]),
      await viewerOf(ids.head, ids.szm, [{ role: "department_head", scope: { type: "unit", id: ids.vidDept } }]),
      await viewerOf(ids.head, ids.szm, [{ role: "entity_director", scope: { type: "entity", id: ids.szc } }]),
      await viewerOf(ids.freelancer, ids.szm, [], "collaborator"),
    ];
    for (const viewer of viewers) {
      const expected: string[] = [];
      for (const { id } of all) {
        const loaded = await loadTask(id);
        if (loaded && canViewTask(viewer, loaded.facts)) expected.push(id);
      }
      expect((await listVisibleTaskIds(viewer)).sort()).toEqual(expected.sort());
    }
    // And concretely: the private task is invisible to a team member, and visible to its people —
    // and to the owner, who may read a private project since the decision of 2026-09-23 (Q25).
    expect(await listVisibleTaskIds(await viewerOf(ids.huy, ids.szm))).not.toContain(secret.task.id);
    expect(await listVisibleTaskIds(await viewerOf(ids.owner, ids.szm, [{ role: "owner", scope: { type: "group" } }]))).toContain(secret.task.id);
    expect(await getTaskDetail(secret.task.id, await viewerOf(ids.huy, ids.szm))).toBeUndefined();
    expect((await getTaskDetail(secret.task.id, await viewerOf(ids.tam, ids.szm)))?.key).toBe(secret.key);
  });

  it("searches by title and by key, inside what the viewer may see", async () => {
    const huy = await viewerOf(ids.huy, ids.szm);
    expect((await searchTasks(huy, "pitch")).length).toBe(0);
    expect((await searchTasks(await viewerOf(ids.tam, ids.szm), "pitch")).length).toBe(3);
    const [hit] = await searchTasks(huy, "write the scr");
    expect(hit.title).toBe("Write the script");
    expect((await searchTasks(huy, hit.key)).map((row) => row.id)).toContain(hit.id);
    expect(await searchTasks(huy, "%")).toEqual([]);
  });
});

describe("analytics and person stats in SQL", () => {
  it("count exactly what the pure engine counts, on the rows the viewer may see", async () => {
    const client = (await saveClient(null, { code: "ACME", name: "Acme", kind: "client", parentId: null, entityId: null, note: null, isActive: true })).after;
    const make = async (title: string, input: { assignee?: string; due?: string | null; estimate?: number; client?: string; teamId?: string; projectId?: string | null }) =>
      (await createWorkTask({ teamId: input.teamId ?? ids.video, projectId: input.projectId === undefined ? ids.teamProject : input.projectId, title, assigneePersonId: input.assignee ?? null, dueDate: input.due ?? null, estimateMinutes: input.estimate ?? null, clientId: input.client ?? null }, ids.long)).task.id;
    const finish = async (taskId: string, status: "done" | "cancelled", at: string, rounds = 0) => {
      await db().update(schema.task).set({ status, completedAt: status === "done" ? new Date(at) : null, updatedAt: new Date(at) }).where(eq(schema.task.id, taskId));
      await db().update(schema.workTask).set({ revisionRounds: rounds }).where(eq(schema.workTask.taskId, taskId));
    };
    await finish(await make("An: on time", { assignee: ids.huy, due: "2026-09-10", client: client.id }), "done", "2026-09-09T20:00:00Z", 2);
    await finish(await make("An: late", { assignee: ids.tam, due: "2026-09-05" }), "done", "2026-09-08T03:00:00Z", 1);
    // 23:30 UTC on the 30th is already 1 October in Vietnam: outside the period.
    await finish(await make("An: after the period", { assignee: ids.huy, due: "2026-10-05", client: client.id }), "done", "2026-09-30T23:30:00Z");
    await finish(await make("An: undated", { assignee: ids.huy }), "done", "2026-09-12T02:00:00Z");
    await finish(await make("An: cancelled", { assignee: ids.bao, client: client.id }), "cancelled", "2026-09-14T02:00:00Z");
    await make("An: open overdue", { assignee: ids.bao, due: "2026-09-01", estimate: 90, client: client.id });
    await make("An: open later", { due: "2026-12-01", estimate: -5 });
    await make("An: design", { teamId: ids.design, projectId: null, assignee: ids.khoi, due: "2026-09-02" });

    const period = { from: "2026-09-01", to: "2026-09-30" };
    const today = "2026-09-20";
    for (const [personId, entityId, grants] of [[ids.long, ids.szm, []], [ids.khoi, ids.szc, []], [ids.owner, ids.szm, [{ role: "owner", scope: { type: "group" } }]]] as const) {
      const viewer = await viewerOf(personId, entityId, [...grants] as Grant[]);
      const visibleIds = await listVisibleTaskIds(viewer);
      const rows = visibleIds.length
        ? await db()
            .select({ teamId: schema.workTask.teamId, clientId: schema.workTask.clientId, status: schema.task.status, dueDate: schema.task.dueDate, completedOn: sql<string | null>`(${schema.task.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, updatedOn: sql<string>`(${schema.task.updatedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, revisionRounds: schema.workTask.revisionRounds, assigneePersonId: schema.task.assigneePersonId, estimateMinutes: schema.task.estimateMinutes })
            .from(schema.task)
            .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
            .where(inArray(schema.task.id, visibleIds))
        : [];
      const expected = analyse(rows as AnalyticsTask[], period, today);
      const actual = await getWorkAnalytics(viewer, period, today);
      expect(actual.total).toEqual(expected.total);
      const byKey = (groups: { key: string; cell: unknown }[]) => Object.fromEntries(groups.map((group) => [group.key, group.cell]));
      expect(byKey(actual.byTeam.map((group) => ({ key: group.id, cell: group.cell })))).toEqual(byKey(expected.byTeam));
      expect(byKey(actual.byClient.map((group) => ({ key: group.id, cell: group.cell })))).toEqual(byKey(expected.byClient));
      expect(actual.teams.map((team) => team.id).sort()).toEqual([...new Set(rows.map((row) => row.teamId))].sort());
    }
    const long = await getWorkAnalytics(await viewerOf(ids.long, ids.szm), period, today);
    expect(long.byClient).toEqual([expect.objectContaining({ id: client.id, name: "Acme" })]);
    expect(long.byClient[0].cell).toMatchObject({ completed: 1, cancelled: 1, open: 1, overdue: 1, openMinutes: 90, contributors: 2 });

    const stats = await getPersonTaskStats({ personId: ids.huy, from: "2026-09-01", to: "2026-09-30", today });
    // The same six numbers the way they were counted before: one query each.
    const mine = and(eq(schema.task.kind, "work"), eq(schema.task.assigneePersonId, ids.huy), sql`${schema.task.deletedAt} is null`);
    const countOf = async (where: ReturnType<typeof sql>) => (await db().select({ n: sql<number>`count(*)::int` }).from(schema.task).where(and(mine, where)))[0].n;
    const done = sql`${schema.task.status} = 'done' and ${schema.task.completedAt}::date between '2026-09-01' and '2026-09-30'`;
    const completed = await countOf(done);
    const onTime = await countOf(sql`${done} and (${schema.task.dueDate} is null or ${schema.task.completedAt}::date <= ${schema.task.dueDate})`);
    const open = await countOf(sql`${schema.task.status} in ('todo', 'in_progress')`);
    const overdue = await countOf(sql`${schema.task.status} in ('todo', 'in_progress') and ${schema.task.dueDate} < ${today}::date`);
    const cancelled = await countOf(sql`${schema.task.status} = 'cancelled' and ${schema.task.updatedAt}::date between '2026-09-01' and '2026-09-30'`);
    expect(stats).toEqual({ from: "2026-09-01", to: "2026-09-30", completed, onTime, late: completed - onTime, open, overdue, cancelled });
    expect(stats.completed).toBeGreaterThan(0);
  });
});
