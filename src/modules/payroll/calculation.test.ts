// Assembling a real entity-month's inputs out of the database and calculating it (PGlite).
// The engine's own arithmetic is covered by the golden cases; what is tested here is the wiring:
// that a locked timesheet, a salary structure, a pay profile, the catalogue, the policy and the
// statutory snapshot reach the engine intact — and that payroll refuses to guess when one is missing.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
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

import { eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { buildSegments, calculateEntityMonth, calculateOnePerson, dayWeight, listPeopleWithoutProfile, monthsOfService } from "./calculation";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { payComponentSeedRows } from "./seed-components";

const MONTH = "2026-08";
const ids = {} as Record<"entity" | "actor" | "huy" | "mai" | "lan", string>;

/** A locked month for one person: the summary the timesheet lock froze. */
const summary = (overrides: Partial<Record<string, unknown>> = {}) => ({
  days: 31,
  standardDays: 22,
  standardMinutes: 10_560,
  workedMinutes: 10_560,
  creditedMinutes: 0,
  leavePaidMinutes: 0,
  leaveUnpaidMinutes: 0,
  holidayMinutes: 0,
  absenceMinutes: 0,
  lateMinutes: 0,
  earlyMinutes: 0,
  lateCount: 0,
  earlyCount: 0,
  missingPunchDays: 0,
  absentDays: 0,
  wfhMinutes: 0,
  tripMinutes: 0,
  nightMinutes: 0,
  otWeekday: { day: 0, night: 0 },
  otRestDay: { day: 0, night: 0 },
  otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0,
  otUnapprovedMinutes: 0,
  otTimeOffMinutes: 0,
  paidDaysCenti: 2200,
  unpaidDaysCenti: 0,
  anomalyDays: 0,
  ...overrides,
});

async function addStructure(personId: string, validFrom: string, baseSalary: number, validTo: string | null = null) {
  const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, personId)).limit(1);
  const id = crypto.randomUUID();
  const terms = { baseSalary, insuranceSalary: baseSalary, allowances: [{ code: "ALW_MEAL", amount: 730_000 }] };
  await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employment.id, entityId: ids.entity, validFrom, validTo, reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)) });
  return id;
}

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const hire = async (name: string, startDate: string) => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate, seniorityDate: null, placement: { workforceType: "employee", branchId: null, departmentId: department.id, teamId: null, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.huy = await hire("Ho Gia Huy", "2024-03-01");
  ids.mai = await hire("Le Thi Mai", "2026-08-17");
  ids.lan = await hire("Tran Thi Lan", "2025-06-01");

  // The rules: the seeded statutory values, the starter catalogue and the group pay policy.
  await db()
    .insert(schema.statutoryParameter)
    .values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  // Pay profiles: Huy and Mai on the Statutory profile, Lan as a Simple-profile collaborator.
  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([
      { personId: ids.huy, employmentId: employmentOf(ids.huy), entityId: entity.id, profile: "statutory", validFrom: "2024-03-01", status: "approved" },
      { personId: ids.mai, employmentId: employmentOf(ids.mai), entityId: entity.id, profile: "statutory", validFrom: "2026-08-17", status: "approved" },
      { personId: ids.lan, employmentId: employmentOf(ids.lan), entityId: entity.id, profile: "simple", simpleBasis: "service_contract", validFrom: "2025-06-01", status: "approved" },
    ]);

  await addStructure(ids.huy, "2024-03-01", 30_000_000);
  await addStructure(ids.mai, "2026-08-17", 18_000_000);
  await addStructure(ids.lan, "2025-06-01", 15_000_000);
});

/** The frozen daily rows of a full 8-hour working day, on the dates given. */
async function addDays(personId: string, dates: string[]) {
  await db()
    .insert(schema.timesheetDay)
    .values(dates.map((date) => ({ personId, entityId: ids.entity, date, planKind: "fixed", status: "present" as const, requiredMinutes: 480, workedMinutes: 480, inputsHash: `test:${date}`, lockedAt: new Date("2026-09-02T03:00:00Z") })));
}

const WORKING_DAYS = [...Array.from({ length: 12 }, (_, index) => `2026-08-${String(index + 3).padStart(2, "0")}`), ...Array.from({ length: 10 }, (_, index) => `2026-08-${String(index + 17).padStart(2, "0")}`)];

