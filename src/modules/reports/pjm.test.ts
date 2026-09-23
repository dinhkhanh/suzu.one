// The delivery insight reports against a real Postgres (PGlite): the delivery dashboard counts the
// projects the reader may open and nothing else (FR-PJM-60); profitability is `pjm:cost` only —
// refused to everyone else on screen and through the CSV export alike — and no person's rate or
// cost ever appears in what it returns (FR-PJM-63); and the monthly job proposes KPI actuals from
// the work tables (FR-PJM-62).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://suzu.one", allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
}));
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

import { and, eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { runInputContext, runResultContext } from "../payroll/field-contexts";
import { loadedCostRates } from "../payroll/service";
import { saveKpi, createAssignment } from "../performance/kpis";
import type { Grant, Principal } from "../platform/rbac/policy";
import { createProject } from "../work/projects";
import { createTeam, listStates, setTeamMember } from "../work/teams";
import { buildReportFor, reportToCsv } from "./catalogue";
import { getDeliveryDashboard } from "./delivery";
import { runKpiFromWork } from "./kpi-from-work";
import { buildProfitability, getProfitability } from "./profitability";

type Who = "long" | "huy" | "lan" | "khoi" | "finance" | "director" | "head" | "owner";
const ids = {} as Record<Who | "szm" | "szc" | "video" | "tvc" | "secret" | "other" | "done", string>;
const people = {} as Record<Who, { person: typeof schema.person.$inferSelect; principal: Principal }>;
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const at = (value: string) => new Date(`${value}+07:00`);
let taskNumber = 0;

async function workTask(input: { title: string; projectId: string; assignee: string; status: "todo" | "done"; dueDate: string | null; completedAt?: Date }): Promise<string> {
  const [state] = await listStates([ids.video]);
  const [row] = await db().insert(schema.task).values({ kind: "work", title: input.title, status: input.status, assigneePersonId: input.assignee, dueDate: input.dueDate, completedAt: input.completedAt ?? null, entityId: ids.szm }).returning();
  await db().insert(schema.workTask).values({ taskId: row.id, teamId: ids.video, projectId: input.projectId, number: ++taskNumber, stateId: state.id });
  return row.id;
}

/** A signed regular payroll run for one person and month, stored encrypted as payroll stores it. */
async function signedRun(personId: string, month: string, employerCost: number, standardDays: number) {
  const [run] = await db().insert(schema.payrollRun).values({ entityId: ids.szm, month, kind: "regular", status: "locked", headcount: 1 }).returning();
  const id = crypto.randomUUID();
  const result = { totals: { employerCost, grossEarnings: employerCost }, proration: { standardDays } };
  const input = { period: { standardDays }, timesheet: { standardDays, standardMinutes: standardDays * 480 } };
  await db().insert(schema.payrollRunPerson).values({ id, runId: run.id, personId, entityId: ids.szm, profile: "statutory", resultEnc: fieldCipher().encrypt(JSON.stringify(result), runResultContext(id)), inputEnc: fieldCipher().encrypt(JSON.stringify(input), runInputContext(id)) });
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  const grants: Record<Who, Grant[]> = {
    long: [],
    huy: [],
    lan: [],
    khoi: [],
    finance: [{ role: "finance", scope: { type: "entity", id: szm.id } }],
    director: [{ role: "entity_director", scope: { type: "entity", id: szm.id } }],
    head: [{ role: "department_head", scope: { type: "entity", id: szm.id } }],
    owner: [{ role: "owner", scope: { type: "group" } }],
  };
  for (const who of Object.keys(grants) as Who[]) {
    const entityId = who === "khoi" ? szc.id : szm.id;
    const [person] = await db().insert(schema.person).values({ fullName: `Người ${who}`, searchName: who, workEmail: `${who}@suzu.group`, status: "active", primaryEntityId: entityId, managerId: who === "huy" || who === "lan" ? ids.long : null }).returning();
    ids[who] = person.id;
    people[who] = { person, principal: { personId: person.id, workforceType: "employee", grants: grants[who] } };
  }
  // Long leads the video team; Huy and Lan work in it. Khoi is at another entity, on nothing.
  const video = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.video = video.id;
  await setTeamMember(video.id, ids.huy, "member");
  await setTeamMember(video.id, ids.lan, "member");
  const project = (name: string, visibility: "team" | "private") => createProject({ teamId: video.id, name, description: null, clientId: null, status: "active", visibility, leadPersonId: ids.long, startDate: "2026-09-01", dueDate: "2026-12-31" }, ids.long).then((row) => row.id);
  ids.tvc = await project("TVC Tết", "team");
  ids.secret = await project("Dự án riêng", "private");
  await db().update(schema.workProject).set({ entityId: szm.id }).where(eq(schema.workProject.teamId, video.id));
  await db().insert(schema.projectPlan).values({ projectId: ids.tvc, kind: "client", feeVnd: 50_000_000, jobNumber: "SZM-26-900" }).onConflictDoNothing();

  // September on TVC: three dated tasks done (two on time), one returned hand-off, a client revision, a blocker.
  const doneOnTime = await workTask({ title: "Kịch bản", projectId: ids.tvc, assignee: ids.huy, status: "done", dueDate: "2026-09-10", completedAt: at("2026-09-09T10:00:00") });
  ids.done = doneOnTime;
  await workTask({ title: "Storyboard", projectId: ids.tvc, assignee: ids.huy, status: "done", dueDate: "2026-09-15", completedAt: at("2026-09-15T17:00:00") });
  const late = await workTask({ title: "Dựng bản 1", projectId: ids.tvc, assignee: ids.huy, status: "done", dueDate: "2026-09-20", completedAt: at("2026-09-22T09:00:00") });
  await db().insert(schema.workHandoff).values({ taskId: late, kind: "stage", status: "returned", fromPersonId: ids.huy, toPersonId: ids.lan, createdAt: at("2026-09-18T09:00:00"), respondedAt: at("2026-09-18T11:00:00"), returnReason: "Thiếu phụ đề" });
  const [deliverable] = await db().insert(schema.workDeliverable).values({ taskId: late, version: 1, kind: "link", url: "https://drive.google.com/x", submittedByPersonId: ids.huy, decision: "changes_requested", decidedAt: at("2026-09-19T09:00:00") }).returning();
  await db().insert(schema.workDeliverableDecision).values({ deliverableId: deliverable.id, decision: "changes_required", decidedByPersonId: ids.long, isClient: true, createdAt: at("2026-09-19T09:00:00") });
  await db().insert(schema.workBlocker).values({ taskId: late, reason: "Chờ nhạc", raisedByPersonId: ids.huy, raisedAt: at("2026-09-16T09:00:00"), resolvedAt: at("2026-09-16T12:00:00"), resolvedByPersonId: ids.long });
  // A private project's task: counted for its members, and never named on profitability.
  const secretTask = await workTask({ title: "Việc riêng", projectId: ids.secret, assignee: ids.lan, status: "done", dueDate: "2026-09-05", completedAt: at("2026-09-04T10:00:00") });

  // Time and pay: Huy 30 h and Lan 10 h on TVC in September, Lan 5 h on the private project.
  await db().insert(schema.timeEntry).values([
    { personId: ids.huy, date: "2026-09-09", weekStart: "2026-09-07", taskId: doneOnTime, minutes: 1_800, billable: true },
    { personId: ids.lan, date: "2026-09-10", weekStart: "2026-09-07", taskId: late, minutes: 600, billable: true },
    { personId: ids.lan, date: "2026-09-04", weekStart: "2026-08-31", taskId: secretTask, minutes: 300, billable: false },
  ]);
  // Huy costs 22 000 000 over 22 days of 8 h = 125 000 an hour; Lan 17 600 000 = 100 000 an hour, in August only.
  await signedRun(ids.huy, "2026-09", 22_000_000, 22);
  await signedRun(ids.lan, "2026-08", 17_600_000, 22);
});

