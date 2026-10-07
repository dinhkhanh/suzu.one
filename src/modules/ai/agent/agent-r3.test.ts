// Phase 13 R3 against a real Postgres (PGlite): HR, money, the salary estimate and the report
// catalogue (FR-AGT-15…18), and pay under D36 — read only by an asker the payroll module opens it to,
// only on a fresh step-up, and not stored.
//
// The cast: two entities (Media, Creative) and two units (Video, Social). Huy and Lan work in Media's
// Video unit, Long in Creative's Social unit; payroll ran for August in both entities. Ha is the
// owner; Cúc is C&B (payroll) of Media; Tài is the chief accountant (finance) of the group; Dũng
// heads the Video department; Huy and Long hold no role.
//
// The last block is the outbound-request capture test of the plan: every persona, every tool they
// are offered, with a stale and a fresh step-up — and what was sent to the model is searched for a
// contact detail and for every pay figure the persona may not read.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", EMBEDDINGS_MODEL: "@cf/baai/bge-m3", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
  isDevelopmentEnvironment: () => true,
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
vi.mock("@/modules/platform/notifications/service", () => ({ notify: async () => undefined }));

import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { DEFAULT_PAYROLL_POLICY } from "@/modules/payroll/enums";
import { salaryTermsContext } from "@/modules/payroll/field-contexts";
import { stepRun } from "@/modules/payroll/lifecycle";
import { costTrend } from "@/modules/payroll/reports";
import { calculateRun, createRegularRun } from "@/modules/payroll/runs";
import { payComponentSeedRows } from "@/modules/payroll/seed-components";
import type { Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { APPROVER_KINDS } from "../engine/routing";
import { scriptedDriver } from "./driver";
import { askerFactsOf } from "./facts";
import { runAgentTurn } from "./loop";
import { type AgentUser, type AnyAgentTool, runAgentTool, toolsFor } from "./registry";
import { AGENT_TOOLS } from "./tools";

const TODAY = "2026-10-07";
const STALE = new Date(Date.now() - 24 * 3_600_000);
type Who = "ha" | "cuc" | "tai" | "dung" | "huy" | "long";
const ids = {} as Record<Who | "lan" | "media" | "creative" | "video" | "social" | "actor", string>;
const principals = {} as Record<Who, Principal>;
const NAMES: Record<Who, string> = { ha: "Nguyen Thu Ha", cuc: "Phan Thi Cuc", tai: "Vu Minh Tai", dung: "Tran Van Dung", huy: "Ho Gia Huy", long: "Dang Van Long" };
const HUY_PHONE = "0912 345 678";
const HUY_PRIVATE_EMAIL = "huy.rieng@gmail.com";
const HUY_BASE = 30_000_000;

const tool = (name: string): AnyAgentTool => AGENT_TOOLS.find((candidate) => candidate.name === name)!;
const userOf = (who: Who, fresh = true): AgentUser => ({ ...users[who], reauthAt: fresh ? new Date() : STALE });
const users = {} as Record<Who, AgentUser>;
const run = (who: Who, name: string, input: unknown = {}, fresh = true) => runAgentTool(tool(name), { user: userOf(who, fresh), today: TODAY, locale: "vi" }, input);
const offered = async (who: Who) => toolsFor(AGENT_TOOLS, principals[who], await askerFactsOf(users[who])).map((candidate) => candidate.name);
const text = (value: unknown) => JSON.stringify(value);
/** A figure as it would be written in JSON, not as part of a longer number. */
const holds = (haystack: string, figure: number) => new RegExp(`(?<!\\d)${figure}(?!\\d)`, "u").test(haystack);

const summary = () => ({
  days: 31, standardDays: 22, standardMinutes: 10_560, workedMinutes: 10_560, creditedMinutes: 0,
  leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
  lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0,
  otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 2200, unpaidDaysCenti: 0, anomalyDays: 0,
});

/** The August figures of each entity's run, as the owner reads them: what nobody else may be sent. */
const figures = { media: [] as number[], creative: [] as number[] };

beforeAll(async () => {
  await migrateTestDb();
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [creative] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative", wageRegion: 1 }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [social] = await db().insert(schema.orgUnit).values({ code: "SOC", name: "Social" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, social: social.id, actor: actor.id });

  const hire = async (name: string, entityId: string, orgUnitId: string, contact: { phone: string | null; personalEmail: string | null } = { phone: null, personalEmail: null }) => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: contact.phone, personalEmail: contact.personalEmail, permanentAddress: null, currentAddress: null }, entityId, employeeCode: null, startDate: "2025-01-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.huy = await hire(NAMES.huy, media.id, video.id, { phone: HUY_PHONE, personalEmail: HUY_PRIVATE_EMAIL });
  ids.lan = await hire("Tran Thi Lan", media.id, video.id);
  ids.long = await hire(NAMES.long, creative.id, social.id);
  // The personas who hold roles are people in the directory, not on any payroll here.
  for (const who of ["ha", "cuc", "tai", "dung"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: NAMES[who], searchName: NAMES[who].toLowerCase(), workEmail: `${who}@suzu.group`, status: "active", primaryEntityId: media.id, orgUnitId: video.id }).returning();
    ids[who] = row.id;
  }
  const grants: Record<Who, Principal["grants"]> = {
    ha: [{ role: "owner", scope: { type: "group" } }],
    cuc: [{ role: "payroll", scope: { type: "entity", id: media.id } }],
    tai: [{ role: "finance", scope: { type: "group" } }],
    dung: [{ role: "department_head", scope: { type: "unit", id: video.id } }],
    huy: [],
    long: [],
  };
  const people = await db().select().from(schema.person);
  for (const who of Object.keys(NAMES) as Who[]) {
    const row = people.find((person) => person.id === ids[who])!;
    principals[who] = { personId: row.id, workforceType: "employee", grants: grants[who] };
    users[who] = { person: { id: row.id, primaryEntityId: row.primaryEntityId, orgUnitId: row.orgUnitId, orgUnitPath: row.orgUnitPath, fullName: row.fullName }, principal: principals[who], reauthAt: new Date() };
  }

  // Payroll: the law, the components, the policy, a profile and a salary for each of the three.
  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" as const });
  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  for (const [personId, entityId, amount] of [
    [ids.huy, media.id, HUY_BASE],
    [ids.lan, media.id, 15_000_000],
    [ids.long, creative.id, 24_000_000],
  ] as const) {
    await db().insert(schema.payProfile).values({ personId, employmentId: employmentOf(personId), entityId, profile: "statutory" as const, validFrom: "2025-01-01", status: "approved" as const });
    const id = crypto.randomUUID();
    await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employmentOf(personId), entityId, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: amount, insuranceSalary: amount, allowances: [] }), salaryTermsContext(id)) });
  }
  const lock = async (entityId: string, month: string, personIds: string[]) => {
    const lockedAt = new Date(`${month}-28T03:00:00Z`);
    await db().insert(schema.timesheetPeriod).values({ entityId, month, status: "locked", lockedAt, lockedByPersonId: actor.id });
    await db().insert(schema.timesheetMonth).values(personIds.map((personId) => ({ personId, entityId, month, status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: actor.id })));
    const created = await createRegularRun({ entityId, month }, actor.id);
    await calculateRun(created.id);
    for (const step of ["propose", "approve"] as const) await stepRun(created.id, step, { personId: actor.id });
  };
  await lock(media.id, "2026-08", [ids.huy, ids.lan]);
  await lock(creative.id, "2026-08", [ids.long]);
  const owner: Principal = { personId: null, workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] } as unknown as Principal;
  for (const [key, entityId] of [["media", media.id], ["creative", creative.id]] as const) {
    const [point] = await costTrend(owner, { entityId, fromMonth: "2026-08", toMonth: "2026-08" });
    figures[key] = [point.gross, point.net, point.employerCost];
  }

  // Lan is on probation until 1 November; Huy took a day of annual leave on 2 October.
  await db().insert(schema.contract).values({ employmentId: employmentOf(ids.lan), personId: ids.lan, entityId: media.id, number: "TV-01", type: "probation", startDate: "2026-09-01", endDate: "2026-11-01" });
  const [annual] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.huy, entityId: media.id, leaveTypeId: annual.id, startDate: "2026-10-02", endDate: "2026-10-02", totalCenti: 100, status: "approved" }).returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: request.id, personId: ids.huy, date: "2026-10-02", portion: "full", amountCenti: 100 });
}, 180_000);

