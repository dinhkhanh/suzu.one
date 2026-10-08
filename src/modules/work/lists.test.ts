// PERF-03, against a real Postgres (PGlite): a project's or a backlog's screen loads its open work
// and closed work only as far as it shows it, says how many matched, and keeps the open work first
// when the limit cuts.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { taskSliceFor } from "./engine/filter";
import { createProject } from "./projects";
import { createWorkTask, listProjectTasks, listTaskSlice } from "./tasks";
import { createTeam } from "./teams";
import { workflow } from "../../../tests/helpers/workflows";

const ids = {} as Record<"lead" | "team" | "project", string>;
const tasks = {} as Record<"open1" | "open2" | "open3" | "doneLately" | "doneLongAgo" | "backlog", string>;
const TODAY = "2026-10-05";
const MONTH = { from: "2026-09-28", to: "2026-11-08" };

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [lead] = await db().insert(schema.person).values({ fullName: "lead", searchName: "lead", workEmail: "lead@suzu.group", status: "active", primaryEntityId: entity.id }).returning();
  ids.lead = lead.id;
  ids.team = (await createTeam({ key: "VID", name: "Video", description: null, entityId: entity.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), lead.id)).id;
  ids.project = (await createProject({ teamId: ids.team, name: "TVC", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: lead.id, startDate: null, dueDate: null }, lead.id)).id;
  const make = async (title: string, dueDate: string | null, projectId: string | null = ids.project) => (await createWorkTask({ teamId: ids.team, projectId, title, dueDate }, lead.id)).task.id;
  tasks.open1 = await make("Open one", "2026-10-10");
  tasks.open2 = await make("Open two", null);
  tasks.open3 = await make("Open three", "2026-12-01");
  tasks.doneLately = await make("Done lately", "2026-10-01");
  tasks.doneLongAgo = await make("Done long ago", "2026-06-01");
  tasks.backlog = await make("In the backlog", null, null);
  // Closed by hand, with the times a screen asks about.
  await db()
    .update(schema.task)
    .set({ status: "done", updatedAt: new Date("2026-10-03T03:00:00Z") })
    .where(eq(schema.task.id, tasks.doneLately));
  await db()
    .update(schema.task)
    .set({ status: "cancelled", updatedAt: new Date("2026-06-02T03:00:00Z") })
    .where(eq(schema.task.id, tasks.doneLongAgo));
});

const idsOf = (slice: { items: { id: string }[] }) => slice.items.map((item) => item.id).sort();
const sorted = (...keys: (keyof typeof tasks)[]) => keys.map((key) => tasks[key]).sort();

describe("a screen's slice of a project's tasks (PERF-03)", () => {
  it("the list loads open work only, unless closed work is asked for", async () => {
    const open = await listTaskSlice({ projectId: ids.project }, taskSliceFor("list", {}, TODAY, MONTH));
    expect(idsOf(open)).toEqual(sorted("open1", "open2", "open3"));
    expect(open.total).toBe(3);
    // "Show closed", or a state picked, brings everything.
    for (const filters of [{ closed: "1" }, { state: "any-state" }]) {
      const all = await listTaskSlice({ projectId: ids.project }, taskSliceFor("table", filters, TODAY, MONTH));
      expect(idsOf(all)).toEqual(sorted("open1", "open2", "open3", "doneLately", "doneLongAgo"));
      expect(all.total).toBe(5);
    }
    // The same rows as the old reader gives, closed ones included.
    expect(idsOf({ items: await listProjectTasks(ids.project) })).toEqual(sorted("open1", "open2", "open3", "doneLately", "doneLongAgo"));
  });

  it("the board loads what its 'done' columns show: the last two weeks, or everything with 'show closed'", async () => {
    expect(idsOf(await listTaskSlice({ projectId: ids.project }, taskSliceFor("board", {}, TODAY, MONTH)))).toEqual(sorted("open1", "open2", "open3", "doneLately"));
    expect((await listTaskSlice({ projectId: ids.project }, taskSliceFor("board", { closed: "1" }, TODAY, MONTH))).total).toBe(5);
  });

  it("the calendar loads the month's dated tasks, whatever their state, and nothing else", async () => {
    expect(idsOf(await listTaskSlice({ projectId: ids.project }, taskSliceFor("calendar", {}, TODAY, MONTH)))).toEqual(sorted("open1", "doneLately"));
  });

  it("a backlog is the team's tasks outside any project", async () => {
    expect(idsOf(await listTaskSlice({ backlogOf: ids.team }, { closed: "all" }))).toEqual([tasks.backlog]);
  });

  it("past the limit it keeps the open work first, then the latest closed, in board order, and counts them all", async () => {
    const cut = await listTaskSlice({ projectId: ids.project }, { closed: "all" }, db(), 4);
    expect(cut.total).toBe(5);
    expect(idsOf(cut)).toEqual(sorted("open1", "open2", "open3", "doneLately"));
    const ranks = await db()
      .select({ id: schema.workTask.taskId, rank: schema.workTask.boardRank, number: schema.workTask.number })
      .from(schema.workTask)
      .where(
        inArray(
          schema.workTask.taskId,
          cut.items.map((item) => item.id),
        ),
      );
    const order = ranks.sort((a, b) => a.rank - b.rank || a.number - b.number).map((row) => row.id);
    expect(cut.items.map((item) => item.id)).toEqual(order);
  });
});
