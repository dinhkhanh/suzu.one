// Phase 13 R2 against a real Postgres (PGlite): names, work and people (D33, FR-AGT-12…14). One
// permitted and one refused persona for every tool, and the three red-team cases of the plan:
//
//   1. a colleague asks for someone's lateness          → not offered the overview; the card only
//   2. a team lead asks about a private project of another team they are not on → not found
//   3. a line manager asks for a report's pay           → there is no section and no tool for it
//
// The cast: Long leads the Video team and manages Huy and Tâm; Huy and Tâm are on the team; Tâm made
// a private project Huy is not on; Mai leads Design; Bao is a colleague with no team; Ha is the
// owner; Linh is a collaborator.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" }), isDevelopmentEnvironment: () => true }));
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
vi.mock("@/modules/platform/notifications/service", () => ({ notify: async () => undefined }));

import { and, eq } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { createProject } from "@/modules/work/projects";
import { createWorkTask } from "@/modules/work/tasks";
import { createTeam, setTeamMember } from "@/modules/work/teams";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { workflow } from "../../../../tests/helpers/workflows";
import { resolveAnswer } from "../conversations";
import { scriptedDriver } from "./driver";
import { askerFactsOf } from "./facts";
import { runAgentTurn } from "./loop";
import { type AgentUser, type AnyAgentTool, runAgentTool, toolsFor } from "./registry";
import { AGENT_TOOLS } from "./tools";

type Who = "long" | "huy" | "tam" | "mai" | "bao" | "ha" | "linh";
const ids = {} as Record<Who | "szm" | "video" | "design" | "dept" | "teamProject" | "secret" | "task" | "secretTask", string>;
const users = {} as Record<Who, AgentUser>;
const today = todayInVietnam();
const month = today.slice(0, 7);

const NAMES: Record<Who, string> = { long: "Dang Hoang Long", huy: "Ho Gia Huy", tam: "Bui Thanh Tam", mai: "Le Thi Mai", bao: "Pham Quoc Bao", ha: "Nguyen Thu Ha", linh: "Do Khanh Linh" };
const GRANTS: Partial<Record<Who, Grant[]>> = { ha: [{ role: "owner", scope: { type: "group" } }] };