describe("what each asker is offered (FR-AGT-15…18)", () => {
  const R3 = ["headcount", "contracts_ending", "recruitment", "leave_by_unit", "payroll_cost", "profitability", "receivables", "sales_pipeline", "company_health", "salary_estimate", "run_report"];

  it("offers an employee with no role none of them", async () => {
    for (const who of ["huy", "long"] as const) {
      const names = await offered(who);
      for (const name of R3) expect(names, `${who}: ${name}`).not.toContain(name);
    }
  });

  it("offers each office its own: HR figures to a department head, pay to C&B and finance, the salary calculator to C&B alone", async () => {
    const dung = await offered("dung");
    expect(dung).toEqual(expect.arrayContaining(["headcount", "contracts_ending", "leave_by_unit", "run_report"]));
    for (const name of ["payroll_cost", "profitability", "salary_estimate"]) expect(dung).not.toContain(name);
    expect(await offered("cuc")).toEqual(expect.arrayContaining(["payroll_cost", "salary_estimate"]));
    const tai = await offered("tai");
    expect(tai).toEqual(expect.arrayContaining(["payroll_cost", "profitability", "receivables"]));
    expect(tai).not.toContain("salary_estimate");
  });
});

describe("HR (FR-AGT-15)", () => {
  it("counts the whole group for the owner and the department for its head", async () => {
    const all = await run("ha", "headcount");
    expect(all.outcome).toBe("answered");
    expect(all.model).toMatchObject({ total: 3, scope: "the whole group" });
    const video = await run("dung", "headcount");
    expect(video.model).toMatchObject({ total: 2, scope: "the asker's part of the company" });
  });

  it("refuses headcount to a person with no reporting reach", async () => {
    expect((await run("huy", "headcount")).outcome).toBe("refused");
  });

  it("lists a probation ending within the window, and only within the reader's scope", async () => {
    const owner = await run("ha", "contracts_ending", { kind: "probations" });
    expect(text(owner.model)).toContain("Tran Thi Lan");
    expect(text(owner.model)).toContain("2026-11-01");
    const tooSoon = await run("ha", "contracts_ending", { kind: "probations", withinDays: 7 });
    expect(tooSoon.outcome).toBe("empty");
    const socialHead: AgentUser = { ...users.dung, principal: { ...principals.dung, grants: [{ role: "department_head", scope: { type: "unit", id: ids.social } }] } };
    const other = await runAgentTool(tool("contracts_ending"), { user: socialHead, today: TODAY, locale: "vi" }, {});
    expect(text(other.model)).not.toContain("Tran Thi Lan");
  });

  it("sums leave taken per unit over the people the asker's calendar shows — no names, no leave types", async () => {
    const owner = await run("ha", "leave_by_unit");
    expect(owner.model).toMatchObject({ totalDays: 1, rows: [{ department: "Video", people: 1, days: 1 }] });
    expect(text(owner.model)).not.toContain(NAMES.huy);
    expect(text(owner.model)).not.toContain("Annual");
    // Long's calendar is his own unit: Video's leave is not his to count.
    expect((await run("long", "leave_by_unit")).outcome).toBe("empty");
  });
});

