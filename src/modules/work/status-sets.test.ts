// The status library against a real Postgres (PGlite): workflows a new team starts from (copied),
// project status sets a team names (linked), and the trigger that keeps a project's category and
// its status together whichever one a writer sets.
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { createProject, setProjectArchived, updateProject } from "./projects";
import { deleteProjectStatusSet, deleteStateSet, projectStatusChoices, saveProjectStatusSet, saveStateSet, startingStates, stateSetFromTeam, statusesOfSet } from "./status-sets";
import { createTeam, listStates, updateTeam } from "./teams";
import { workflow } from "../../../tests/helpers/workflows";

const ids = {} as Record<"szm" | "lead" | "team", string>;
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const teamValues = (key: string) => ({ key, name: key, description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team" as const, isActive: true });
const projectRow = async (projectId: string) => (await db().select().from(schema.workProject).where(eq(schema.workProject.id, projectId)))[0];
const newProject = (name: string, status = "active") => createProject({ teamId: ids.team, name, description: null, clientId: null, status, visibility: "team", leadPersonId: null, startDate: null, dueDate: null }, ids.lead);
const editProject = async (projectId: string, status: string) => {
  const row = await projectRow(projectId);
  return updateProject(projectId, { name: row.name, description: null, clientId: null, status, visibility: "team", leadPersonId: row.leadPersonId, startDate: null, dueDate: null });
};

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [lead] = await db().insert(schema.person).values({ fullName: "Long Dang", searchName: "long dang", workEmail: "long@suzu.group", workforceType: "employee", status: "active", primaryEntityId: szm.id }).returning();
  Object.assign(ids, { szm: szm.id, lead: lead.id });
  ids.team = (await createTeam(teamValues("VID"), workflow("simple"), ids.lead)).id;
});

describe("task workflows", () => {
  it("start a new team as a copy, which the library can change or lose without touching the team", async () => {
    const { after: set } = await saveStateSet(
      null,
      {
        name: "Video",
        description: null,
        ownerTeamId: null,
        isActive: true,
        states: [
          { name: "Brief", category: "todo" },
          { name: " ", category: "todo" },
          { name: "Edit", category: "in_progress" },
          { name: "Delivered", category: "done" },
        ],
      },
      ids.lead,
    );
    expect(set.states.map((state) => state.name)).toEqual(["Brief", "Edit", "Delivered"]);
    const team = await createTeam(teamValues("VDO"), startingStates(set, {}), ids.lead);
    await saveStateSet(
      set.id,
      {
        name: "Video",
        description: null,
        ownerTeamId: null,
        isActive: true,
        states: [
          { name: "Brief", category: "todo" },
          { name: "Done", category: "done" },
        ],
      },
      ids.lead,
    );
    await deleteStateSet(set.id);
    expect((await listStates([team.id])).map((state) => [state.name, state.category])).toEqual([
      ["Brief", "todo"],
      ["Edit", "in_progress"],
      ["Delivered", "done"],
    ]);
  });

  it("fall back to one state per category, named by the caller", () => {
    expect(startingStates(null, { todo: "Cần làm" }).slice(0, 3)).toEqual([
      { name: "backlog", category: "backlog" },
      { name: "Cần làm", category: "todo" },
      { name: "in_progress", category: "in_progress" },
    ]);
  });

  it("need somewhere to start and somewhere to end", async () => {
    expect(await fails(saveStateSet(null, { name: "No end", description: null, ownerTeamId: null, isActive: true, states: [{ name: "Todo", category: "todo" }] }, ids.lead))).toBe("workflow_needs_start_and_done");
    expect(await fails(saveStateSet(null, { name: "Empty", description: null, ownerTeamId: null, isActive: true, states: [] }, ids.lead))).toBe("state_set_size");
    expect(await fails(createTeam(teamValues("BAD"), [{ name: "Doing", category: "in_progress" }], ids.lead))).toBe("workflow_needs_start_and_done");
  });

  it("save a team's active states, in order, as the team's own", async () => {
    const set = await stateSetFromTeam(ids.team, "VID flow", ids.lead);
    expect(set.ownerTeamId).toBe(ids.team);
    expect(set.states.map((state) => state.name)).toEqual(workflow("simple").map((state) => state.name));
  });
});

