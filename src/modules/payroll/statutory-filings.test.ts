// The filings against a real database (PGlite), for the two things inspection PAY-06 found:
// a month with a regular run **and** an off-cycle bonus was double-counted, and a run nobody had
// signed could reach a declaration. The August figures are golden case 16's, derived by hand there.
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
import { stepRun } from "./lifecycle";
import { payrollRegister, pitSummary } from "./reports";
import { calculateRun, createOffCycleRun, createRegularRun } from "./runs";
import { payComponentSeedRows } from "./seed-components";
import { finalizationRows, insuranceChanges, pitPeriodRows, withholdingCertificate } from "./statutory-exports";

const ids = {} as Record<"entity" | "actor" | "huy", string>;
const owner = (): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] });

const summary = () => ({
  days: 31, standardDays: 22, standardMinutes: 10_560, workedMinutes: 10_560, creditedMinutes: 0,
  leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
  lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0,
  otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 2200, unpaidDaysCenti: 0, anomalyDays: 0,
});

// One ordinary month of a 30,000,000 salary with no dependants (golden case 16's regular run):
// insurance 10.5 % = 3,150,000; personal deduction 15,500,000; assessable 11,350,000; PIT 635,000.
const MONTH = { taxableIncome: 30_000_000, insurance: 3_150_000, personal: 15_500_000, assessable: 11_350_000, tax: 635_000 };
// The month a 20,000,000 bonus is paid in by an off-cycle run, **taken as one month**: income
// 50,000,000, the same deductions once, assessable 31,350,000, PIT 2,770,000 (635,000 + 2,135,000).
const BONUS_MONTH = { taxableIncome: 50_000_000, insurance: 3_150_000, personal: 15_500_000, assessable: 31_350_000, tax: 2_770_000 };

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const { person } = await hirePerson(
    { fullName: "Ho Gia Huy", workEmail: "huy.ho@suzu.group", profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate: "2025-01-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
    actor.id,
    { onboarding: false },
  );
  ids.huy = person.id;

  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const [employment] = await db().select().from(schema.employment);
  await db().insert(schema.payProfile).values({ personId: ids.huy, employmentId: employment.id, entityId: entity.id, profile: "statutory", validFrom: "2025-01-01", status: "approved" });
  const structureId = crypto.randomUUID();
  await db().insert(schema.salaryStructure).values({ id: structureId, personId: ids.huy, employmentId: employment.id, entityId: entity.id, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: 30_000_000, insuranceSalary: 30_000_000, allowances: [] }), salaryTermsContext(structureId)) });

  const sign = async (runId: string) => {
    for (const step of ["propose", "approve"] as const) await stepRun(runId, step, { personId: actor.id });
  };
  const regular = async (month: string, signed: boolean) => {
    const lockedAt = new Date(`${month}-28T03:00:00Z`);
    await db().insert(schema.timesheetPeriod).values({ entityId: entity.id, month, status: "locked", lockedAt, lockedByPersonId: actor.id });
    await db().insert(schema.timesheetMonth).values({ personId: ids.huy, entityId: entity.id, month, status: "locked", summary: summary(), lockedAt, lockedByPersonId: actor.id });
    const run = await createRegularRun({ entityId: entity.id, month }, actor.id);
    await calculateRun(run.id);
    if (signed) await sign(run.id);
  };
  const bonus = async (month: string, amount: number, signed: boolean) => {
    const run = await createOffCycleRun({ entityId: entity.id, month, name: `Thưởng ${month}`, lines: [{ personId: ids.huy, code: "BONUS", amount }] }, actor.id);
    await calculateRun(run.id);
    if (signed) await sign(run.id);
  };

  // July: an ordinary month, signed.
  await regular("2026-07", true);
  // August: the regular run and an off-cycle bonus, both signed — and a second bonus that has only
  // been calculated, which no filing may see.
  await regular("2026-08", true);
  await bonus("2026-08", 20_000_000, true);
  await bonus("2026-08", 7_000_000, false);
  // September: calculated, not signed.
  await regular("2026-09", false);
});

