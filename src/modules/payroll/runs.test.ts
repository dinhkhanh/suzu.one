// Runs and retro items against a real database (PGlite): storing a calculated run, carrying a
// difference from a paid month into the next one, and taxing an off-cycle bonus with its month.
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

import { and, eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { addRetroItem, cancelRetroItem, deriveRetroItems, listOpenRetroItems, listRetroItems } from "./retro";
import { calculateRun, cancelRun, createOffCycleRun, createRegularRun, getRunPerson, listRunPeople, openTotals, setRunInput } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"entity" | "actor" | "huy" | "lan", string>;

const summary = (overrides: Record<string, unknown> = {}) => ({
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

async function addStructure(personId: string, validFrom: string, baseSalary: number, createdAt?: Date) {
  const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, personId)).limit(1);
  const id = crypto.randomUUID();
  const terms = { baseSalary, insuranceSalary: baseSalary, allowances: [] };
  await db()
    .insert(schema.salaryStructure)
    .values({ id, personId, employmentId: employment.id, entityId: ids.entity, validFrom, reason: "raise", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)), ...(createdAt ? { createdAt } : {}) });
  return id;
}

async function lockMonth(month: string, people: { personId: string; summary: Record<string, unknown> }[]) {
  const lockedAt = new Date(`${month}-28T03:00:00Z`);
  await db().insert(schema.timesheetPeriod).values({ entityId: ids.entity, month, status: "locked", lockedAt, lockedByPersonId: ids.actor });
  await db()
    .insert(schema.timesheetMonth)
    .values(people.map((row) => ({ personId: row.personId, entityId: ids.entity, month, status: "locked" as const, summary: row.summary, lockedAt, lockedByPersonId: ids.actor })));
}

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const hire = async (name: string, startDate: string) => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate, seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.huy = await hire("Ho Gia Huy", "2024-03-01");
  ids.lan = await hire("Tran Thi Lan", "2025-06-01");

  await db()
    .insert(schema.statutoryParameter)
    .values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([
      { personId: ids.huy, employmentId: employmentOf(ids.huy), entityId: entity.id, profile: "statutory", validFrom: "2024-03-01", status: "approved" },
      { personId: ids.lan, employmentId: employmentOf(ids.lan), entityId: entity.id, profile: "simple", simpleBasis: "service_contract", validFrom: "2025-06-01", status: "approved" },
    ]);

  await addStructure(ids.huy, "2024-03-01", 30_000_000);
  await addStructure(ids.lan, "2025-06-01", 15_000_000);
  await lockMonth("2026-07", [
    { personId: ids.huy, summary: summary() },
    { personId: ids.lan, summary: summary() },
  ]);
  await lockMonth("2026-08", [
    { personId: ids.huy, summary: summary() },
    { personId: ids.lan, summary: summary() },
  ]);
});