describe("money and pay (FR-AGT-16, 17, D36)", () => {
  it("asks for a step-up before payroll cost, and reads nothing before it", async () => {
    const stale = await run("cuc", "payroll_cost", {}, false);
    expect(stale.outcome).toBe("step_up");
    for (const figure of figures.media) expect(holds(text(stale), figure)).toBe(false);
  });

  it("gives C&B of Media their entity's cost, and not Creative's", async () => {
    const result = await run("cuc", "payroll_cost");
    expect(result.outcome).toBe("answered");
    const seen = text(result.model);
    expect(figures.media.some((figure) => holds(seen, figure))).toBe(true);
    for (const figure of figures.creative) expect(holds(seen, figure), `Creative ${figure}`).toBe(false);
    // The card names the screen; it carries no figure, because cards are stored.
    for (const figure of figures.media) expect(holds(text(result.card), figure)).toBe(false);
  });

  it("estimates a person's month from their salary file for C&B over their entity — the same net as the calculator gives for that gross", async () => {
    const estimate = await run("cuc", "salary_estimate", { mode: "person", person: NAMES.huy, month: "2026-11" });
    expect(estimate.outcome).toBe("answered");
    expect(estimate.model).toMatchObject({ grossBaseVnd: HUY_BASE, dependants: 0 });
    const calculator = await run("cuc", "salary_estimate", { mode: "gross_to_net", amountVnd: HUY_BASE, month: "2026-11" });
    expect(calculator.model.netVnd).toBe(estimate.model.netVnd);
    expect(estimate.model.netVnd).toBeLessThan(HUY_BASE);
    const back = await run("cuc", "salary_estimate", { mode: "net_to_gross", amountVnd: estimate.model.netVnd, month: "2026-11" });
    expect(back.model.grossBaseVnd).toBe(HUY_BASE);
  });

  it("refuses a salary file the payroll module does not open: another entity's, or to finance", async () => {
    expect((await run("cuc", "salary_estimate", { mode: "person", person: NAMES.long, month: "2026-11" })).outcome).toBe("refused");
    const finance = await run("tai", "salary_estimate", { mode: "person", person: NAMES.huy, month: "2026-11" });
    expect(finance.outcome).toBe("refused");
    expect(holds(text(finance), HUY_BASE)).toBe(false);
  });

  it("locks the dashboard's payroll tile without a step-up, and says the turn held pay only when it opens it", async () => {
    const stale = await run("ha", "company_health", {}, false);
    expect(stale.outcome).toBe("answered");
    expect(text(stale.model)).toContain("locked");
    expect(stale.compensation).toBe(false);
    const fresh = await run("ha", "company_health");
    expect(fresh.compensation).toBe(true);
    expect(figures.media.concat(figures.creative).some((figure) => holds(text(fresh.model), figure)) || text(fresh.model).includes("employerCostVnd")).toBe(true);
  });

  it("does not store a turn that read pay (D36), and stores one that read headcount", async () => {
    const pay = await runAgentTurn({ user: userOf("cuc"), question: "Chi phí lương tháng 8?", locale: "vi", today: TODAY, history: [], driver: scriptedDriver([{ tools: [{ name: "payroll_cost", input: {} }] }, { text: "Đây là chi phí lương." }]) });
    expect(pay.kind === "answered" && pay.compensation).toBe(true);
    const people = await runAgentTurn({ user: userOf("ha"), question: "Công ty có bao nhiêu người?", locale: "vi", today: TODAY, history: [], driver: scriptedDriver([{ tools: [{ name: "headcount", input: {} }] }, { text: "Ba người." }]) });
    expect(people.kind === "answered" && people.compensation).toBe(false);
  });
});