describe("the delivery dashboard (FR-PJM-60)", () => {
  it("counts the lead's team projects", async () => {
    const view = await getDeliveryDashboard(people.long, PERIOD, "2026-10-01");
    expect(view.total.projects).toBe(2);
    expect(view.total.onTime).toMatchObject({ completed: 4, dated: 4, onTime: 3, late: 1 });
    expect(view.total.handoffs).toMatchObject({ total: 1, returned: 1, answered: 1, averageWaitMinutes: 120 });
    expect(view.total.revisions).toMatchObject({ clientRounds: 1, internalRounds: 0 });
    expect(view.total.blocked).toMatchObject({ blockers: 1, blockedMinutes: 180, open: 0 });
    expect(view.retainers).toBeNull();
    // Long leads the team: its compliance is his to see.
    expect(view.compliance?.teams.map((team) => team.teamId)).toEqual([ids.video]);
  });

  it("gives a member the team's projects but not the private one, and an outsider nothing", async () => {
    const huy = await getDeliveryDashboard(people.huy, PERIOD, "2026-10-01");
    expect(huy.total.projects).toBe(1);
    expect(huy.total.onTime.completed).toBe(3);
    expect(huy.compliance).toBeNull();
    const khoi = await getDeliveryDashboard(people.khoi, PERIOD, "2026-10-01");
    expect(khoi.total.projects).toBe(0);
    expect(khoi.total.onTime.completed).toBe(0);
  });

  it("builds as a schedulable report with the reader's own scope", async () => {
    const table = await buildReportFor(people.khoi, "delivery", {}, PERIOD, "vi");
    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0][1]).toBe(0);
  });
});