describe("project status sets", () => {
  it("leave a team without a set on the bare categories", async () => {
    const project = await newProject("Plain");
    expect(project.statusId).toBeNull();
    expect(await projectStatusChoices(null)).toEqual([]);
  });

  it("name each project's status once the team picks a set, and keep the category in step both ways", async () => {
    const { after: set } = await saveProjectStatusSet(
      null,
      {
        name: "Client work",
        description: null,
        ownerTeamId: null,
        isActive: true,
        statuses: [
          { id: null, name: "Pitching", category: "planned", isActive: true },
          { id: null, name: "Shooting", category: "active", isActive: true },
          { id: null, name: "Editing", category: "active", isActive: true },
          { id: null, name: "Delivered", category: "done", isActive: true },
        ],
      },
      ids.lead,
    );
    const [pitching, shooting, editing, delivered] = set.statuses;
    const before = await newProject("Before the set");
    await updateTeam(ids.team, { name: "VID", description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true, projectStatusSetId: set.id });
    // The team's projects took the set's first status of their category.
    expect((await projectRow(before.id)).statusId).toBe(shooting.id);

    // A category alone: the first status of it. A status: its category.
    const project = await newProject("Campaign", "planned");
    expect(project.statusId).toBe(pitching.id);
    const edited = await editProject(project.id, editing.id);
    expect([edited.after.status, edited.after.statusId]).toEqual(["active", editing.id]);
    await editProject(project.id, delivered.id);
    expect((await projectRow(project.id)).status).toBe("done");

    // Rules that write the category (archive, restore, the kick-off gate) need no change.
    await setProjectArchived(project.id, true);
    expect(await projectRow(project.id)).toMatchObject({ status: "archived", statusId: null });
    await setProjectArchived(project.id, false);
    expect(await projectRow(project.id)).toMatchObject({ status: "active", statusId: shooting.id });

    // Another set's status is refused.
    const { after: other } = await saveProjectStatusSet(null, { name: "Other", description: null, ownerTeamId: null, isActive: true, statuses: [{ id: null, name: "Live", category: "active", isActive: true }] }, ids.lead);
    expect(await fails(editProject(project.id, other.statuses[0].id))).toBe("project_status_not_found");
  });

  it("rename and retire statuses in place, but never remove or recategorise one that holds projects", async () => {
    const set = (await db().select().from(schema.workTeam).where(eq(schema.workTeam.id, ids.team)))[0].projectStatusSetId!;
    const statuses = await statusesOfSet(set, { executor: db() });
    const keep = statuses.map(({ id, name, category, isActive }) => ({ id, name, category: category as "active", isActive }));
    const shooting = keep.find((status) => status.name === "Shooting")!;

    expect(await fails(saveProjectStatusSet(set, { name: "Client work", description: null, ownerTeamId: null, isActive: true, statuses: keep.filter((status) => status.id !== shooting.id) }, ids.lead))).toBe("project_status_in_use");
    expect(
      await fails(
        saveProjectStatusSet(set, { name: "Client work", description: null, ownerTeamId: null, isActive: true, statuses: keep.map((status) => (status.id === shooting.id ? { ...status, category: "paused" as const } : status)) }, ids.lead),
      ),
    ).toBe("project_status_in_use");

    const { after } = await saveProjectStatusSet(
      set,
      {
        name: "Client work",
        description: null,
        ownerTeamId: null,
        isActive: true,
        statuses: [...keep.map((status) => (status.id === shooting.id ? { ...status, name: "On set", isActive: false } : status)), { id: null, name: "On hold", category: "paused", isActive: true }],
      },
      ids.lead,
    );
    expect(after.statuses.map((status) => status.name)).toEqual(["Pitching", "On set", "Editing", "Delivered", "On hold"]);
    // A retired status is still the project's own in its form, and offered to nobody else.
    const inShooting = (await db().select().from(schema.workProject).where(eq(schema.workProject.statusId, shooting.id)))[0];
    expect((await projectStatusChoices(set, inShooting.statusId)).map((status) => status.name)).toContain("On set");
    expect((await projectStatusChoices(set)).map((status) => status.name)).not.toContain("On set");
    expect(await fails(editProject((await newProject("New")).id, shooting.id))).toBe("project_status_not_found");

    expect(await fails(deleteProjectStatusSet(set))).toBe("status_set_in_use");
  });

  it("drop a team's statuses when it leaves its set, keeping each project's category", async () => {
    const categories = async () => new Map((await db().select().from(schema.workProject).where(eq(schema.workProject.teamId, ids.team))).map((row) => [row.id, row.status]));
    const before = await categories();
    await updateTeam(ids.team, { name: "VID", description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true, projectStatusSetId: null });
    const rows = await db().select().from(schema.workProject).where(eq(schema.workProject.teamId, ids.team));
    expect(rows.every((row) => row.statusId === null)).toBe(true);
    expect(await categories()).toEqual(before);
  });

  it("refuse a set owned by another team", async () => {
    const other = await createTeam(teamValues("DES"), workflow("simple"), ids.lead);
    const { after: own } = await saveProjectStatusSet(null, { name: "Design only", description: null, ownerTeamId: other.id, isActive: true, statuses: [{ id: null, name: "Drafting", category: "active", isActive: true }] }, ids.lead);
    expect(await fails(updateTeam(ids.team, { name: "VID", description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true, projectStatusSetId: own.id }))).toBe("status_set_not_found");
  });
});
