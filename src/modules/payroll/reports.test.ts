// The payroll reports against a real database (PGlite): the figures add up to the runs behind
// them, and — the part that matters most — **the scoping holds in the query**. A viewer sees the
// entities their grant covers and nothing else, and the reports that name people are refused to
// everyone but C&B and the owner, including the CEO and the chief accountant who carry the run.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
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
}));
vi.mock("@/modules/platform/notifications/service", () => ({ notify: async () => undefined }));

import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { costReport, costTrend, insuranceSummary, payrollRegister, pitSummary, reportOptions, seesNamedReports, unionReport } from "./reports";
import { calculateRun, createRegularRun } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"media" | "creative" | "actor" | "mediaPerson" | "mediaSimple" | "creativePerson", string>;

const summary = () => ({
  days: 31, standardDays: 22, standardMinutes: 10_560, workedMinutes: 10_560, creditedMinutes: 0,
  leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
  lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0,
  otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 2200, unpaidDaysCenti: 0, anomalyDays: 0,
});

const grantee = (role: "hr_admin" | "payroll" | "c_level" | "finance" | "auditor" | "department_head" | "hr_staff" | "entity_director", entityId: string): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants: [{ role, scope: { type: "entity", id: entityId } }] });
const owner = (): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] });
const nobody = (): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants: [] });

beforeAll(async () => {
  await migrateTestDb();
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [creative] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative", wageRegion: 1 }).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [social] = await db().insert(schema.department).values({ code: "SOC", name: "Social" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.media = media.id;
  ids.creative = creative.id;
  ids.actor = actor.id;

  const hire = async (name: string, entityId: string, departmentId: string) => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId, employeeCode: null, startDate: "2025-01-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, departmentId, teamId: null, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.mediaPerson = await hire("Ho Gia Huy", media.id, video.id);
  ids.mediaSimple = await hire("Tran Thi Lan", media.id, video.id);
  ids.creativePerson = await hire("Dang Van Long", creative.id, social.id);

  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  // The group policy has no union; Media switches it on, so the union report has something in it.
  await db().insert(schema.payrollPolicy).values([
    { entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" as const },
    { entityId: media.id, value: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true }, validFrom: "2026-01-01", status: "approved" as const },
  ]);

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([
      { personId: ids.mediaPerson, employmentId: employmentOf(ids.mediaPerson), entityId: media.id, profile: "statutory" as const, validFrom: "2025-01-01", status: "approved" as const, unionMember: true },
      { personId: ids.mediaSimple, employmentId: employmentOf(ids.mediaSimple), entityId: media.id, profile: "simple" as const, simpleBasis: "service_contract" as const, validFrom: "2025-01-01", status: "approved" as const },
      { personId: ids.creativePerson, employmentId: employmentOf(ids.creativePerson), entityId: creative.id, profile: "statutory" as const, validFrom: "2025-01-01", status: "approved" as const },
    ]);

  for (const [personId, entityId, amount] of [
    [ids.mediaPerson, media.id, 30_000_000],
    [ids.mediaSimple, media.id, 15_000_000],
    [ids.creativePerson, creative.id, 24_000_000],
  ] as const) {
    const id = crypto.randomUUID();
    await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employmentOf(personId), entityId, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: amount, insuranceSalary: amount, allowances: [] }), salaryTermsContext(id)) });
  }

  // Two months for Media (so the trend has a shape), one for Creative.
  const lock = async (entityId: string, month: string, people: string[]) => {
    const lockedAt = new Date(`${month}-28T03:00:00Z`);
    await db().insert(schema.timesheetPeriod).values({ entityId, month, status: "locked", lockedAt, lockedByPersonId: actor.id });
    await db().insert(schema.timesheetMonth).values(people.map((personId) => ({ personId, entityId, month, status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: actor.id })));
    const run = await createRegularRun({ entityId, month }, actor.id);
    await calculateRun(run.id);
  };
  await lock(media.id, "2026-07", [ids.mediaPerson, ids.mediaSimple]);
  await lock(media.id, "2026-08", [ids.mediaPerson, ids.mediaSimple]);
  await lock(creative.id, "2026-08", [ids.creativePerson]);
});

describe("the register (FR-PAY-34)", () => {
  it("names each person once and totals to the run behind it", async () => {
    const register = (await payrollRegister(owner(), ids.media, "2026-08"))!;
    expect(register.lines.map((line) => line.fullName).sort()).toEqual(["Ho Gia Huy", "Tran Thi Lan"]);
    expect(register.lines.reduce((sum, line) => sum + line.net, 0)).toBe(register.totals.net);
    expect(register.lines.reduce((sum, line) => sum + line.gross, 0)).toBe(register.totals.grossEarnings);
    // The department comes off the person, so the cost report and the register agree.
    expect(register.lines.every((line) => line.departmentName === "Video")).toBe(true);
  });

  it("is refused to everyone but C&B and the owner", async () => {
    expect(await payrollRegister(grantee("payroll", ids.media), ids.media, "2026-08")).not.toBeNull();
    expect(await payrollRegister(grantee("hr_admin", ids.media), ids.media, "2026-08")).not.toBeNull();
    for (const [who, principal] of [
      // These carry the run forward on totals; they never see it person by person.
      ["the CEO", grantee("c_level", ids.media)],
      ["the chief accountant", grantee("finance", ids.media)],
      ["an auditor", grantee("auditor", ids.media)],
      ["a department head", grantee("department_head", ids.media)],
      ["HR staff", grantee("hr_staff", ids.media)],
      ["an entity director", grantee("entity_director", ids.media)],
      ["nobody in particular", nobody()],
      // C&B of the other entity: the permission is held over an entity.
      ["the other entity's C&B", grantee("payroll", ids.creative)],
    ] as const) {
      expect(await payrollRegister(principal, ids.media, "2026-08"), `${who} must not read the register`).toBeNull();
    }
  });

  it("answers null for a month with no run, like a month out of reach", async () => {
    expect(await payrollRegister(owner(), ids.media, "2026-12")).toBeNull();
    expect(await payrollRegister(grantee("payroll", ids.creative), ids.media, "2026-08")).toBeNull();
  });
});

