// Scheduled reports (FR-RPT-05). The one rule worth a database test: **a report is built for each
// recipient with that recipient's own permissions**, every time it runs. A schedule is not a way to
// hand somebody a report they may not read.
//
// So each case below pairs a recipient who should get the report with one who should not, and then
// asserts on the run record and on the email outbox — the two places the answer actually shows up.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", EMAIL_FROM: "SuZu One <no-reply@suzu.one>", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
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
vi.mock("@/modules/platform/notifications/service", () => ({
  notify: async () => undefined,
  // The real one inserts into `email_outbox` and then tries to deliver; here we only want the row.
  queueRawEmail: async (to: string, subject: string, bodyText: string) => {
    sent.push({ to, subject, bodyText });
  },
}));

const sent: { to: string; subject: string; bodyText: string }[] = [];

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { buildReportFor, isSchedulable, listReportsFor, needsStepUp, REPORT_KEYS } from "./catalogue";
import { createSchedule, runDueSchedules, runSchedule } from "./schedules";

type Who = "hr" | "head" | "huy";
const ids = {} as Record<Who | "entity" | "actor", string>;
const users = {} as Record<Who, { person: typeof schema.person.$inferSelect; principal: Principal }>;

const TODAY = "2027-03-10";
const PERIOD = { from: "2027-02-01", to: "2027-02-28" };

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const grants: Record<Who, Principal["grants"]> = {
    // hr_admin holds `report:read` and `payroll:read`.
    hr: [{ role: "hr_admin", scope: { type: "entity", id: entity.id } }],
    // A department head holds `report:read` over their department and no payroll permission at all.
    head: [{ role: "department_head", scope: { type: "unit", id: department.id } }],
    huy: [],
  };

  const hire = async (who: Who, name: string) => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replaceAll(" ", ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId: entity.id,
        employeeCode: null,
        startDate: "2024-01-01",
        seniorityDate: null,
        placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null },
      },
      actor.id,
      { onboarding: false },
    );
    ids[who] = person.id;
    users[who] = { person, principal: { personId: person.id, workforceType: "employee", grants: grants[who] } };
  };

  await hire("hr", "Pham Gia Bao");
  await hire("head", "Dang Hoang Long");
  await hire("huy", "Ho Gia Huy");

  // The same grants as real rows. This is not duplication for its own sake: a *request* carries the
  // principal the session built, but the **job has no session** — `runSchedule` loads each
  // recipient's grants from the database for itself, which is the whole point of building the
  // report as the recipient. Both paths have to be exercised for the test to mean anything.
  await db()
    .insert(schema.roleAssignment)
    .values([
      { personId: ids.hr, role: "hr_admin", scopeType: "entity" as const, scopeId: ids.entity, validFrom: "2024-01-01" },
      { personId: ids.head, role: "department_head", scopeType: "unit" as const, scopeId: department.id, validFrom: "2024-01-01" },
    ]);
});

describe("the catalogue", () => {
  it("offers a report only to somebody who may read it", async () => {
    const forHr = (await listReportsFor(users.hr)).map((report) => report.key);
    const forHead = (await listReportsFor(users.head)).map((report) => report.key);
    const forHuy = (await listReportsFor(users.huy)).map((report) => report.key);

    expect(forHr).toContain("headcount");
    expect(forHr).toContain("payroll_cost");
    // The department head holds `report:read`, so headcount yes — payroll never.
    expect(forHead).toContain("headcount");
    expect(forHead).not.toContain("payroll_cost");
    // A person with no role at all: only the report whose scope is membership, not permission.
    expect(forHuy).toEqual(["work_analytics"]);
  });

  it("keeps the payroll cost report off the schedulable list even for somebody who may read it", async () => {
    expect(isSchedulable("payroll_cost")).toBe(false);
    expect((await listReportsFor(users.hr, { forScheduling: true })).map((report) => report.key)).not.toContain("payroll_cost");
    // …while the same person may still export it on demand.
    expect(await buildReportFor(users.hr, "payroll_cost", {}, PERIOD, "vi")).not.toBeNull();
  });

  it("answers null rather than an empty table when the reader may not see the report", async () => {
    expect(await buildReportFor(users.head, "payroll_cost", {}, PERIOD, "vi")).toBeNull();
    expect(await buildReportFor(users.huy, "headcount", {}, PERIOD, "vi")).toBeNull();
    expect(await buildReportFor(users.hr, "headcount", {}, PERIOD, "vi")).not.toBeNull();
  });

  it("refuses a report key that does not exist", async () => {
    expect(await buildReportFor(users.hr, "salaries_of_everyone", {}, PERIOD, "vi")).toBeNull();
  });

  it("asks for a fresh proof of identity for the compensation report and for nothing else", () => {
    // An export must not become the quiet way past step-up (FR-PLT-06); `exportReportAction` asks
    // this before it builds anything.
    expect(needsStepUp("payroll_cost")).toBe(true);
    expect(REPORT_KEYS.filter((key) => needsStepUp(key))).toEqual(["payroll_cost"]);
  });
});