describe("a month with a regular and an off-cycle run is one month (PAY-06)", () => {
  it("gives the PIT period row the hand-computed figures of that month", async () => {
    const built = (await pitPeriodRows(owner(), ids.entity, "2026-08"))!;
    expect(built.rows).toHaveLength(1);
    const row = built.rows[0];
    // Income and tax withheld: the two runs added. Deductions and assessable income: once.
    expect({ taxableIncome: row.taxableIncome, deductions: row.deductions, assessableIncome: row.assessableIncome, tax: row.tax, method: row.method }).toEqual({
      taxableIncome: BONUS_MONTH.taxableIncome,
      deductions: BONUS_MONTH.insurance + BONUS_MONTH.personal,
      assessableIncome: BONUS_MONTH.assessable,
      tax: BONUS_MONTH.tax,
      method: "progressive",
    });
    // The arithmetic of the row closes, which the doubled figures never did.
    expect(row.taxableIncome - row.deductions).toBe(row.assessableIncome);
  });

  it("adds months to a quarter, each counted once", async () => {
    const [row] = (await pitPeriodRows(owner(), ids.entity, "2026-Q3"))!.rows;
    // July + August; September is not signed and is not in it.
    expect(row.taxableIncome).toBe(MONTH.taxableIncome + BONUS_MONTH.taxableIncome);
    expect(row.deductions).toBe(2 * (MONTH.insurance + MONTH.personal));
    expect(row.assessableIncome).toBe(MONTH.assessable + BONUS_MONTH.assessable);
    expect(row.tax).toBe(MONTH.tax + BONUS_MONTH.tax);
  });

  it("carries the same rule into the annual finalization and the certificate", async () => {
    const [row] = (await finalizationRows(owner(), ids.entity, 2026))!.rows;
    expect(row.taxableIncome).toBe(MONTH.taxableIncome + BONUS_MONTH.taxableIncome);
    // Two months of deductions — not three, although three signed runs paid them.
    expect(row.personalDeduction).toBe(2 * MONTH.personal);
    expect(row.insuranceDeduction).toBe(2 * MONTH.insurance);
    expect(row.assessableIncome).toBe(MONTH.assessable + BONUS_MONTH.assessable);
    expect(row.taxWithheld).toBe(MONTH.tax + BONUS_MONTH.tax);
    // The year re-taxed from its own assessable income is a check that can now be trusted.
    expect(row.taxableIncome - row.insuranceDeduction - row.personalDeduction - row.dependentDeduction - row.otherDeductions).toBe(row.assessableIncome);

    const certificate = (await withholdingCertificate(owner(), { personId: ids.huy, entityId: ids.entity, year: 2026 }, "2027-01-15"))!;
    expect(certificate.person.assessableIncome).toBe(row.assessableIncome);
    expect(certificate.person.taxWithheld).toBe(row.taxWithheld);
  });

  it("gives the PIT working paper the month's assessable income, not the runs' added together", async () => {
    const pit = (await pitSummary(owner(), ids.entity, "2026-08"))!;
    expect(pit.lines).toHaveLength(1);
    expect(pit.lines[0].assessableIncome).toBe(BONUS_MONTH.assessable);
    expect(pit.lines[0].taxableIncome).toBe(BONUS_MONTH.taxableIncome);
    expect(pit.totals.tax).toBe(BONUS_MONTH.tax);
  });
});

describe("a run nobody has signed is in no filing (PAY-06)", () => {
  it("keeps the calculated bonus out of August, though the register — C&B's working paper — shows it", async () => {
    // 20,000,000 was signed; the further 7,000,000 was only calculated.
    const [row] = (await pitPeriodRows(owner(), ids.entity, "2026-08"))!.rows;
    expect(row.taxableIncome).toBe(BONUS_MONTH.taxableIncome);
    const register = (await payrollRegister(owner(), ids.entity, "2026-08"))!;
    expect(register.lines[0].gross).toBe(BONUS_MONTH.taxableIncome + 7_000_000);
  });

  it("has nothing to declare for a month whose run is only calculated", async () => {
    expect(await pitPeriodRows(owner(), ids.entity, "2026-09")).toBeNull();
    expect(await pitSummary(owner(), ids.entity, "2026-09")).toBeNull();
    // D02-LT too: an unsigned month is not a month in which everybody left.
    expect(await insuranceChanges(owner(), ids.entity, "2026-09")).toBeNull();
    // August against July, both signed, is a month with nothing to report.
    expect((await insuranceChanges(owner(), ids.entity, "2026-08"))!.rows).toEqual([]);
  });

  it("names only signed months on the withholding certificate", async () => {
    const certificate = (await withholdingCertificate(owner(), { personId: ids.huy, entityId: ids.entity, year: 2026 }, "2027-01-15"))!;
    expect(certificate.months).toEqual(["2026-07", "2026-08"]);
  });
});