async function lockMonth(people: { personId: string; summary: Record<string, unknown> }[]) {
  const lockedAt = new Date("2026-09-02T03:00:00Z");
  await db().delete(schema.timesheetMonth);
  await db().delete(schema.timesheetPeriod);
  await db().insert(schema.timesheetPeriod).values({ entityId: ids.entity, month: MONTH, status: "locked", lockedAt, lockedByPersonId: ids.actor });
  await db().insert(schema.timesheetMonth).values(people.map((row) => ({ personId: row.personId, entityId: ids.entity, month: MONTH, status: "locked" as const, summary: row.summary, lockedAt, lockedByPersonId: ids.actor })));
}

describe("calculating an entity's month", () => {
  it("refuses while the timesheet is not locked (FR-PAY-10)", async () => {
    await expect(calculateEntityMonth(ids.entity, MONTH)).rejects.toThrow("timesheet_not_locked");
  });

  it("calculates everyone of the locked month and keeps what it was calculated from", async () => {
    await lockMonth([
      { personId: ids.huy, summary: summary() },
      { personId: ids.mai, summary: summary({ standardDays: 11, standardMinutes: 5280, workedMinutes: 5280, paidDaysCenti: 1100 }) },
      { personId: ids.lan, summary: summary() },
    ]);
    const { context, people } = await calculateEntityMonth(ids.entity, MONTH);

    expect(people).toHaveLength(3);
    expect(context).toMatchObject({ entityId: ids.entity, month: MONTH, engineVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    // Every statutory value used is named with the version it came from, so the run can be replayed.
    expect(Object.keys(context.parameterVersions)).toContain("pit.brackets");
    expect(context.componentVersionIds.length).toBeGreaterThan(20);
    // The seeded values are unverified until the chief accountant confirms them: a run must say so.
    expect(context.unverifiedParameters).toContain("pit.brackets");
  });

  it("pays a full month in full and a mid-month joiner in part, on the month's own divisor", async () => {
    const { people } = await calculateEntityMonth(ids.entity, MONTH);
    const huy = people.find((person) => person.input.personId === ids.huy)!;
    const mai = people.find((person) => person.input.personId === ids.mai)!;

    expect(huy.input.period.standardDays).toBe(22);
    expect(huy.result.lines.find((line) => line.code === "BASE")!.amount).toBe(30_000_000);
    // Mai's own month is 11 days, but the divisor is still the month's 22: 18,000,000 × 11/22.
    expect(mai.input.period.standardDays).toBe(22);
    expect(mai.result.lines.find((line) => line.code === "BASE")!.amount).toBe(9_000_000);
    // …and her insurance is the full month's, not half of it (FR-PAY-11).
    expect(mai.result.insurance).toMatchObject({ covered: true, bhxhBhytBase: 18_000_000 });
    expect(mai.result.totals.employeeInsurance).toBe(1_890_000); // 10.5% of 18,000,000
  });

  it("takes the pay profile from the database: the collaborator gets no insurance and no PIT", async () => {
    const { people } = await calculateEntityMonth(ids.entity, MONTH);
    const lan = people.find((person) => person.input.personId === ids.lan)!;
    expect(lan.result.profile).toBe("simple");
    expect(lan.result.insurance).toMatchObject({ covered: false, reason: "simple_profile" });
    expect(lan.result.pit.method).toBe("none");
    expect(lan.result.totals.net).toBe(lan.result.totals.grossEarnings);
  });

  it("calculates one person by the same path as the whole month", async () => {
    const one = await calculateOnePerson(ids.entity, MONTH, ids.huy);
    const all = await calculateEntityMonth(ids.entity, MONTH);
    expect(JSON.stringify(one!.result)).toBe(JSON.stringify(all.people.find((person) => person.input.personId === ids.huy)!.result));
    expect(await calculateOnePerson(ids.entity, MONTH, ids.actor)).toBeNull();
  });

  it("carries a figure typed into the run through to the net", async () => {
    const plain = await calculateOnePerson(ids.entity, MONTH, ids.huy);
    const withBonus = await calculateOnePerson(ids.entity, MONTH, ids.huy, { inputs: [{ code: "BONUS", amount: 10_000_000 }] });
    expect(withBonus!.result.totals.grossEarnings - plain!.result.totals.grossEarnings).toBe(10_000_000);
    expect(withBonus!.result.totals.pit).toBeGreaterThan(plain!.result.totals.pit);
  });

  it("reads the dependants registered for the month (FR-PAY-13)", async () => {
    const before = await calculateOnePerson(ids.entity, MONTH, ids.huy);
    await db().insert(schema.dependent).values({ personId: ids.huy, fullName: "Ho Gia Bao", relationship: "child", deductionFrom: "2026-01-01", deductionTo: null });
    const after = await calculateOnePerson(ids.entity, MONTH, ids.huy);
    expect(after!.input.employment.dependents).toBe(1);
    expect(after!.result.pit.dependentDeduction).toBe(6_200_000);
    expect(after!.result.totals.pit).toBeLessThan(before!.result.totals.pit);
    await db().delete(schema.dependent).where(eq(schema.dependent.personId, ids.huy));
  });

  it("refuses a person with no pay profile rather than paying them by guesswork", async () => {
    const [stranger] = await db().insert(schema.person).values({ fullName: "No Profile", searchName: "no profile", primaryEntityId: ids.entity, status: "active" }).returning();
    await db().insert(schema.timesheetMonth).values({ personId: stranger.id, entityId: ids.entity, month: MONTH, status: "locked", summary: summary(), lockedAt: new Date(), lockedByPersonId: ids.actor });
    expect(await listPeopleWithoutProfile(ids.entity, MONTH)).toContain("No Profile");
    await expect(calculateEntityMonth(ids.entity, MONTH)).rejects.toThrow("pay_profile_missing");
    await db().delete(schema.timesheetMonth).where(eq(schema.timesheetMonth.personId, stranger.id));
  });

  it("refuses when the entity has no pay policy in force", async () => {
    await db().update(schema.payrollPolicy).set({ validTo: "2026-01-31" });
    await expect(calculateEntityMonth(ids.entity, MONTH)).rejects.toThrow("payroll_policy_missing");
    await db().update(schema.payrollPolicy).set({ validTo: null });
  });

  it("refuses when a statutory value is missing for the period", async () => {
    await db().update(schema.statutoryParameter).set({ status: "proposed" }).where(eq(schema.statutoryParameter.key, "pit.brackets"));
    await expect(calculateEntityMonth(ids.entity, MONTH)).rejects.toThrow("statutory_parameter_missing");
    await db().update(schema.statutoryParameter).set({ status: "approved" }).where(eq(schema.statutoryParameter.key, "pit.brackets"));
  });

  it("splits the month at a salary change on the days actually worked either side", async () => {
    // Huy's frozen days: 12 working days before the raise takes effect on the 17th, 10 after.
    await addDays(ids.huy, WORKING_DAYS);
    await db().update(schema.salaryStructure).set({ validTo: "2026-08-16" }).where(eq(schema.salaryStructure.personId, ids.huy));
    await addStructure(ids.huy, "2026-08-17", 36_000_000);
    const raised = await calculateOnePerson(ids.entity, MONTH, ids.huy);

    expect(raised!.input.segments.map((segment) => [segment.from, segment.to, segment.paidDaysCenti])).toEqual([
      ["2026-08-01", "2026-08-16", 1200],
      ["2026-08-17", "2026-08-31", 1000],
    ]);
    // The pieces add back up to the locked month exactly — nothing is gained or lost in the split.
    expect(raised!.input.segments.reduce((sum, segment) => sum + segment.paidDaysCenti, 0)).toBe(2200);
    // 30,000,000 × 1200/2200 + 36,000,000 × 1000/2200 = 16,363,636 + 16,363,636 = 32,727,272.
    expect(raised!.result.lines.find((line) => line.code === "BASE")!.amount).toBe(32_727_272);
    // The contribution base follows the terms in force at the end of the period.
    expect(raised!.result.insurance.bhxhBhytBase).toBe(36_000_000);
  });
});

describe("splitting a month into segments", () => {
  const timesheet = { standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0 } as Parameters<typeof buildSegments>[1];
  type Structure = Parameters<typeof buildSegments>[0][number];
  type Day = NonNullable<Parameters<typeof buildSegments>[4]>[number];
  const structure = (validFrom: string, validTo: string | null, baseSalary: number) => ({ validFrom, validTo, terms: { baseSalary, insuranceSalary: baseSalary, allowances: [] } }) as unknown as Structure;

  it("gives one segment for a month with no change", () => {
    const segments = buildSegments([structure("2024-01-01", null, 30_000_000)], timesheet, "2026-08-01", "2026-08-31");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ from: "2026-08-01", to: "2026-08-31", paidDaysCenti: 2200 });
  });

  it("shares the month's paid days over the pieces without losing one", () => {
    const segments = buildSegments([structure("2024-01-01", "2026-08-16", 30_000_000), structure("2026-08-17", null, 36_000_000)], timesheet, "2026-08-01", "2026-08-31");
    expect(segments.map((segment) => [segment.from, segment.to])).toEqual([
      ["2026-08-01", "2026-08-16"],
      ["2026-08-17", "2026-08-31"],
    ]);
    expect(segments.reduce((sum, segment) => sum + segment.paidDaysCenti, 0)).toBe(2200);
    expect(segments.reduce((sum, segment) => sum + segment.standardDays, 0)).toBe(22);
  });

  it("uses the frozen days when there are any, rather than the share of the calendar", () => {
    const day = (date: string, worked = 480) => ({ date, requiredMinutes: 480, workedMinutes: worked, creditedMinutes: 0, leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 480 - worked }) as Day;
    const days = [day("2026-08-03"), day("2026-08-10"), day("2026-08-20"), day("2026-08-21", 240)];
    const segments = buildSegments([structure("2024-01-01", "2026-08-16", 30_000_000), structure("2026-08-17", null, 36_000_000)], { ...timesheet, standardDays: 4, paidDaysCenti: 350 }, "2026-08-01", "2026-08-31", days);
    // Two whole days before the change, one whole day and one half day after it.
    expect(segments.map((segment) => segment.paidDaysCenti)).toEqual([200, 150]);
    expect(segments.map((segment) => segment.standardDays)).toEqual([2, 2]);
  });

  it("counts one day the way the timesheet lock counted it", () => {
    const base = { requiredMinutes: 480, workedMinutes: 0, creditedMinutes: 0, leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0 } as Parameters<typeof dayWeight>[0];
    expect(dayWeight({ ...base, workedMinutes: 480 })).toEqual({ standardDays: 1, paidDaysCenti: 100, unpaidDaysCenti: 0 });
    expect(dayWeight({ ...base, workedMinutes: 240, leaveUnpaidMinutes: 240 })).toEqual({ standardDays: 1, paidDaysCenti: 50, unpaidDaysCenti: 50 });
    // A day the month never asked for (a rest day) weighs nothing, however much was worked on it.
    expect(dayWeight({ ...base, requiredMinutes: 0, workedMinutes: 480 })).toEqual({ standardDays: 0, paidDaysCenti: 0, unpaidDaysCenti: 0 });
    // A paid holiday is a day the month asked for and paid in full.
    expect(dayWeight({ ...base, requiredMinutes: 0, holidayMinutes: 480 })).toEqual({ standardDays: 1, paidDaysCenti: 100, unpaidDaysCenti: 0 });
  });

  it("gives an empty structure rather than nothing when a person has no pay terms", () => {
    const segments = buildSegments([], timesheet, "2026-08-01", "2026-08-31");
    expect(segments).toHaveLength(1);
    expect(segments[0].terms.baseSalary).toBe(0);
  });
});

describe("months of service", () => {
  it("counts whole months only", () => {
    expect(monthsOfService("2024-03-01", "2026-08-31")).toBe(29);
    expect(monthsOfService("2026-08-01", "2026-08-31")).toBe(0);
    expect(monthsOfService("2026-09-01", "2026-08-31")).toBe(0);
    expect(monthsOfService(null, "2026-08-31")).toBe(0);
    // The day of the month has not come round yet.
    expect(monthsOfService("2025-08-20", "2026-08-19")).toBe(11);
  });
});