describe("creating a schedule", () => {
  it("refuses a report the creator may not read", async () => {
    await expect(
      createSchedule(users.huy, { reportKey: "headcount", name: "Nope", parameters: {}, cadence: "daily", dayOfWeek: null, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.huy] }, TODAY),
    ).rejects.toThrow("forbidden");
  });

  it("refuses a report that may never be emailed", async () => {
    await expect(
      createSchedule(users.hr, { reportKey: "payroll_cost", name: "Nope", parameters: {}, cadence: "daily", dayOfWeek: null, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.hr] }, TODAY),
    ).rejects.toThrow("unknown_report");
  });

  it("sets the first run date from the cadence", async () => {
    const schedule = await createSchedule(
      users.hr,
      { reportKey: "headcount", name: "Quân số hằng tuần", parameters: {}, cadence: "weekly", dayOfWeek: 1, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.hr] },
      "2027-03-10", // a Wednesday
    );
    expect(schedule.nextRunOn).toBe("2027-03-15"); // the following Monday
    expect(schedule.isActive).toBe(true);
  });
});

describe("running a schedule", () => {
  it("builds the report for each recipient separately and withholds it from the one who may not read it", async () => {
    sent.length = 0;
    const schedule = await createSchedule(
      users.hr,
      { reportKey: "headcount", name: "Quân số", parameters: {}, cadence: "monthly", dayOfWeek: null, dayOfMonth: 1, locale: "vi", recipientPersonIds: [ids.hr, ids.head, ids.huy] },
      TODAY,
    );
    const run = await runSchedule(schedule, "2027-03-01");

    // HR and the department head both hold `report:read`; Huy holds nothing.
    expect(run.delivered).toBe(2);
    expect(run.withheld).toBe(1);
    expect(run.status).toBe("partial");
    expect(run.outcomes.find((outcome) => outcome.personId === ids.huy)?.outcome).toBe("not_permitted");
    expect(run.outcomes.find((outcome) => outcome.personId === ids.hr)?.outcome).toBe("delivered");

    // And the withholding is not merely "not sent": nothing about the report reached Huy at all.
    expect(sent.map((email) => email.to).sort()).toEqual(["dang.hoang.long@suzu.group", "pham.gia.bao@suzu.group"]);
    expect(sent.every((email) => !email.to.includes("huy"))).toBe(true);
  });

  it("covers the previous whole month and says so in the email", async () => {
    sent.length = 0;
    const schedule = await createSchedule(users.hr, { reportKey: "headcount", name: "Quân số tháng", parameters: {}, cadence: "monthly", dayOfWeek: null, dayOfMonth: 1, locale: "vi", recipientPersonIds: [ids.hr] }, TODAY);
    await runSchedule(schedule, "2027-03-01");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("2027-02-01 → 2027-02-28");
    expect(sent[0].bodyText).toContain("https://suzu.one/reports/headcount");
  });

  it("moves the schedule on, so the same day never sends twice", async () => {
    const schedule = await createSchedule(users.hr, { reportKey: "headcount", name: "Hằng ngày", parameters: {}, cadence: "daily", dayOfWeek: null, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.hr] }, TODAY);
    await runSchedule(schedule, TODAY);
    const [after] = await db().select().from(schema.reportSchedule).where(eq(schema.reportSchedule.id, schedule.id));
    expect(after.lastRunOn).toBe(TODAY);
    expect(after.nextRunOn).toBe("2027-03-11");

    // The job, run twice on the same day, does the work once.
    sent.length = 0;
    const first = await runDueSchedules("2027-03-11");
    const second = await runDueSchedules("2027-03-11");
    expect(first.schedules).toBeGreaterThan(0);
    expect(second.schedules).toBe(0);
  });

  it("skips a paused schedule", async () => {
    const schedule = await createSchedule(users.hr, { reportKey: "headcount", name: "Tạm dừng", parameters: {}, cadence: "daily", dayOfWeek: null, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.hr] }, "2027-04-01");
    await db().update(schema.reportSchedule).set({ isActive: false }).where(eq(schema.reportSchedule.id, schedule.id));
    const before = await db().select().from(schema.reportScheduleRun).where(eq(schema.reportScheduleRun.scheduleId, schedule.id));
    await runDueSchedules("2027-04-01");
    const after = await db().select().from(schema.reportScheduleRun).where(eq(schema.reportScheduleRun.scheduleId, schedule.id));
    expect(after.length).toBe(before.length);
  });

  it("withholds from somebody who has left the company", async () => {
    sent.length = 0;
    const schedule = await createSchedule(users.hr, { reportKey: "headcount", name: "Đã nghỉ", parameters: {}, cadence: "daily", dayOfWeek: null, dayOfMonth: null, locale: "vi", recipientPersonIds: [ids.head] }, "2027-05-01");
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, ids.head));
    const run = await runSchedule(schedule, "2027-05-01");
    expect(run.delivered).toBe(0);
    expect(run.outcomes[0].outcome).toBe("not_permitted");
    expect(sent).toHaveLength(0);
    await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, ids.head));
  });
});