const tool = (name: string): AnyAgentTool => AGENT_TOOLS.find((candidate) => candidate.name === name)!;
const run = (who: Who, name: string, input: unknown = {}) => runAgentTool(tool(name), { user: users[who], today, locale: "vi" }, input);
const offered = async (who: Who) => toolsFor(AGENT_TOOLS, users[who].principal, await askerFactsOf(users[who])).map((candidate) => candidate.name);
const text = (value: unknown) => JSON.stringify(value);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [dept] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, dept: dept.id });
  for (const who of Object.keys(NAMES) as Who[]) {
    const name = NAMES[who];
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${who}@suzu.group`, status: "active", primaryEntityId: szm.id, orgUnitId: dept.id, workforceType: who === "linh" ? "collaborator" : "employee" })
      .returning();
    ids[who] = row.id;
  }
  // Long manages Huy and Tâm.
  await db().update(schema.person).set({ managerId: ids.long }).where(eq(schema.person.id, ids.huy));
  await db().update(schema.person).set({ managerId: ids.long }).where(eq(schema.person.id, ids.tam));
  for (const [who, grants] of Object.entries(GRANTS) as [Who, Grant[]][])
    for (const grant of grants) await db().insert(schema.roleAssignment).values({ personId: ids[who], role: grant.role, scopeType: grant.scope.type, scopeId: null, validFrom: "2024-01-01" });
  const people = await db().select().from(schema.person);
  for (const who of Object.keys(NAMES) as Who[]) {
    const row = people.find((person) => person.id === ids[who])!;
    const principal: Principal = { personId: row.id, workforceType: row.workforceType, grants: GRANTS[who] ?? [] };
    users[who] = { person: { id: row.id, primaryEntityId: row.primaryEntityId, orgUnitId: row.orgUnitId, orgUnitPath: row.orgUnitPath, fullName: row.fullName }, principal, reauthAt: new Date() };
  }

  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  const design = await createTeam({ key: "DES", name: "Design", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.mai);
  Object.assign(ids, { video: video.id, design: design.id });
  for (const who of ["huy", "tam"] as const) await setTeamMember(video.id, ids[who], "member");
  const project = (name: string, visibility: "team" | "private", actor: string) =>
    createProject({ teamId: video.id, name, description: null, clientId: null, status: "active", visibility, leadPersonId: null, startDate: null, dueDate: null }, actor);
  ids.teamProject = (await project("TVC Tet", "team", ids.long)).id;
  ids.secret = (await project("Pitch confidential", "private", ids.tam)).id;
  ids.task = (await createWorkTask({ teamId: video.id, projectId: ids.teamProject, title: "Rough cut — gọi 0912 345 678", assigneePersonId: ids.huy, requesterPersonId: ids.long, dueDate: "2026-01-05" }, ids.long)).task.id;
  ids.secretTask = (await createWorkTask({ teamId: video.id, projectId: ids.secret, title: "Pitch deck", assigneePersonId: ids.tam }, ids.tam)).task.id;

  // Huy was late twice this month.
  await db()
    .insert(schema.timesheetDay)
    .values([0, 1].map((day) => ({ personId: ids.huy, entityId: szm.id, date: `${month}-0${day + 1}`, planKind: "working", status: "present" as const, requiredMinutes: 480, workedMinutes: 480, lateMinutes: 15, inputsHash: `huy-${day}` })));
}, 120_000);

describe("what each asker is offered (the tool matrix, as people)", () => {
  it("gives a lead the lead's tools, and a team member none of them", async () => {
    expect(await offered("long")).toEqual(expect.arrayContaining(["team_board", "team_workload", "timesheets_to_approve", "person_overview"]));
    const huy = await offered("huy");
    for (const name of ["team_board", "team_workload", "timesheets_to_approve", "person_overview"]) expect(huy, name).not.toContain(name);
    expect(huy).toEqual(expect.arrayContaining(["find_person", "find_project", "find_task", "task_detail", "project_status"]));
  });

  it("sends the owner every tool, with no more strict ones than the API takes (20)", async () => {
    const driver = scriptedDriver([{ text: "…" }]);
    await runAgentTurn({ user: users.ha, question: "Xin chào", locale: "vi", today, history: [], driver });
    const tools = driver.calls[0].tools ?? [];
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.filter((candidate) => candidate.strict).length).toBeLessThanOrEqual(20);
  });

  it("keeps the directory from a collaborator", async () => {
    expect(await offered("linh")).not.toContain("find_person");
  });
});

describe("a name is resolved within the asker's directory (D33, FR-AGT-12)", () => {
  it("finds a colleague's card — a name, a title, a unit — and never their email", async () => {
    const result = await run("bao", "find_person", { name: "huy" });
    expect(result.outcome).toBe("answered");
    expect(text(result.model)).toContain(ids.huy);
    expect(text(result.model)).not.toContain("huy@suzu.group");
  });

  it("prefers whole words: Huy is not Thùy, nor Huỳnh", async () => {
    const { peopleMatching } = await import("./tools/lookup");
    const rows = [{ fullName: "Hồ Gia Huy" }, { fullName: "Dương Thùy Chi" }, { fullName: "Huỳnh Mỹ Duyên" }];
    expect(peopleMatching(rows, "Huy").rows.map((row) => row.fullName)).toEqual(["Hồ Gia Huy"]);
    expect(peopleMatching(rows, "Duyen").rows.map((row) => row.fullName)).toEqual(["Huỳnh Mỹ Duyên"]);
    expect(peopleMatching(rows, "Hu").rows.map((row) => row.fullName)).toHaveLength(3);
  });

  it("finds a name typed loosely — misspelt, in another order, as initials — and says it guessed", async () => {
    const misspelt = await run("bao", "find_person", { name: "Hoang Lnog" });
    expect(text(misspelt.model)).toContain(ids.long);
    expect(misspelt.model).toHaveProperty("nameGuessed");
    const initials = await run("bao", "find_person", { name: "HGH" });
    expect(text(initials.model)).toContain(ids.huy);
    const reordered = await run("bao", "find_person", { name: "Gia Huy Ho" });
    expect(text(reordered.model)).toContain(ids.huy);
    expect(reordered.model).not.toHaveProperty("nameGuessed");
  });

  it("reads a misspelt name the same way for a colleague's overview", async () => {
    const result = await run("long", "person_overview", { person: "Ho Gia Huyy" });
    expect(result.outcome).toBe("answered");
    expect(result.subject).toEqual({ type: "person", id: ids.huy });
    expect(result.model).toHaveProperty("nameGuessed");
  });

  it("finds nobody for a name nobody has", async () => {
    expect((await run("bao", "find_person", { name: "khong ai ten nay" })).outcome).toBe("empty");
  });
});

describe("projects and tasks named loosely, still only as the asker may open them", () => {
  it("guesses a misspelt project among those the asker may open, and no other", async () => {
    const found = await run("huy", "find_project", { query: "TVC Tett" });
    expect(text(found.model)).toContain(ids.teamProject);
    expect(found.model).toHaveProperty("nameGuessed");
    expect((await run("huy", "find_project", { query: "Pitch confidental" })).outcome).toBe("empty");
    expect((await run("tam", "project_status", { project: "Pitch confidental" })).subject).toEqual({ type: "project", id: ids.secret });
  });

  it("finds a task by its title without marks, or misspelt", async () => {
    const unmarked = await run("huy", "find_task", { query: "goi" });
    expect(text(unmarked.model)).toContain("Rough cut");
    expect(unmarked.model).not.toHaveProperty("nameGuessed");
    const misspelt = await run("huy", "find_task", { query: "rouhg cutt" });
    expect(text(misspelt.model)).toContain("Rough cut");
    expect(misspelt.model).toHaveProperty("nameGuessed");
    expect((await run("huy", "find_task", { query: "Pitch dekc" })).outcome).toBe("empty");
  });
});

describe("projects and tasks only as the asker may open them (FR-AGT-13)", () => {
  it("shows the private project to its own people and the owner, and audits the owner's read", async () => {
    expect((await run("tam", "project_status", { project: "Pitch" })).outcome).toBe("answered");
    const owner = await run("ha", "project_status", { project: ids.secret });
    expect(owner.outcome).toBe("answered");
    const trail = await db()
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "projects.private.read"), eq(schema.auditLog.actorPersonId, ids.ha)));
    expect(trail.length).toBeGreaterThan(0);
  });

  it("RED TEAM 2: never shows it to a lead of another team, nor to a team member who is not on it", async () => {
    for (const who of ["mai", "huy"] as const) {
      for (const [name, input] of [
        ["find_project", { query: "Pitch" }],
        ["project_status", { project: "Pitch confidential" }],
        ["project_status", { project: ids.secret }],
      ] as const) {
        const result = await run(who, name, input);
        expect(result.outcome, `${who} ${name}`).not.toBe("answered");
        // The asker's own words may come back; the project — its id, its task — may not.
        expect(text(result.model), `${who} ${name}`).not.toContain(ids.secret);
        expect(text(result.model), `${who} ${name}`).not.toContain("Pitch deck");
      }
      const portfolio = await run(who, "portfolio_health");
      expect(text(portfolio.model), who).not.toContain(ids.secret);
      expect(text(portfolio.model), who).not.toContain("Pitch confidential");
      // Its task is not found by key either.
      expect((await run(who, "task_detail", { task: ids.secretTask })).outcome, who).toBe("refused");
    }
  });

  it("opens a task the asker may see, with its contact details taken out", async () => {
    const result = await run("huy", "task_detail", { task: ids.task });
    expect(result.outcome).toBe("answered");
    expect(text(result.model)).toContain("Rough cut");
    expect(text(result.model)).not.toContain("0912");
  });

  it("finds a task by its words only among the tasks the asker may see", async () => {
    expect(text((await run("tam", "find_task", { query: "Pitch" })).model)).toContain("Pitch deck");
    expect(text((await run("mai", "find_task", { query: "Pitch" })).model)).not.toContain("Pitch deck");
  });
});

describe("a lead's view (FR-AGT-13)", () => {
  it("shows the lead their team's overdue work", async () => {
    const board = await run("long", "team_board");
    expect(board.outcome).toBe("answered");
    expect(text(board.model)).toContain("Rough cut");
    expect((await run("long", "team_workload")).outcome).not.toBe("refused");
  });

  it("refuses the workload to somebody who leads no team", async () => {
    expect((await run("huy", "team_workload")).outcome).toBe("refused");
  });

  it("shows who is in by status alone — no punch times for anybody", async () => {
    const presence = await run("bao", "who_is_in");
    expect(presence.outcome).toBe("answered");
    expect(text(presence.model)).not.toMatch(/firstInAt|lastOutAt|"\d{2}:\d{2}/u);
  });

  it("lists timesheets to approve for an approver, and nothing for anybody else", async () => {
    expect(["answered", "empty"]).toContain((await run("long", "timesheets_to_approve")).outcome);
    expect((await run("bao", "timesheets_to_approve")).outcome).toBe("empty");
  });
});

describe("a person's overview: each section only where its module allows (FR-AGT-14)", () => {
  it("shows a line manager their report's attendance and leave", async () => {
    const result = await run("long", "person_overview", { person: ids.huy });
    expect(result.outcome).toBe("answered");
    expect(result.model).toMatchObject({ name: NAMES.huy, attendanceThisMonth: { lateCount: 2, daysRecorded: 2 } });
    expect(result.model.sectionsShown).toEqual(expect.arrayContaining(["card", "attendance"]));
  });

  it("RED TEAM 1: gives a colleague only the card — no lateness, no leave, no tasks", async () => {
    // A colleague is not offered the overview at all; were it run for them, the modules refuse every section.
    expect(await offered("bao")).not.toContain("person_overview");
    const result = await run("bao", "person_overview", { person: ids.huy });
    expect(result.model.sectionsShown).toEqual(["card"]);
    expect(text(result.model)).not.toMatch(/lateCount|leaveThisYear|tasks90Days|utilisation/u);
  });

  it("RED TEAM 3: has nothing about pay for a line manager — no section, no figure, no email", async () => {
    const result = await run("long", "person_overview", { person: ids.huy });
    expect(text(result.model)).not.toMatch(/salary|luong|lương|payslip|netVnd|grossVnd|multiplier/iu);
    expect(text(result.model)).not.toContain("@suzu.group");
  });

  it("asks which person when a name fits several", async () => {
    const result = await run("long", "person_overview", { person: "thi" });
    expect(["answered", "empty"]).toContain(result.outcome);
  });
});

describe("a question about somebody else reaches the agent, not the router's refusal (D33)", () => {
  it("lets a manager's question about a report through to the tools", async () => {
    const driver = scriptedDriver([
      { tools: [{ name: "person_overview", input: { person: ids.huy } }] },
      (call) => ({ text: `Huy đi muộn ${JSON.stringify(call.messages.at(-1)).replaceAll("\\", "").includes('"lateCount":2') ? 2 : "?"} lần.` }),
    ]);
    const resolved = await resolveAnswer(users.long, `Tháng này ${NAMES.huy} đi muộn mấy lần?`, "vi", { agent: driver });
    expect(resolved).toMatchObject({ kind: "agent", outcome: "answered" });
    expect(resolved.kind === "agent" && resolved.turn.kind === "answered" && resolved.turn.body).toBe("Huy đi muộn 2 lần.");
    // An overview is analysis: Opus writes the answer, with no tools (D38).
    expect(driver.calls.map((call) => call.tier)).toEqual(["simple", "complex"]);
  });

  it("still answers a question about the asker for free, on the router", async () => {
    const driver = scriptedDriver([]);
    const resolved = await resolveAnswer(users.huy, "Tháng này tôi đi muộn mấy lần?", "vi", { agent: driver });
    expect(resolved.kind).toBe("tool");
    expect(driver.calls).toHaveLength(0);
  });

  it("sends no contact detail to the model on any R2 tool", async () => {
    const driver = scriptedDriver([
      {
        tools: [
          { name: "find_person", input: { name: "huy" } },
          { name: "task_detail", input: { task: ids.task } },
          { name: "person_overview", input: { person: ids.huy } },
          { name: "team_board", input: {} },
        ],
      },
      { text: "…" },
    ]);
    await runAgentTurn({ user: users.long, question: "Tóm tắt về Huy", locale: "vi", today, history: [], driver });
    const sent = JSON.stringify(driver.calls);
    expect(sent).not.toContain("@suzu.group");
    expect(sent).not.toContain("0912");
  });
});