describe("the entity scoping holds in the query, not in the page", () => {
  it("gives a single-entity grant only its own entity's cost", async () => {
    const mediaOnly = await costReport(grantee("finance", ids.media), { month: "2026-08" });
    expect(mediaOnly.byEntity.map((row) => row.label)).toEqual(["Media"]);
    // Creative's person is in neither the headcount nor the cost.
    expect(mediaOnly.total.headcount).toBe(2);

    const both = await costReport(owner(), { month: "2026-08" });
    expect(both.byEntity.map((row) => row.label).sort()).toEqual(["Creative", "Media"]);
    expect(both.total.headcount).toBe(3);
  });

  it("gives a viewer with no payroll permission an empty report rather than a refusal", async () => {
    const empty = await costReport(nobody(), { month: "2026-08" });
    expect(empty.byEntity).toEqual([]);
    expect(empty.total.employerCost).toBe(0);
    expect(await costTrend(nobody(), {})).toEqual([]);
    expect(await reportOptions(nobody())).toEqual({ entities: [], months: [] });
    expect((await unionReport(nobody(), { month: "2026-08" })).rows).toEqual([]);
  });

  it("offers only the entities and months the viewer may read", async () => {
    const forMedia = await reportOptions(grantee("payroll", ids.media));
    expect(forMedia.entities.map((entity) => entity.code)).toEqual(["SZM"]);
    expect(forMedia.months.sort()).toEqual(["2026-07", "2026-08"]);

    const forCreative = await reportOptions(grantee("payroll", ids.creative));
    expect(forCreative.entities.map((entity) => entity.code)).toEqual(["SZC"]);
    expect(forCreative.months).toEqual(["2026-08"]);
  });

  it("says who may see the reports that name people", () => {
    expect(seesNamedReports(owner())).toBe(true);
    expect(seesNamedReports(grantee("payroll", ids.media))).toBe(true);
    expect(seesNamedReports(grantee("finance", ids.media))).toBe(false);
    expect(seesNamedReports(grantee("c_level", ids.media))).toBe(false);
    expect(seesNamedReports(nobody())).toBe(false);
  });
});

describe("the statutory summaries", () => {
  it("lists everyone's contribution and adds up to the run", async () => {
    const insurance = (await insuranceSummary(owner(), ids.media, "2026-08"))!;
    expect(insurance.lines).toHaveLength(2);
    // The Simple-profile person is listed, and the reason they contribute nothing is on the line.
    const simple = insurance.lines.find((line) => line.fullName === "Tran Thi Lan")!;
    expect(simple.covered).toBe(false);
    expect(simple.reason).toBe("simple_profile");
    expect(insurance.notCovered).toBe(1);

    const register = (await payrollRegister(owner(), ids.media, "2026-08"))!;
    expect(insurance.totals.employee).toBe(register.totals.employeeInsurance);
    expect(insurance.totals.employer).toBe(register.totals.employerInsurance);
  });

  it("summarises the tax withheld, by method, and counts who has no tax code", async () => {
    const pit = (await pitSummary(owner(), ids.media, "2026-08"))!;
    expect(pit.lines).toHaveLength(2);
    const register = (await payrollRegister(owner(), ids.media, "2026-08"))!;
    expect(pit.totals.tax).toBe(register.totals.pit);
    expect(pit.byMethod.reduce((count, row) => count + row.people, 0)).toBe(2);
    // Nobody in this fixture has a tax code on file, so anyone actually taxed is flagged.
    expect(pit.missingTaxCodes).toBe(pit.lines.filter((line) => line.tax > 0).length);
  });

  it("keeps both summaries away from everyone but C&B and the owner", async () => {
    for (const principal of [grantee("c_level", ids.media), grantee("finance", ids.media), grantee("auditor", ids.media), grantee("department_head", ids.media)]) {
      expect(await insuranceSummary(principal, ids.media, "2026-08")).toBeNull();
      expect(await pitSummary(principal, ids.media, "2026-08")).toBeNull();
    }
  });

  it("reports the union only where the entity has one", async () => {
    const media = await unionReport(owner(), { entityId: ids.media, month: "2026-08" });
    expect(media.total.dues).toBeGreaterThan(0);
    expect(media.total.fund).toBeGreaterThan(0);
    // Creative's policy has no union, so its report is empty of money.
    const creative = await unionReport(owner(), { entityId: ids.creative, month: "2026-08" });
    expect(creative.total.dues).toBe(0);
    expect(creative.total.fund).toBe(0);
  });
});

describe("the trend (FR-PAY-34)", () => {
  it("walks the months in order, per the viewer's reach", async () => {
    const trend = await costTrend(grantee("payroll", ids.media), { entityId: ids.media });
    expect(trend.map((point) => point.month)).toEqual(["2026-07", "2026-08"]);
    expect(trend.every((point) => point.headcount === 2)).toBe(true);
    expect(trend.every((point) => point.employerCost > point.net)).toBe(true);
  });

  it("holds the range it is given", async () => {
    expect((await costTrend(owner(), { entityId: ids.media, fromMonth: "2026-08" })).map((point) => point.month)).toEqual(["2026-08"]);
    expect(await costTrend(owner(), { entityId: ids.media, fromMonth: "2027-01" })).toEqual([]);
  });
});
