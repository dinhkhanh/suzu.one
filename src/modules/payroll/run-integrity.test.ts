// The integrity of a payroll run against a real database (PGlite): what it carries from earlier
// months and keeps across a recalculation, how it goes stale and refuses to be proposed, what
// happens to a typed-in figure it cannot pay, what a return does to payslips already released,
// and how C&B read a calculation before they propose it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 4).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 6).toString("base64") }),
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
// The test only cares who payroll tells, and that it says nothing about money.
const notified: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }[] = [];
vi.mock("@/modules/platform/notifications/service", () => ({
  notify: async (input: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }) => {
    notified.push(input);
  },
}));

import { and, eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { runEntryContext, salaryTermsContext } from "./field-contexts";
import { listRunEvents, stepRun } from "./lifecycle";
import { getPayslipView, listMyPayslips, publishPayslips } from "./payslips";
import { addRetroItem, ALL_MONTHS, deriveRetroItems, enterRetroItem, getRetroItem, listRetroItems, listUnpricedAdjustments, refreshRetroItems, withdrawRetroItem } from "./retro";
import { getRunReadiness } from "./run-readiness";
import { findRunPerson, getRetroScreen, getRunView, openRunPerson } from "./run-views";
import { calculateRun, cancelRun, createOffCycleRun, createRegularRun, getRun as loadRun, listRunInputs, removeRunInput, setRunInput } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const shared = {} as Record<"actor" | "department", string>;

const summary = () => ({
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
});

/** core-hr binds these the same way; spelled out here so the test imports only payroll. */
const sensitiveContext = (field: "taxCode" | "bankAccounts", personId: string) => `person_sensitive.${field === "taxCode" ? "tax_code" : "bank_accounts"}:${personId}`;

async function addStructure(entityId: string, personId: string, validFrom: string, baseSalary: number, createdAt?: Date) {
  const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, personId)).limit(1);
  const id = crypto.randomUUID();
  const terms = { baseSalary, insuranceSalary: baseSalary, allowances: [] };
  await db()
    .insert(schema.salaryStructure)
    .values({ id, personId, employmentId: employment.id, entityId, validFrom, reason: "raise", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)), ...(createdAt ? { createdAt } : {}) });
  return id;
}

/**
 * A legal entity with its own people — each on the Statutory profile at 30,000,000 (the last one
 * at 20,000,000), each with a tax code and a pay account. Every group of tests gets its own, so
 * what one leaves behind (a retro item, a late salary decision) never reaches another.
 */