describe("profitability (FR-PJM-63)", () => {
  it("costs hours at each person's loaded rate and shows project, client and team totals", async () => {
    const view = (await buildProfitability(people.finance, PERIOD))!;
    const tvc = view.projects.find((project) => project.id === ids.tvc)!;
    // Huy 30 h × 125 000 + Lan 10 h × 100 000 (August's rate: September has no signed run for her).
    expect(tvc).toMatchObject({ basis: "project_fee", feeVnd: 50_000_000, costVnd: 3_750_000 + 1_000_000, marginVnd: 45_250_000, hours: 40, estimated: true });
    expect(tvc.byTeam).toEqual([{ name: "Video", other: false, hours: 40, costVnd: 4_750_000 }]);
    // Finance holds `pjm:portfolio` since the owner's decision of 2026-09-23, so it may open a
    // private project and the report names it rather than summing it away — and says so in the log.
    expect(view.projects.map((project) => project.id)).toContain(ids.secret);
    expect(view.privateProjects).toBeNull();
  });

  it("gives another entity's reader nothing of this one, however the filter is crafted", async () => {
    const [bank] = await db().insert(schema.workClient).values({ code: "BANK", name: "Ngân hàng Bí mật", entityId: ids.szm }).returning();
    await db().update(schema.workProject).set({ clientId: bank.id }).where(eq(schema.workProject.id, ids.secret));
    // Finance of the sister company: `pjm:cost` and `pjm:commercial` over SZC, nothing over SZM.
    const creative = { ...people.finance, principal: { ...people.finance.principal, grants: [{ role: "finance" as const, scope: { type: "entity" as const, id: ids.szc } }] } };
    try {
      const view = await buildProfitability(creative, PERIOD);
      const text = JSON.stringify(view ?? {});
      expect(text).not.toContain("Ngân hàng Bí mật");
      expect(text).not.toContain(ids.secret);
      // Naming the client in the filter buys nothing: the scope is read from the grant, not the query.
      const crafted = await buildProfitability(creative, { ...PERIOD, clientId: bank.id });
      expect(JSON.stringify(crafted ?? {})).not.toContain("Ngân hàng Bí mật");
      expect(crafted?.clients ?? []).toEqual([]);
    } finally {
      await db().update(schema.workProject).set({ clientId: null }).where(eq(schema.workProject.id, ids.secret));
    }
  });

  it("names a private project only to its people and the reader D30 let in, and records that read", async () => {
    const view = (await buildProfitability({ ...people.owner, userId: "u-owner", email: "owner@suzu.group" }, PERIOD))!;
    // The owner holds `pjm:portfolio` everywhere: the private project is named, not summed away.
    expect(view.projects.map((project) => project.id)).toContain(ids.secret);
    expect(view.privateProjects).toBeNull();
    // And naming it is a read of a private project they are none of the people of (Q25 — D30).
    const rows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "projects.private.read"), eq(schema.auditLog.actorPersonId, ids.owner)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceType: "work_project", resourceId: ids.secret, actorEmail: "owner@suzu.group" });
    expect(rows[0].summary).toBeNull();
    // Finance may open it too (owner, 2026-09-23), so its reads are recorded the same way — and a
    // reader who holds neither the cost nor the portfolio right gets no report at all (below).
    const financeRows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "projects.private.read"), eq(schema.auditLog.actorPersonId, ids.finance)));
    expect(financeRows.length).toBeGreaterThan(0);
    expect(financeRows.every((row) => row.resourceId === ids.secret && row.summary === null)).toBe(true);
  });

  it("never returns a person's id, name, rate or single cost", async () => {
    const text = JSON.stringify(await buildProfitability(people.finance, PERIOD));
    for (const who of ["huy", "lan"] as const) {
      expect(text).not.toContain(ids[who]);
      expect(text).not.toContain(people[who].person.fullName);
    }
    for (const figure of ["125000", "100000", "3750000"]) expect(text).not.toContain(figure);
  });

  it("gives nothing to readers without pjm:cost — on screen and through the CSV export", async () => {
    for (const who of ["director", "head", "long", "huy", "khoi"] as const) {
      expect(await buildProfitability(people[who], PERIOD), who).toBeNull();
      expect(await getProfitability(people[who], PERIOD), who).toBeNull();
      expect(await buildReportFor(people[who], "profitability", {}, PERIOD, "vi"), who).toBeNull();
      expect(await loadedCostRates(people[who].principal, { personIds: [ids.huy, ids.lan], fromMonth: "2026-01", toMonth: "2026-12" }), who).toEqual([]);
    }
  });

  it("exports the same rows to a pjm:cost holder, still without a person in them", async () => {
    const table = (await buildReportFor(people.finance, "profitability", {}, PERIOD, "vi"))!;
    const csv = reportToCsv(table, "p.csv").csv;
    expect(csv).toContain("TVC Tết");
    expect(csv).not.toContain(people.huy.person.fullName);
    expect(csv).not.toContain("125000");
  });

  it("audits every screen read", async () => {
    await getProfitability({ ...people.finance, userId: null, email: "finance@suzu.group" }, PERIOD);
    const rows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "pjm.profitability.read"), eq(schema.auditLog.actorPersonId, ids.finance)));
    expect(rows).toHaveLength(1);
  });

  it("keeps each reader to their entities: finance of SZM sees no rate of another entity's run", async () => {
    const creativeFinance: Principal = { personId: ids.finance, workforceType: "employee", grants: [{ role: "finance", scope: { type: "entity", id: ids.szc } }] };
    expect(await loadedCostRates(creativeFinance, { personIds: [ids.huy], fromMonth: "2026-01", toMonth: "2026-12" })).toEqual([]);
    expect(await loadedCostRates(people.owner.principal, { personIds: [ids.huy], fromMonth: "2026-01", toMonth: "2026-12" })).toEqual([{ personId: ids.huy, month: "2026-09", ratePerHourVnd: 125_000 }]);
  });
});

describe("KPI actuals proposed from work (FR-PJM-62)", () => {
  it("proposes last month's on-time rate on the 1st–3rd, once", async () => {
    const kpi = (await saveKpi(null, { code: "ON_TIME", name: "Đúng hạn", description: null, unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true, workMetric: "on_time_rate" })).after;
    const assignment = await createAssignment(ids.long, { personId: ids.huy, kpiId: kpi.id, weight: 1, target: "90", fromPeriod: "2026-01", toPeriod: null });
    expect(await runKpiFromWork("2026-10-04")).toEqual({ skipped: "not_proposal_day" });
    expect(await runKpiFromWork("2026-10-02")).toMatchObject({ month: "2026-09", waiting: 1, proposed: 1 });
    const [row] = await db().select().from(schema.kpiActual).where(eq(schema.kpiActual.assignmentId, assignment.id));
    // Two of Huy's three dated tasks on time: 66.67 %.
    expect(row).toMatchObject({ periodKey: "2026-09", status: "proposed", source: "work", actualValue: 6667 });
    expect(await runKpiFromWork("2026-10-03")).toMatchObject({ waiting: 0, proposed: 0 });
  });
});