describe("a regular run", () => {
  it("calculates, stores every person encrypted, and keeps the totals", async () => {
    const run = await createRegularRun({ entityId: ids.entity, month: "2026-07" }, ids.actor);
    expect(run.status).toBe("draft");
    const calculated = await calculateRun(run.id);

    expect(calculated.run.status).toBe("calculated");
    expect(calculated.run.headcount).toBe(2);
    expect(calculated.run.calculatedAt).toBeInstanceOf(Date);
    const totals = openTotals(calculated.run);
    expect(totals.headcount).toBe(2);
    expect(totals.grossEarnings).toBe(45_000_000);
    // The two profiles are reported apart: the collaborator is paid in cash (FR-PAY-39).
    expect(totals.netSimple).toBe(15_000_000);
    expect(totals.netStatutory).toBe(totals.net - 15_000_000);

    // Nothing readable in the clear: the stored row is ciphertext, and it is bound to its own id.
    const [row] = await db().select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.personId, ids.huy));
    expect(row.resultEnc).not.toMatch(/30000000|30,000,000/);
    expect(() => fieldCipher().decrypt(row.resultEnc, `payroll_run_person.result:${crypto.randomUUID()}`)).toThrow();

    const stored = await getRunPerson(run.id, ids.huy);
    expect(stored!.result.totals.grossEarnings).toBe(30_000_000);
    // What it was calculated from is kept too, so the month can be recomputed exactly (FR-PAY-20).
    expect(stored!.row.inputEnc.length).toBeGreaterThan(50);
  });

  it("refuses a second regular run for the same month", async () => {
    await expect(createRegularRun({ entityId: ids.entity, month: "2026-07" }, ids.actor)).rejects.toThrow("run_exists");
  });

  it("carries a typed-in bonus and recalculates in place", async () => {
    const [run] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.month, "2026-07"));
    await setRunInput({ runId: run.id, personId: ids.huy, code: "BONUS", amount: 5_000_000, note: "Thưởng dự án" }, ids.actor);
    const again = await calculateRun(run.id);

    const huy = again.people.find((person) => person.result.personId === ids.huy)!;
    expect(huy.result.lines.find((line) => line.code === "BONUS")?.amount).toBe(5_000_000);
    expect(huy.result.totals.grossEarnings).toBe(35_000_000);
    // Recalculating replaces the stored lines instead of adding to them.
    expect(await listRunPeople(run.id)).toHaveLength(2);

    // A second entry for the same code replaces the first, and stays readable after the conflict.
    await setRunInput({ runId: run.id, personId: ids.huy, code: "BONUS", amount: 6_000_000 }, ids.actor);
    const third = await calculateRun(run.id);
    expect(third.people.find((person) => person.result.personId === ids.huy)!.result.lines.find((line) => line.code === "BONUS")?.amount).toBe(6_000_000);
  });
});

describe("retro items (FR-PAY-17)", () => {
  it("derives a difference from a salary change approved after the month was paid", async () => {
    // July was paid on 30,000,000. The owner then approves a raise to 33,000,000 from 1 July.
    // A new structure closes the one before it the day before, as the salary-change flow does —
    // the exclusion constraint refuses two live structures for one person.
    // July's run was calculated on 3 August; the raise is approved on the 20th — that is what
    // makes it late, and what `deriveRetroItems` looks for.
    await db().update(schema.payrollRun).set({ calculatedAt: new Date("2026-08-03T02:00:00Z") }).where(eq(schema.payrollRun.month, "2026-07"));
    await db().update(schema.salaryStructure).set({ validTo: "2026-06-30" }).where(and(eq(schema.salaryStructure.personId, ids.huy), eq(schema.salaryStructure.validFrom, "2024-03-01")));
    await addStructure(ids.huy, "2026-07-01", 33_000_000, new Date("2026-08-20T02:00:00Z"));

    const derived = await deriveRetroItems(ids.entity, "2026-08", ids.actor);
    const item = derived.created.find((entry) => entry.personId === ids.huy && entry.sourceMonth === "2026-07");
    expect(item).toBeTruthy();
    // July's gross should have been 33,000,000 rather than 30,000,000 — and the bonus of the run
    // is not part of the structure, so the difference is exactly the raise.
    expect(item!.amount).toBe(3_000_000);
    expect(item!.kind).toBe("salary_change");
    // The month's declared contribution base changed too: payroll cannot mend a filed month.
    expect(item!.insuranceBaseChanged).toBe(true);
  });

  it("does not record the same difference twice", async () => {
    const before = (await listRetroItems({ entityIds: [ids.entity], status: "open" })).length;
    const again = await deriveRetroItems(ids.entity, "2026-08", ids.actor);
    expect(again.created).toHaveLength(0);
    expect((await listRetroItems({ entityIds: [ids.entity], status: "open" })).length).toBe(before);
  });

  it("is carried by the next run as its own line, and only once", async () => {
    const august = await createRegularRun({ entityId: ids.entity, month: "2026-08" }, ids.actor);
    const calculated = await calculateRun(august.id);
    expect(calculated.retroTaken).toBe(1);

    const huy = calculated.people.find((person) => person.result.personId === ids.huy)!;
    expect(huy.result.lines.find((line) => line.code === "RETRO_PAY")?.amount).toBe(3_000_000);
    // August pays the new salary as well, so gross is 33,000,000 + 3,000,000.
    expect(huy.result.totals.grossEarnings).toBe(36_000_000);

    // The item is taken and cannot be carried again.
    const open = await listOpenRetroItems(ids.entity, "2026-09");
    expect(open.get(ids.huy) ?? []).toHaveLength(0);
    const taken = await listRetroItems({ entityIds: [ids.entity], status: "taken" });
    expect(taken[0]).toMatchObject({ payrollMonth: "2026-08", runId: august.id });
  });

  it("gives a cancelled run's items back to the next one", async () => {
    const [august] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.month, "2026-08"));
    await cancelRun(august.id);
    expect((await listOpenRetroItems(ids.entity, "2026-09")).get(ids.huy)).toHaveLength(1);
    expect(await listRunPeople(august.id)).toHaveLength(0);
  });

  it("takes an item entered by hand, and refuses a nonsense one", async () => {
    const entered = await addRetroItem({ entityId: ids.entity, personId: ids.lan, sourceMonth: "2026-07", amount: -500_000, kind: "manual", reason: "Thu hồi tạm ứng ghi thiếu" }, ids.actor);
    expect(entered.status).toBe("open");
    await expect(addRetroItem({ entityId: ids.entity, personId: ids.lan, sourceMonth: "2026-07", amount: 0, kind: "manual", reason: "Không có gì" }, ids.actor)).rejects.toThrow("retro_amount_invalid");
    await expect(addRetroItem({ entityId: ids.entity, personId: ids.lan, sourceMonth: "2026-07", amount: 1, kind: "manual", reason: "  " }, ids.actor)).rejects.toThrow("retro_reason_required");

    // Cancelling keeps the row and the reason, and takes it out of the next run.
    const cancelled = await cancelRetroItem(entered.id, "Nhầm người");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.reason).toContain("Nhầm người");
    expect((await listOpenRetroItems(ids.entity, "2026-09")).get(ids.lan) ?? []).toHaveLength(0);
    await expect(cancelRetroItem(entered.id, "lần nữa")).rejects.toThrow("retro_item_not_open");
  });
});