async function company(code: string, names: string[]): Promise<{ entityId: string; people: string[] }> {
  const [entity] = await db().insert(schema.entity).values({ code, legalName: `SuZu ${code}`, shortName: code, wageRegion: 1 }).returning();
  const people: string[] = [];
  for (const [index, name] of names.entries()) {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${code}.${name}`.toLowerCase().replace(/\s+/g, ".") + "@suzu.group", profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate: "2024-03-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: shared.department, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      shared.actor,
      { onboarding: false },
    );
    const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, person.id)).limit(1);
    await db().insert(schema.payProfile).values({ personId: person.id, employmentId: employment.id, entityId: entity.id, profile: "statutory", validFrom: "2024-03-01", status: "approved" });
    await db()
      .insert(schema.personSensitive)
      .values({ personId: person.id, taxCode: fieldCipher().encrypt("8412345678", sensitiveContext("taxCode", person.id)), bankAccounts: fieldCipher().encrypt(JSON.stringify([{ bankName: "VCB", accountNumber: "0123456789", accountHolder: "NV", branch: null }]), sensitiveContext("bankAccounts", person.id)) });
    await addStructure(entity.id, person.id, "2024-03-01", index === names.length - 1 && names.length > 1 ? 20_000_000 : 30_000_000);
    people.push(person.id);
  }
  return { entityId: entity.id, people };
}

async function lockMonth(entityId: string, month: string, people: string[]) {
  const lockedAt = new Date(`${month}-28T03:00:00Z`);
  await db().insert(schema.timesheetPeriod).values({ entityId, month, status: "locked", lockedAt, lockedByPersonId: shared.actor });
  await db()
    .insert(schema.timesheetMonth)
    .values(people.map((personId) => ({ personId, entityId, month, status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: shared.actor })));
}

/** A regular run of a locked month, calculated. */
async function calculated(entityId: string, month: string) {
  const run = await createRegularRun({ entityId, month }, shared.actor);
  return (await calculateRun(run.id)).run;
}

/** The month went all the way: it was calculated on the 3rd of the next month and the money is out. */
const markPaid = (runId: string, calculatedAt: string) => db().update(schema.payrollRun).set({ status: "paid", calculatedAt: new Date(calculatedAt) }).where(eq(schema.payrollRun.id, runId));

const getRun = async (runId: string) => (await loadRun(runId))!;
const linesOf = async (runId: string, personId: string) => {
  const [row] = await db().select().from(schema.payrollRunPerson).where(and(eq(schema.payrollRunPerson.runId, runId), eq(schema.payrollRunPerson.personId, personId)));
  return row;
};

/** A principal holding one role over one entity — how the screens are guarded. */
const grantee = (role: "payroll" | "c_level" | "finance" | "department_head", entityId: string, personId: string = crypto.randomUUID()): Principal => ({ personId, workforceType: "employee", grants: [{ role, scope: { type: "entity", id: entityId } }] });

beforeAll(async () => {
  await migrateTestDb();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  shared.department = department.id;
  shared.actor = actor.id;
  await db()
    .insert(schema.statutoryParameter)
    .values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });
});

describe("typed-in figures are never changed or dropped in silence (PAY-04)", () => {
  let entityId = "";
  let huy = "";
  let lan = "";
  let outsider = "";
  let runId = "";

  beforeAll(async () => {
    ({
      entityId,
      people: [huy, lan, outsider],
    } = await company("SZA", ["Ho Gia Huy", "Tran Thi Lan", "Le Van Ngoai"]));
    // The third person belongs to the entity but is not on the month's timesheet.
    await lockMonth(entityId, "2026-07", [huy, lan]);
    runId = (await createRegularRun({ entityId, month: "2026-07" }, shared.actor)).id;
  });

  it("refuses a code that is not an input component, where it is typed", async () => {
    await expect(setRunInput({ runId, personId: huy, code: "NOT_A_CODE", amount: 1_000 }, shared.actor)).rejects.toThrow("run_input_code_unknown");
    // BASE comes from the salary structure: a run may not overwrite it by typing a number in.
    await expect(setRunInput({ runId, personId: huy, code: "BASE", amount: 999_000_000 }, shared.actor)).rejects.toThrow("run_input_code_unknown");
    expect((await listRunInputs(runId)).size).toBe(0);
  });

  it("refuses a negative earning and a negative deduction, each with its own reason", async () => {
    // A clawback is a retro item or a deduction component, never a negative commission…
    await expect(setRunInput({ runId, personId: huy, code: "COMMISSION", amount: -500_000 }, shared.actor)).rejects.toThrow("run_input_negative_earning");
    // …and a deduction is entered as a positive amount: it is subtracted by being a deduction.
    await expect(setRunInput({ runId, personId: huy, code: "ADVANCE", amount: -2_000_000 }, shared.actor)).rejects.toThrow("run_input_negative_deduction");
    await expect(setRunInput({ runId, personId: huy, code: "BONUS", amount: 1.5 }, shared.actor)).rejects.toThrow("amount_invalid");
    expect((await listRunInputs(runId)).size).toBe(0);
  });

  it("subtracts a deduction entered as a positive amount", async () => {
    const before = (await calculateRun(runId)).people.find((person) => person.result.personId === huy)!.result.totals.net;
    await setRunInput({ runId, personId: huy, code: "ADVANCE", amount: 2_000_000, note: "Tạm ứng giữa tháng" }, shared.actor);
    const after = (await calculateRun(runId)).people.find((person) => person.result.personId === huy)!.result;
    expect(after.lines.find((line) => line.code === "ADVANCE")).toMatchObject({ kind: "deduction", amount: 2_000_000 });
    expect(before - after.totals.net).toBe(2_000_000);
    expect(after.warnings).toEqual([]);
  });

  it("leaves no run behind when an off-cycle run names a line payroll cannot take", async () => {
    const countRuns = async () => (await db().select({ id: schema.payrollRun.id }).from(schema.payrollRun).where(eq(schema.payrollRun.entityId, entityId))).length;
    const before = await countRuns();
    await expect(createOffCycleRun({ entityId, month: "2026-07", name: "Thưởng", lines: [{ personId: huy, code: "BONUS", amount: 1_000_000 }, { personId: lan, code: "BONUS", amount: -1 }] }, shared.actor)).rejects.toThrow("run_input_negative_earning");
    expect(await countRuns()).toBe(before);
  });

  it("names a figure typed for somebody outside the run as a blocker, and refuses the proposal", async () => {
    await setRunInput({ runId, personId: outsider, code: "BONUS", amount: 3_000_000 }, shared.actor);
    const run = (await calculateRun(runId)).run;
    expect(run.headcount).toBe(2);

    const readiness = await getRunReadiness(run);
    expect(readiness.stale).toEqual([]);
    expect(readiness.blockers).toEqual([{ kind: "input_outside_run", personId: outsider, codes: ["BONUS"] }]);
    await expect(stepRun(runId, "propose", { personId: shared.actor })).rejects.toThrow("run_has_blockers");

    // Taken out again and calculated again, nothing is in the way.
    await removeRunInput(runId, outsider, "BONUS", undefined, shared.actor);
    expect((await getRunReadiness((await calculateRun(runId)).run)).blockers).toEqual([]);
  });

  it("turns a figure the engine will not pay into a warning on the person and a blocker on the run", async () => {
    // A row from before the rule, or written past it: −500,000 of commission.
    const id = crypto.randomUUID();
    await db().insert(schema.payrollRunInput).values({ id, runId, personId: lan, code: "COMMISSION", amountEnc: fieldCipher().encrypt("-500000", runEntryContext(id)) });
    const { run, people } = await calculateRun(runId);
    const result = people.find((person) => person.result.personId === lan)!.result;
    // Not paid as +500,000, not paid at all — and said out loud.
    expect(result.lines.some((line) => line.code === "COMMISSION")).toBe(false);
    expect(result.totals.grossEarnings).toBe(30_000_000);
    expect(result.warnings).toContain("input_negative");
    expect((await linesOf(runId, lan)).warnings).toContain("input_negative");

    expect((await getRunReadiness(run)).blockers).toEqual([{ kind: "figure_not_paid", personId: lan }]);
    await expect(stepRun(runId, "propose", { personId: shared.actor })).rejects.toThrow("run_has_blockers");
    await removeRunInput(runId, lan, "COMMISSION", undefined, shared.actor);
  });

  it("warns about a missing account or tax code without refusing: those are settled before payment, not by recalculating", async () => {
    await db().update(schema.personSensitive).set({ bankAccounts: null, taxCode: null }).where(eq(schema.personSensitive.personId, huy));
    const run = (await calculateRun(runId)).run;
    const readiness = await getRunReadiness(run);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings.map((issue) => issue.kind).sort()).toEqual(["missing_bank_account", "missing_tax_code"]);
    expect((await stepRun(runId, "propose", { personId: shared.actor })).run.status).toBe("proposed");
  });
});

describe("a stale run cannot be proposed (PAY-03)", () => {
  let entityId = "";
  let huy = "";
  let lan = "";

  beforeAll(async () => {
    ({
      entityId,
      people: [huy, lan],
    } = await company("SZB", ["Ho Gia Huy", "Tran Thi Lan"]));
    for (const month of ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]) await lockMonth(entityId, month, [huy, lan]);
  });

  it("sends a calculated run back to draft when a figure is typed in, and records who caused it", async () => {
    const run = await calculated(entityId, "2026-07");
    expect(run.status).toBe("calculated");

    expect(await setRunInput({ runId: run.id, personId: huy, code: "BONUS", amount: 5_000_000 }, shared.actor)).toEqual({ reopened: true });
    const reopened = await getRun(run.id);
    expect(reopened.status).toBe("draft");
    // The last figures are still there to look at — they are just no longer the run's answer.
    expect(reopened.headcount).toBe(2);
    expect((await listRunEvents(run.id)).at(-1)).toMatchObject({ fromStatus: "calculated", toStatus: "draft", actorPersonId: shared.actor });
    expect((await getRunReadiness(reopened)).stale).toEqual(["inputs_changed"]);
    await expect(stepRun(run.id, "propose", { personId: shared.actor })).rejects.toThrow("run_step_not_allowed");

    // Calculated again, the bonus is in it and the run can go forward.
    const again = await calculateRun(run.id);
    expect(again.run.status).toBe("calculated");
    expect(again.people.find((person) => person.result.personId === huy)!.result.totals.grossEarnings).toBe(35_000_000);
    expect((await getRunReadiness(again.run)).stale).toEqual([]);
  });

  it("does not reopen the run for the same figure typed again, and does when it is taken out", async () => {
    const [run] = await db().select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, "2026-07")));
    // A sweep in another module re-posting what is already there changes nothing.
    expect(await setRunInput({ runId: run.id, personId: huy, code: "BONUS", amount: 5_000_000 }, shared.actor)).toEqual({ reopened: false });
    expect((await getRun(run.id)).status).toBe("calculated");

    expect(await removeRunInput(run.id, huy, "BONUS", undefined, shared.actor)).toEqual({ reopened: true });
    expect((await getRun(run.id)).status).toBe("draft");
    // Removing what is not there is not a change.
    await calculateRun(run.id);
    expect(await removeRunInput(run.id, huy, "BONUS")).toEqual({ reopened: false });
    expect((await getRun(run.id)).status).toBe("calculated");
    expect((await stepRun(run.id, "propose", { personId: shared.actor })).run.status).toBe("proposed");
    // Once proposed, the run is evidence: nothing is typed into it any more.
    await expect(setRunInput({ runId: run.id, personId: huy, code: "BONUS", amount: 1 }, shared.actor)).rejects.toThrow("run_not_editable");
  });

  it("refuses the proposal when a figure got in past the reset (defence in depth)", async () => {
    const run = await calculated(entityId, "2026-08");
    // Written straight into the table by something that does not go through `setRunInput`.
    const id = crypto.randomUUID();
    await db().insert(schema.payrollRunInput).values({ id, runId: run.id, personId: lan, code: "BONUS", amountEnc: fieldCipher().encrypt("1000000", runEntryContext(id)), updatedAt: new Date(Date.now() + 60_000) });
    expect((await getRun(run.id)).status).toBe("calculated");
    expect((await getRunReadiness(await getRun(run.id))).stale).toEqual(["inputs_changed"]);
    await expect(stepRun(run.id, "propose", { personId: shared.actor })).rejects.toThrow("run_stale");
  });

  it("leaves a run in draft when a figure was typed while it was being calculated", async () => {
    const run = await createRegularRun({ entityId, month: "2026-09" }, shared.actor);
    let typed = false;
    const outcome = await calculateRun(run.id, {
      // Half-way through the month's people, somebody types a bonus in.
      onProgress: async () => {
        if (typed) return;
        typed = true;
        await setRunInput({ runId: run.id, personId: lan, code: "BONUS", amount: 2_000_000 }, shared.actor);
      },
    });
    // The results are stored, but they were out of date before they were finished.
    expect(outcome.run.status).toBe("draft");
    expect(outcome.run.headcount).toBe(2);
    expect((await getRunReadiness(outcome.run)).stale).toEqual(["inputs_changed"]);
    expect((await calculateRun(run.id)).run.status).toBe("calculated");
  });

  it("goes stale when the timesheet is locked again after the calculation", async () => {
    const run = await calculated(entityId, "2026-10");
    expect((await getRunReadiness(run)).stale).toEqual([]);
    // HR reopened the period and locked it again: the run was worked out from the earlier lock.
    await db().update(schema.timesheetPeriod).set({ lockedAt: new Date("2026-11-02T03:00:00Z") }).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, "2026-10")));
    expect((await getRunReadiness(run)).stale).toEqual(["timesheet_changed"]);
    await expect(stepRun(run.id, "propose", { personId: shared.actor })).rejects.toThrow("run_stale");
    expect((await getRunReadiness((await calculateRun(run.id)).run)).stale).toEqual([]);
  });

  it("goes stale when a retro item is waiting for somebody in it, and when one is entered by hand the run is reopened", async () => {
    const run = await calculated(entityId, "2026-11");
    // Recorded without telling the run: the proposal still finds it.
    const item = await addRetroItem({ entityId, personId: huy, sourceMonth: "2026-10", amount: 700_000, kind: "manual", reason: "Phụ cấp tháng 10 trả thiếu" }, shared.actor);
    expect((await getRun(run.id)).status).toBe("calculated");
    expect((await getRunReadiness(run)).stale).toEqual(["retro_waiting"]);
    await expect(stepRun(run.id, "propose", { personId: shared.actor })).rejects.toThrow("run_stale");

    // Entered through the use-case, the run that would carry it goes back to draft by itself.
    await calculateRun(run.id);
    const entered = await enterRetroItem({ entityId, personId: lan, sourceMonth: "2026-10", amount: -200_000, reason: "Thu hồi phụ cấp trả thừa" }, shared.actor);
    expect(entered.reopenedRunIds).toEqual([run.id]);
    expect((await getRun(run.id)).status).toBe("draft");
    await expect(enterRetroItem({ entityId, personId: lan, sourceMonth: "2099-01", amount: 1, reason: "Tháng chưa tới" }, shared.actor)).rejects.toThrow("retro_month_in_future");

    const again = await calculateRun(run.id);
    expect(again.retroTaken).toBe(2);
    expect(again.people.find((person) => person.result.personId === lan)!.result.lines.find((line) => line.code === "RETRO_RECOVERY")?.amount).toBe(200_000);
    expect((await getRetroItem(item.id))!.status).toBe("taken");
    expect((await getRunReadiness(again.run)).stale).toEqual([]);
  });

  it("goes stale when a salary decision for the month is approved after the calculation", async () => {
    const run = await calculated(entityId, "2026-12");
    await db().update(schema.salaryStructure).set({ validTo: "2026-12-15" }).where(eq(schema.salaryStructure.personId, huy));
    await addStructure(entityId, huy, "2026-12-16", 36_000_000, new Date(Date.now() + 60_000));
    expect((await getRunReadiness(run)).stale).toEqual(["salary_changed"]);
    await expect(stepRun(run.id, "propose", { personId: shared.actor })).rejects.toThrow("run_stale");
  });
});

describe("retro pay exists, and a recalculation keeps what the run took (PAY-01, PAY-02)", () => {
  let entityId = "";
  let huy = "";
  let lan = "";
  let leaver = "";
  let julyRunId = "";
  let adjustmentId = "";

  const adjust = async (personId: string, month: string, reason: string) => {
    const [row] = await db().insert(schema.timesheetAdjustment).values({ personId, entityId, month, date: null, deltas: { paidDaysCenti: -100 }, reason, createdByPersonId: shared.actor }).returning();
    return row.id;
  };
  const adjustmentOf = async (id: string) => (await db().select().from(schema.timesheetAdjustment).where(eq(schema.timesheetAdjustment.id, id)))[0];

  beforeAll(async () => {
    ({
      entityId,
      people: [huy, lan, leaver],
    } = await company("SZC", ["Ho Gia Huy", "Tran Thi Lan", "Vu Da Nghi"]));
    await lockMonth(entityId, "2026-07", [huy, lan, leaver]);
    await lockMonth(entityId, "2026-08", [huy, lan]);
    await lockMonth(entityId, "2026-09", [huy, lan]);
    julyRunId = (await calculated(entityId, "2026-07")).id;
    await markPaid(julyRunId, "2026-08-03T02:00:00Z");
  });

  it("prices a correction to a locked timesheet when the next run is calculated, and carries it once", async () => {
    // HR records, after July was locked and paid, that Huy was on unpaid leave for a day.
    adjustmentId = await adjust(huy, "2026-07", "Một ngày nghỉ không lương ghi nhận sau khi khoá công");

    const august = await createRegularRun({ entityId, month: "2026-08" }, shared.actor);
    const first = await calculateRun(august.id);
    expect(first.retroTaken).toBe(1);
    const [item] = await listRetroItems({ entityIds: [entityId], personId: huy });
    // One day of 22 at 30,000,000, recovered — worked out by the engine from July's own input.
    expect(item).toMatchObject({ kind: "timesheet_adjustment", sourceMonth: "2026-07", sourceRef: adjustmentId, status: "taken", runId: august.id, payrollMonth: "2026-08" });
    expect(item.amount).toBe(-1_363_636);
    expect(first.people.find((person) => person.result.personId === huy)!.result.lines.find((line) => line.code === "RETRO_RECOVERY")?.amount).toBe(1_363_636);
    // Attendance has payroll's receipt: the correction can no longer be voided.
    expect((await adjustmentOf(adjustmentId)).payrollMonth).toBe("2026-08");

    // Calculated again, the line is still there: the run reads what it took itself.
    const second = await calculateRun(august.id);
    expect(second.retroTaken).toBe(1);
    expect(second.people.find((person) => person.result.personId === huy)!.result.lines.find((line) => line.code === "RETRO_RECOVERY")?.amount).toBe(1_363_636);
    expect(second.people.find((person) => person.result.personId === huy)!.result.totals.net).toBe(first.people.find((person) => person.result.personId === huy)!.result.totals.net);
    expect(await listRetroItems({ entityIds: [entityId], personId: huy })).toHaveLength(1);
  });

  it("gives everything back when the run is cancelled, and the next run takes it", async () => {
    const [august] = await db().select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, "2026-08")));
    await cancelRun(august.id);
    const [item] = await listRetroItems({ entityIds: [entityId], personId: huy });
    expect(item).toMatchObject({ status: "open", runId: null, payrollMonth: null });
    // The correction is free again too — until a run takes it, HR may still void it.
    expect((await adjustmentOf(adjustmentId)).payrollMonth).toBeNull();

    const again = await calculated(entityId, "2026-08");
    expect((await listRetroItems({ entityIds: [entityId], personId: huy }))[0]).toMatchObject({ status: "taken", runId: again.id });
    expect((await adjustmentOf(adjustmentId)).payrollMonth).toBe("2026-08");
  });

  it("lets C&B cancel an item the open run has taken: the run goes back to draft and the line is gone", async () => {
    const [august] = await db().select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, "2026-08"), eq(schema.payrollRun.status, "calculated")));
    const [item] = await listRetroItems({ entityIds: [entityId], personId: huy });
    await expect(withdrawRetroItem(item.id, "  ", shared.actor)).rejects.toThrow("retro_reason_required");
    const { reopenedRunId } = await withdrawRetroItem(item.id, "Đã trừ bằng tiền mặt", shared.actor);
    expect(reopenedRunId).toBe(august.id);
    expect((await getRun(august.id)).status).toBe("draft");
    expect((await getRetroItem(item.id))!).toMatchObject({ status: "cancelled", runId: null });
    expect((await getRetroItem(item.id))!.reason).toContain("Đã trừ bằng tiền mặt");

    // C&B said no to this difference: looking again does not bring it back.
    const again = await calculateRun(august.id);
    expect(again.retroTaken).toBe(0);
    expect(again.people.find((person) => person.result.personId === huy)!.result.lines.some((line) => line.code === "RETRO_RECOVERY")).toBe(false);
    expect(await listRetroItems({ entityIds: [entityId], personId: huy })).toHaveLength(1);
  });

  it("leaves an item waiting when its person is not in the run, instead of marking it paid", async () => {
    // July's leaver is owed something, and is on no later timesheet.
    const item = await addRetroItem({ entityId, personId: leaver, sourceMonth: "2026-07", amount: 900_000, kind: "manual", reason: "Phép năm chưa thanh toán" }, shared.actor);
    const [august] = await db().select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, "2026-08"), eq(schema.payrollRun.status, "calculated")));
    const again = await calculateRun(august.id);
    expect(again.retroTaken).toBe(0);
    expect((await getRetroItem(item.id))!.status).toBe("open");
    // It does not make the run stale either: this run could never carry it.
    expect((await getRunReadiness(again.run)).stale).toEqual([]);
    // C&B see it on the run, marked as outside it.
    const view = await getRunView(grantee("payroll", entityId), august.id);
    expect(view!.retro!.items.find((row) => row.id === item.id)).toMatchObject({ inRun: false, status: "open", fullName: "Vu Da Nghi" });
  });

  it("refuses to cancel an item once the run that took it has been proposed", async () => {
    const [august] = await db().select().from(schema.payrollRun).where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, "2026-08"), eq(schema.payrollRun.status, "calculated")));
    const entered = await enterRetroItem({ entityId, personId: lan, sourceMonth: "2026-07", amount: 400_000, reason: "Thưởng tháng 7 trả thiếu" }, shared.actor);
    expect(entered.reopenedRunIds).toEqual([august.id]);
    expect((await calculateRun(august.id)).retroTaken).toBe(1);
    await stepRun(august.id, "propose", { personId: shared.actor });
    await expect(withdrawRetroItem(entered.item.id, "Quá muộn", shared.actor)).rejects.toThrow("retro_item_not_open");
  });

  it("shows a correction to a month that was never run here, and lets C&B enter it by hand", async () => {
    // June was paid outside the system: there is nothing to recalculate it from.
    const juneAdjustment = await adjust(lan, "2026-06", "Thiếu một ngày công tháng 6");
    const derived = await deriveRetroItems(entityId, "2026-09", shared.actor);
    expect(derived.created).toHaveLength(0);
    expect(derived.skipped).toEqual([{ personId: lan, sourceMonth: "2026-06", reason: "month_not_run" }]);

    expect(await listUnpricedAdjustments(entityId, "2026-09")).toEqual([expect.objectContaining({ adjustmentId: juneAdjustment, personId: lan, sourceMonth: "2026-06", skip: "month_not_run", reason: "Thiếu một ngày công tháng 6" })]);
    const screen = await getRetroScreen(grantee("payroll", entityId), entityId);
    expect(screen!.unpriced.map((row) => row.fullName)).toEqual(["Tran Thi Lan"]);
    // Nobody outside C&B of the entity gets the screen at all.
    expect(await getRetroScreen(grantee("c_level", entityId), entityId)).toBeNull();
    expect(await getRetroScreen(grantee("payroll", crypto.randomUUID()), entityId)).toBeNull();

    // An amount for somebody else's correction, or another month's, is refused.
    await expect(enterRetroItem({ entityId, personId: huy, sourceMonth: "2026-06", amount: 909_091, reason: "Nhầm người", adjustmentId: juneAdjustment }, shared.actor)).rejects.toThrow("retro_adjustment_not_waiting");
    const { item } = await enterRetroItem({ entityId, personId: lan, sourceMonth: "2026-06", amount: 909_091, reason: "Thiếu một ngày công tháng 6", adjustmentId: juneAdjustment }, shared.actor);
    expect(item).toMatchObject({ kind: "timesheet_adjustment", sourceRef: juneAdjustment, status: "open" });
    expect(await listUnpricedAdjustments(entityId, "2026-09")).toEqual([]);

    // A correction to a month payroll has not reached yet is not "never run": it waits for that
    // month's own run, and the retro screen does not ask C&B to price it by hand.
    const ahead = await adjust(huy, "2026-09", "Điều chỉnh công tháng 9");
    expect(await listUnpricedAdjustments(entityId, ALL_MONTHS)).toEqual([]);
    expect((await deriveRetroItems(entityId, ALL_MONTHS, shared.actor)).skipped).toEqual([]);
    await db().delete(schema.timesheetAdjustment).where(eq(schema.timesheetAdjustment.id, ahead));

    // September carries it, and attendance gets its receipt like for any priced correction.
    const september = await createRegularRun({ entityId, month: "2026-09" }, shared.actor);
    const result = await calculateRun(september.id);
    expect(result.people.find((person) => person.result.personId === lan)!.result.lines.find((line) => line.code === "RETRO_PAY")?.amount).toBe(909_091);
    expect((await adjustmentOf(juneAdjustment)).payrollMonth).toBe("2026-09");
  });

  it("cancels the item of a correction HR voided after payroll had priced it", async () => {
    const voided = await adjust(lan, "2026-07", "Ghi nhầm ngày nghỉ");
    const { created } = await refreshRetroItems(entityId, shared.actor);
    const item = created.find((entry) => entry.sourceRef === voided)!;
    expect(item.amount).toBe(-1_363_636);
    // Still open, so attendance lets HR take the correction back.
    await db().update(schema.timesheetAdjustment).set({ status: "voided", voidedByPersonId: shared.actor, voidedAt: new Date(), voidReason: "Nhầm" }).where(eq(schema.timesheetAdjustment.id, voided));
    expect((await deriveRetroItems(entityId, "2026-10", shared.actor)).cancelled).toBe(1);
    expect((await getRetroItem(item.id))!.status).toBe("cancelled");
  });
});

describe("a raise back-dated over several paid months (PAY-01)", () => {
  it("leaves one item per month, and none for a month that can still be recalculated", async () => {
    const {
      entityId,
      people: [huy],
    } = await company("SZD", ["Ho Gia Huy"]);
    for (const month of ["2026-07", "2026-08", "2026-09"]) await lockMonth(entityId, month, [huy]);
    const july = await calculated(entityId, "2026-07");
    const august = await calculated(entityId, "2026-08");
    await markPaid(july.id, "2026-08-03T02:00:00Z");
    await markPaid(august.id, "2026-09-03T02:00:00Z");
    // September is calculated but not paid: it will be calculated again with the new salary.
    const september = await calculated(entityId, "2026-09");

    // On 20 September the owner approves 33,000,000 from 16 July.
    await db().update(schema.salaryStructure).set({ validTo: "2026-07-15" }).where(eq(schema.salaryStructure.personId, huy));
    const structureId = await addStructure(entityId, huy, "2026-07-16", 33_000_000, new Date(Date.now() + 60_000));

    const derived = await deriveRetroItems(entityId, "2026-10", shared.actor);
    expect(derived.created.map((item) => [item.sourceMonth, item.kind, item.sourceRef])).toEqual([
      ["2026-07", "salary_change", structureId],
      ["2026-08", "salary_change", structureId],
    ]);
    // August in full; July from the 16th only — the days actually worked under the new terms.
    expect(derived.created[1].amount).toBe(3_000_000);
    expect(derived.created[0].amount).toBeGreaterThan(0);
    expect(derived.created[0].amount).toBeLessThan(3_000_000);
    expect(derived.created.every((item) => item.insuranceBaseChanged)).toBe(true);
    // Looking again finds nothing new.
    expect((await deriveRetroItems(entityId, "2026-10", shared.actor)).created).toEqual([]);

    // September is stale, not owed a retro item: recalculated, it pays the new salary and carries both differences.
    expect((await getRunReadiness(september)).stale).toEqual(["retro_waiting", "salary_changed"]);
    const again = await calculateRun(september.id);
    const result = again.people[0].result;
    expect(again.retroTaken).toBe(2);
    expect(result.lines.find((line) => line.code === "BASE")?.amount).toBe(33_000_000);
    expect(result.lines.filter((line) => line.code === "RETRO_PAY").reduce((sum, line) => sum + line.amount, 0)).toBe(derived.created[0].amount + 3_000_000);
  });
});

describe("a retro item cancelled while the run is being calculated (PAY-02)", () => {
  it("leaves the run in draft: its figures carry an item it no longer holds", async () => {
    const {
      entityId,
      people: [huy],
    } = await company("SZG", ["Ho Gia Huy"]);
    await lockMonth(entityId, "2026-08", [huy]);
    const item = await addRetroItem({ entityId, personId: huy, sourceMonth: "2026-07", amount: 500_000, kind: "manual", reason: "Phụ cấp trả thiếu" }, shared.actor);
    const run = await createRegularRun({ entityId, month: "2026-08" }, shared.actor);

    let cancelled = false;
    const outcome = await calculateRun(run.id, {
      onProgress: async () => {
        if (cancelled) return;
        cancelled = true;
        await withdrawRetroItem(item.id, "Nhập nhầm", shared.actor);
      },
    });
    // The line is in the stored figures, the item is not the run's: it must be calculated again.
    expect(outcome.people[0].result.lines.find((line) => line.code === "RETRO_PAY")?.amount).toBe(500_000);
    expect(outcome.run.status).toBe("draft");
    expect((await getRetroItem(item.id))!).toMatchObject({ status: "cancelled", runId: null });

    const again = await calculateRun(run.id);
    expect(again.run.status).toBe("calculated");
    expect(again.retroTaken).toBe(0);
    expect(again.people[0].result.lines.some((line) => line.code === "RETRO_PAY")).toBe(false);
  });
});

describe("payslips do not outlive a returned run (PAY-08)", () => {
  let entityId = "";
  let huy = "";
  let lan = "";
  let runId = "";
  let payslipId = "";

  beforeAll(async () => {
    ({
      entityId,
      people: [huy, lan],
    } = await company("SZE", ["Ho Gia Huy", "Tran Thi Lan"]));
    await lockMonth(entityId, "2026-07", [huy, lan]);
    runId = (await calculated(entityId, "2026-07")).id;
  });

  it("returns a proposed run without telling anyone: nothing was out", async () => {
    await stepRun(runId, "propose", { personId: shared.actor });
    notified.length = 0;
    const { withdrawn } = await stepRun(runId, "return", { personId: shared.actor }, { comment: "Thiếu thưởng" });
    expect(withdrawn).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("withdraws the payslips when an approved run is sent back, and says so once", async () => {
    await stepRun(runId, "propose", { personId: shared.actor });
    await stepRun(runId, "approve", { personId: shared.actor });
    expect((await publishPayslips(runId, shared.actor)).published).toBe(2);
    const self: Principal = { personId: huy, workforceType: "employee", grants: [] };
    payslipId = (await listMyPayslips(huy))[0].id;
    expect(await getPayslipView(self, payslipId)).not.toBeNull();

    notified.length = 0;
    const { run, withdrawn } = await stepRun(runId, "return", { personId: shared.actor }, { comment: "Sai phụ cấp" });
    expect(run).toMatchObject({ status: "calculated", approvedAt: null, payslipsPublishedAt: null, payslipsPublishedByPersonId: null });
    expect(new Set(withdrawn)).toEqual(new Set([huy, lan]));

    // The figures are about to change: nobody goes on reading the old ones — not the person, not C&B.
    expect(await listMyPayslips(huy)).toEqual([]);
    expect(await getPayslipView(self, payslipId)).toBeNull();
    expect(await getPayslipView(grantee("payroll", entityId), payslipId)).toBeNull();
    // The row stays (a question asked about the month keeps its thread), marked withdrawn.
    const rows = await db().select().from(schema.payslip).where(eq(schema.payslip.runId, runId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.withdrawnAt instanceof Date)).toBe(true);

    // One notice each, naming the month and nothing else.
    expect(notified).toHaveLength(1);
    expect(notified[0].kind).toBe("payroll.payslip_withdrawn");
    expect(new Set(notified[0].recipients)).toEqual(new Set([huy, lan]));
    expect(JSON.stringify(notified[0].params)).toBe(JSON.stringify({ month: "2026-07" }));
  });

  it("releases them again after re-approval — the same payslip, unread, with the corrected figures", async () => {
    await db().update(schema.payslip).set({ firstViewedAt: new Date(), viewCount: 3 }).where(eq(schema.payslip.id, payslipId));
    await setRunInput({ runId, personId: huy, code: "BONUS", amount: 1_000_000 }, shared.actor);
    await calculateRun(runId);
    await stepRun(runId, "propose", { personId: shared.actor });
    // Nothing is released by the signature alone.
    await stepRun(runId, "approve", { personId: shared.actor });
    expect(await listMyPayslips(huy)).toEqual([]);

    notified.length = 0;
    expect((await publishPayslips(runId, shared.actor)).published).toBe(2);
    const mine = await listMyPayslips(huy);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: payslipId, firstViewedAt: null });
    const view = await getPayslipView({ personId: huy, workforceType: "employee", grants: [] }, payslipId);
    expect(view!.result.totals.grossEarnings).toBe(31_000_000);
    expect(view!.payslip.viewCount).toBe(0);
    expect(notified.map((entry) => entry.kind)).toEqual(["payroll.payslip_published"]);
    expect((await getRun(runId)).payslipsPublishedAt).toBeInstanceOf(Date);
    // …and releasing once more tells nobody again.
    notified.length = 0;
    expect((await publishPayslips(runId, shared.actor)).published).toBe(0);
    expect(notified).toEqual([]);
  });
});

describe("C&B read a calculation before proposing it (PAY-12)", () => {
  let entityId = "";
  let huy = "";
  let lan = "";
  let runId = "";

  beforeAll(async () => {
    ({
      entityId,
      people: [huy, lan],
    } = await company("SZF", ["Ho Gia Huy", "Tran Thi Lan"]));
    await lockMonth(entityId, "2026-07", [huy, lan]);
    runId = (await calculated(entityId, "2026-07")).id;
  });

  it("opens one person's lines and trace for C&B of the entity, and records the read without a figure", async () => {
    const cnb = grantee("payroll", entityId);
    const handle = await findRunPerson(cnb, runId, huy);
    expect(handle).not.toBeNull();
    // Finding the line reads no figure and records nothing; opening it does both.
    expect(await db().select().from(schema.auditLog)).toHaveLength(0);

    const view = await openRunPerson({ userId: "u-1", email: "cb@suzu.group", person: { id: cnb.personId! }, request: { ipAddress: "10.0.0.1", userAgent: "vitest" } }, handle!);
    expect(view.person.fullName).toBe("Ho Gia Huy");
    expect(view.result.lines.find((line) => line.code === "BASE")?.amount).toBe(30_000_000);
    expect(view.result.trace.length).toBeGreaterThan(3);
    expect(view.componentNames.get("BASE")).toBe("Lương cơ bản");
    // The run is not approved, and nothing has been published: this is the only way to read it.
    expect(view.run.status).toBe("calculated");
    expect(await listMyPayslips(huy)).toEqual([]);

    const [entry] = await db().select().from(schema.auditLog);
    expect(entry).toMatchObject({ action: "payroll_run.person.read", actorPersonId: cnb.personId, resourceType: "payroll_run", resourceId: runId, entityId, ipAddress: "10.0.0.1" });
    expect(entry.after).toEqual({ personId: huy, status: "calculated" });
    expect(JSON.stringify([entry.summary, entry.before, entry.after])).not.toMatch(/30000000|30,000,000|30\.000\.000/);
  });

  it("answers everyone else exactly like a line that does not exist", async () => {
    // The CEO signs against totals and never opens a payslip; the accountant pays; a manager manages.
    for (const viewer of [grantee("c_level", entityId), grantee("finance", entityId), grantee("department_head", entityId), grantee("payroll", crypto.randomUUID())]) expect(await findRunPerson(viewer, runId, huy)).toBeNull();
    // Not even the person themselves, before it is published.
    expect(await findRunPerson({ personId: huy, workforceType: "employee", grants: [] }, runId, huy)).toBeNull();
    expect(await findRunPerson(grantee("payroll", entityId), runId, crypto.randomUUID())).toBeNull();
    expect(await findRunPerson(grantee("payroll", entityId), crypto.randomUUID(), huy)).toBeNull();
  });

  it("shows on the run who took each step, each person's warnings, and what is in the way", async () => {
    await db().update(schema.personSensitive).set({ bankAccounts: null }).where(eq(schema.personSensitive.personId, lan));
    const [stranger] = await db().insert(schema.person).values({ fullName: "Chua Co Ho So", searchName: "chua co ho so", primaryEntityId: entityId, status: "active" }).returning();
    await db().insert(schema.timesheetMonth).values({ personId: stranger.id, entityId, month: "2026-07", status: "locked", summary: summary(), lockedAt: new Date("2026-07-28T03:00:00Z"), lockedByPersonId: shared.actor });
    await setRunInput({ runId, personId: huy, code: "BONUS", amount: 500_000 }, shared.actor);

    const view = (await getRunView(grantee("payroll", entityId), runId))!;
    // The history names its actors.
    expect(view.events.map((event) => [`${event.fromStatus}→${event.toStatus}`, event.actorName])).toEqual([["calculated→draft", "Seed Actor"]]);
    expect(view.readiness.stale).toEqual(["inputs_changed"]);
    // Somebody on the locked timesheet with no pay profile stops the whole month — named, with an id to link to.
    expect(view.readiness.blockers).toEqual([{ kind: "no_pay_profile", personId: stranger.id }]);
    expect(view.names.get(stranger.id)?.fullName).toBe("Chua Co Ho So");
    expect(view.readiness.warnings).toEqual([{ kind: "missing_bank_account", personId: lan }]);
    expect(view.people.map((person) => person.result?.totals.grossEarnings)).toEqual([30_000_000, 20_000_000]);

    // A reader who is not C&B sees the same list of names and reasons, and no figure of anyone's.
    const ceo = (await getRunView(grantee("c_level", entityId), runId))!;
    expect(ceo.readiness).toEqual(view.readiness);
    expect(ceo.people.every((person) => person.result === null && person.inputs.length === 0)).toBe(true);
    expect(ceo.retro).toBeNull();
    expect(await getRunView(grantee("payroll", crypto.randomUUID()), runId)).toBeNull();
  });
});