describe("the report catalogue (FR-AGT-18)", () => {
  it("asks for a step-up for a pay report only", async () => {
    expect((await run("ha", "run_report", { report: "payroll_cost" }, false)).outcome).toBe("step_up");
    expect((await run("ha", "run_report", { report: "headcount" }, false)).outcome).toBe("answered");
  });

  it("builds a report under its own canSee, and refuses one the asker may not read", async () => {
    const owner = await run("ha", "run_report", { report: "payroll_cost" });
    expect(owner.outcome).toBe("answered");
    expect(owner.compensation).toBe(true);
    expect((await run("dung", "run_report", { report: "payroll_cost" })).outcome).toBe("refused");
    const headcount = await run("dung", "run_report", { report: "headcount" });
    expect(headcount.compensation).toBe(false);
    expect(headcount.model).toMatchObject({ link: "/reports/headcount", report: "headcount" });
  });
});

describe("the outbound-request capture: what reaches a model, for every persona and every tool", () => {
  const SAMPLE: Record<string, unknown> = {
    search_handbook: { query: "nghỉ phép năm" },
    my_tasks: {},
    my_day: {},
    my_time: {},
    my_leave: {},
    my_attendance: {},
    my_requests: {},
    who_approves_my_request: { kind: APPROVER_KINDS[0] },
    my_payslip: {},
    my_unacknowledged_announcements: {},
    my_obligations: {},
    find_person: { name: "Huy" },
    find_project: { query: "TVC" },
    find_task: { query: "cut" },
    task_detail: { task: "VID-1" },
    project_status: { project: "TVC" },
    portfolio_health: {},
    team_board: {},
    team_workload: {},
    who_is_in: {},
    timesheets_to_approve: {},
    person_overview: { person: NAMES.huy },
    headcount: {},
    contracts_ending: {},
    recruitment: {},
    leave_by_unit: {},
    payroll_cost: {},
    profitability: {},
    receivables: {},
    sales_pipeline: {},
    company_health: {},
    salary_estimate: { mode: "person", person: NAMES.huy },
    run_report: { report: "payroll_cost" },
  };

  /** The pay figures each persona may be sent, on a fresh step-up. Stale: none. */
  const mayRead: Record<Who, { media: boolean; creative: boolean; huySalary: boolean }> = {
    ha: { media: true, creative: true, huySalary: true },
    cuc: { media: true, creative: false, huySalary: true },
    tai: { media: true, creative: true, huySalary: false },
    dung: { media: false, creative: false, huySalary: false },
    huy: { media: false, creative: false, huySalary: false },
    long: { media: false, creative: false, huySalary: false },
  };
  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/u;

  it("covers every tool in the registry", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(AGENT_TOOLS.map((candidate) => candidate.name).sort());
  });

  for (const who of Object.keys(NAMES) as Who[]) {
    for (const fresh of [false, true]) {
      it(`${who}, ${fresh ? "fresh" : "stale"} step-up: no contact detail, and pay only where it may be read`, async () => {
        const user = userOf(who, fresh);
        const names = toolsFor(AGENT_TOOLS, principals[who], await askerFactsOf(user)).map((candidate) => candidate.name);
        const sent: string[] = [];
        for (const name of names) {
          const driver = scriptedDriver([{ tools: [{ name, input: SAMPLE[name] }] }, { text: "…" }]);
          await runAgentTurn({ user, question: `Kiểm tra ${name}`, locale: "vi", today: TODAY, history: [], driver });
          sent.push(text(driver.calls));
        }
        const outbound = sent.join("\n");
        expect(outbound, "an email address").not.toMatch(EMAIL);
        expect(outbound).not.toContain(HUY_PHONE);
        expect(outbound).not.toContain(HUY_PHONE.replace(/\s/gu, ""));
        const allowed = fresh ? mayRead[who] : { media: false, creative: false, huySalary: false };
        if (!allowed.media) for (const figure of figures.media) expect(holds(outbound, figure), `Media pay ${figure}`).toBe(false);
        if (!allowed.creative) for (const figure of figures.creative) expect(holds(outbound, figure), `Creative pay ${figure}`).toBe(false);
        if (!allowed.huySalary) expect(holds(outbound, HUY_BASE), "Huy's salary").toBe(false);
        // The capture can see pay where it is allowed: the test is not passing on an empty wire.
        if (fresh && who === "ha") expect(figures.media.some((figure) => holds(outbound, figure))).toBe(true);
        if (fresh && who === "cuc") expect(holds(outbound, HUY_BASE)).toBe(true);
      }, 120_000);
    }
  }
});