describe("an off-cycle run (FR-PAY-19)", () => {
  it("needs no locked timesheet, pays only what it names, and taxes with the month", async () => {
    // Re-run August so the month has a regular run again after the cancellation above.
    const august = await createRegularRun({ entityId: ids.entity, month: "2026-08" }, ids.actor);
    const regular = await calculateRun(august.id);
    const regularHuy = regular.people.find((person) => person.result.personId === ids.huy)!.result;

    // September has no locked timesheet at all — a bonus is paid on a decision, not on attendance.
    const bonus = await createOffCycleRun({ entityId: ids.entity, month: "2026-09", name: "Thưởng dự án", lines: [{ personId: ids.huy, code: "BONUS", amount: 20_000_000 }] }, ids.actor);
    const calculated = await calculateRun(bonus.id);

    expect(calculated.people).toHaveLength(1);
    const result = calculated.people[0].result;
    expect(result.totals.grossEarnings).toBe(20_000_000);
    // No salary is paid again, and no insurance is contributed a second time.
    expect(result.lines.some((line) => line.code === "BASE")).toBe(false);
    expect(result.insurance).toMatchObject({ covered: false, reason: "off_cycle_run" });
    expect(result.warnings).toEqual([]);
    expect(regularHuy.totals.pit).toBeGreaterThan(0);
  });

  it("aggregates with the month's regular run: the same money is taxed the same either way", async () => {
    // Two off-cycle payments in the same month: the second must see what the first taxed.
    const second = await createOffCycleRun({ entityId: ids.entity, month: "2026-09", name: "Thưởng thêm", lines: [{ personId: ids.huy, code: "BONUS", amount: 10_000_000 }] }, ids.actor);
    const calculated = await calculateRun(second.id);
    const result = calculated.people[0].result;

    expect(result.pit.priorTax).toBeGreaterThan(0);
    // The month's tax on 30,000,000 of bonus, less what the first run already withheld.
    expect(result.totals.pit).toBe(result.pit.monthTax - result.pit.priorTax);
    expect(result.totals.net).toBe(10_000_000 - result.totals.pit);
  });

  it("refuses a run with nobody in it", async () => {
    await expect(createOffCycleRun({ entityId: ids.entity, month: "2026-09", name: "Trống", lines: [] }, ids.actor)).rejects.toThrow("run_has_no_lines");
  });
});
