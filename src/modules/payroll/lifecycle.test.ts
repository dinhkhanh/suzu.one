// The run lifecycle against a real database (PGlite): the D17 order, who may take each step, the
// variance check, period locking, the immutability of a locked run, and the background calculation.
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

import { eq, sql } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";

/** core-hr binds these the same way; spelled out here so the test imports only payroll. */
const sensitiveContext = (field: "taxCode" | "bankAccounts", personId: string) => `person_sensitive.${field === "taxCode" ? "tax_code" : "bank_accounts"}:${personId}`;
import { availableSteps, hasReached, isPayrollPeriodLocked, listRunEvents, listRunMilestones, NEXT_STEP, RUN_STEPS, type RunStep, stepRun } from "./lifecycle";
import { generateBankFile, openCashSheet, planPayment, listPayables, recordCashDisbursement } from "./payments";
import { canApprovePayroll, canManageCompensation, canPayPayroll } from "./policy";
import { isCalculating, payrollCalculateJob, progressOf, queueRunCalculation, workOneRun } from "./run-calculation";
import { calculateRun, createOffCycleRun, createRegularRun, getRun as loadRun } from "./runs";
import { payComponentSeedRows } from "./seed-components";
import { getRunVariance } from "./variance";

const ids = {} as Record<"entity" | "other" | "actor" | "huy" | "lan" | "newcomer", string>;

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

async function addStructure(personId: string, validFrom: string, baseSalary: number) {
  const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, personId)).limit(1);
  const id = crypto.randomUUID();
  const terms = { baseSalary, insuranceSalary: baseSalary, allowances: [] };
  await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employment.id, entityId: ids.entity, validFrom, reason: "raise", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)) });
}

async function lockMonth(month: string, people: string[]) {
  const lockedAt = new Date(`${month}-28T03:00:00Z`);
  await db().insert(schema.timesheetPeriod).values({ entityId: ids.entity, month, status: "locked", lockedAt, lockedByPersonId: ids.actor });
  await db()
    .insert(schema.timesheetMonth)
    .values(people.map((personId) => ({ personId, entityId: ids.entity, month, status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: ids.actor })));
}

/** A principal holding one payroll role over one entity — how the steps are guarded in the actions. */
const grantee = (role: "hr_admin" | "c_level" | "finance" | "department_head", entityId: string): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants: [{ role, scope: { type: "entity", id: entityId } }] });

/**
 * Everything FR-PAY-39 asks for before a run may be called "paid": a batch for every bank that
 * owes somebody money, and a disbursement recorded for everyone on the cash sheet. `payments.test`
 * covers the rule itself; here it is just the step before `mark_paid`.
 */
async function settle(runId: string) {
  const run = (await loadRun(runId))!;
  const plan = planPayment(await listPayables(run));
  for (const bank of plan.banks) {
    await generateBankFile({ runId, bank: bank.key, valueDate: `${run.month}-05`, payingAccount: { accountNumber: "0071000123456", accountName: "CONG TY" } }, ids.actor);
  }
  if (plan.cash.length > 0) {
    await openCashSheet(runId, ids.actor);
    for (const person of plan.cash) await recordCashDisbursement({ runId, personId: person.personId, disbursedOn: `${run.month}-05` }, ids.actor);
  }
}

/** `getRun` is nullable; inside these tests the run always exists. */
const getRun = async (runId: string) => (await loadRun(runId))!;

const runOfMonth = async (month: string) => {
  const [row] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.month, month)).limit(1);
  return row;
};

/** A database trigger refusing a write: drizzle wraps the message, so the reason is in the cause. */
async function refused(query: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await query.then(() => null).catch((thrown: unknown) => thrown);
  expect(error, "the write should have been refused").not.toBeNull();
  expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(reason);
}

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [other] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.other = other.id;
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
  ids.lan = await hire("Tran Thi Lan", "2025-06-01");
  ids.newcomer = await hire("Vu Thi Ngan", "2026-08-01");

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
      { personId: ids.newcomer, employmentId: employmentOf(ids.newcomer), entityId: entity.id, profile: "statutory", validFrom: "2026-08-01", status: "approved" },
    ]);

  // Everyone has somewhere to be paid, so the variance check is quiet unless a test asks for noise.
  for (const personId of [ids.huy, ids.newcomer]) {
    await db()
      .insert(schema.personSensitive)
      .values({
        personId,
        taxCode: fieldCipher().encrypt("8412345678", sensitiveContext("taxCode", personId)),
        bankAccounts: fieldCipher().encrypt(JSON.stringify([{ bankName: "VCB", accountNumber: "0123456789", accountHolder: "NV", branch: null }]), sensitiveContext("bankAccounts", personId)),
      });
  }

  await addStructure(ids.huy, "2024-03-01", 30_000_000);
  await addStructure(ids.lan, "2025-06-01", 15_000_000);
  await addStructure(ids.newcomer, "2026-08-01", 18_000_000);

  await lockMonth("2026-07", [ids.huy, ids.lan]);
  await lockMonth("2026-08", [ids.huy, ids.lan, ids.newcomer]);
  await lockMonth("2026-09", [ids.huy, ids.lan, ids.newcomer]);
});

describe("the lifecycle order (FR-PAY-30, SRS D17)", () => {
  it("walks draft → calculated → proposed → approved → payment_prepared → paid → locked", async () => {
    const run = await createRegularRun({ entityId: ids.entity, month: "2026-07" }, ids.actor);
    expect(run.status).toBe("draft");
    // Nothing can be proposed before it has been calculated: figures first.
    await expect(stepRun(run.id, "propose", { personId: ids.actor })).rejects.toThrow("run_step_not_allowed");

    await calculateRun(run.id);
    expect(availableSteps(await runOfMonth("2026-07"))).toEqual(["propose"]);

    const walked: string[] = [];
    for (const step of ["propose", "approve", "prepare_payment", "mark_paid", "lock"] as RunStep[]) {
      // The money has to have actually gone out before the run says it has (FR-PAY-39).
      if (step === "mark_paid") await settle(run.id);
      const { run: after } = await stepRun(run.id, step, { personId: ids.actor });
      walked.push(after.status);
    }
    expect(walked).toEqual(["proposed", "approved", "payment_prepared", "paid", "locked"]);

    // Every step is signed, in order, and the whole history is there (including who).
    const events = await listRunEvents(run.id);
    expect(events.map((event) => `${event.fromStatus}→${event.toStatus}`)).toEqual(["calculated→proposed", "proposed→approved", "approved→payment_prepared", "payment_prepared→paid", "paid→locked"]);
    expect(events.every((event) => event.actorPersonId === ids.actor)).toBe(true);

    const locked = await runOfMonth("2026-07");
    expect(locked.proposedByPersonId).toBe(ids.actor);
    expect(locked.approvedAt).toBeInstanceOf(Date);
    expect(locked.paidAt).toBeInstanceOf(Date);
    expect(availableSteps(locked)).toEqual([]);
  });

  it("refuses a step out of order and a step taken twice", async () => {
    const run = await runOfMonth("2026-07");
    await expect(stepRun(run.id, "approve", { personId: ids.actor })).rejects.toThrow("run_step_not_allowed");
    await expect(stepRun(run.id, "lock", { personId: ids.actor })).rejects.toThrow("run_step_not_allowed");
  });

  it("refuses to propose an empty run", async () => {
    const run = await createRegularRun({ entityId: ids.other, month: "2026-07" }, ids.actor);
    await expect(stepRun(run.id, "propose", { personId: ids.actor })).rejects.toThrow("run_step_not_allowed");
    // Even once it counts as calculated, nobody proposes a month with nobody in it.
    await db().update(schema.payrollRun).set({ status: "calculated", headcount: 0 }).where(eq(schema.payrollRun.id, run.id));
    await expect(stepRun(run.id, "propose", { personId: ids.actor })).rejects.toThrow("run_is_empty");
  });

  it("lets the CEO send a run back to HR, with a reason, and requires the reason", async () => {
    const run = await createRegularRun({ entityId: ids.entity, month: "2026-08" }, ids.actor);
    await calculateRun(run.id);
    await stepRun(run.id, "propose", { personId: ids.actor });

    await expect(stepRun(run.id, "return", { personId: ids.actor }, { comment: "   " })).rejects.toThrow("comment_required");
    const { run: returned } = await stepRun(run.id, "return", { personId: ids.actor }, { comment: "Thiếu thưởng dự án của Huy" });
    expect(returned.status).toBe("calculated");
    // Sent back means unproposed: nobody's signature is left standing on it.
    expect(returned.proposedAt).toBeNull();
    expect(returned.proposedByPersonId).toBeNull();
    expect((await listRunEvents(run.id)).at(-1)).toMatchObject({ toStatus: "calculated", comment: "Thiếu thưởng dự án của Huy" });

    // …and it can be proposed again, which is the point of a return.
    await stepRun(run.id, "propose", { personId: ids.actor });
    expect((await runOfMonth("2026-08")).status).toBe("proposed");
  });

  it("lets the CEO take a signature back before the money moves, and not after", async () => {
    const run = await runOfMonth("2026-08");
    await stepRun(run.id, "approve", { personId: ids.actor });
    const { run: unsigned } = await stepRun(run.id, "return", { personId: ids.actor }, { comment: "Ký nhầm tháng" });
    expect(unsigned).toMatchObject({ status: "calculated", approvedAt: null, approvedByPersonId: null });

    await stepRun(run.id, "propose", { personId: ids.actor });
    await stepRun(run.id, "approve", { personId: ids.actor });
    await stepRun(run.id, "prepare_payment", { personId: ids.actor });
    // The accountant has the files: too late to unsign.
    await expect(stepRun(run.id, "return", { personId: ids.actor }, { comment: "Quá muộn" })).rejects.toThrow("run_step_not_allowed");
  });

  it("offers the next step for each status, and nothing for a finished or cancelled run", () => {
    expect(NEXT_STEP.calculated).toBe("propose");
    expect(NEXT_STEP.proposed).toBe("approve");
    expect(NEXT_STEP.paid).toBe("lock");
    expect(NEXT_STEP.locked).toBeUndefined();
    expect(availableSteps({ status: "cancelled", headcount: 3 })).toEqual([]);
  });

  it("knows how far a run has got", () => {
    expect(hasReached({ status: "paid" }, "proposed")).toBe(true);
    expect(hasReached({ status: "proposed" }, "paid")).toBe(false);
    expect(hasReached({ status: "locked" }, "locked")).toBe(true);
    // A cancelled run has got nowhere, whatever it once was.
    expect(hasReached({ status: "cancelled" }, "proposed")).toBe(false);
  });
});

describe("who may take each step (SRS D17)", () => {
  const cases: { step: RunStep; hr: boolean; ceo: boolean; accountant: boolean }[] = [
    { step: "propose", hr: true, ceo: false, accountant: false },
    { step: "approve", hr: false, ceo: true, accountant: false },
    { step: "return", hr: false, ceo: true, accountant: false },
    { step: "prepare_payment", hr: false, ceo: false, accountant: true },
    { step: "mark_paid", hr: false, ceo: false, accountant: true },
    { step: "lock", hr: true, ceo: false, accountant: false },
  ];

  const allows = { "payroll:propose": canManageCompensation, "payroll:approve": canApprovePayroll, "payroll:pay": canPayPayroll } as const;
  const may = (step: RunStep, principal: Principal) => allows[RUN_STEPS[step].permission](principal, { entityId: ids.entity });

  it.each(cases)("$step: HR lead $hr · CEO $ceo · chief accountant $accountant", ({ step, hr, ceo, accountant }) => {
    expect(may(step, grantee("hr_admin", ids.entity))).toBe(hr);
    expect(may(step, grantee("c_level", ids.entity))).toBe(ceo);
    expect(may(step, grantee("finance", ids.entity))).toBe(accountant);
    // Nobody from the org chart gets near a run, whatever the step.
    expect(may(step, grantee("department_head", ids.entity))).toBe(false);
    // …and no payroll role reaches another entity's run.
    expect(may(step, grantee("hr_admin", ids.other))).toBe(false);
    expect(may(step, grantee("c_level", ids.other))).toBe(false);
    expect(may(step, grantee("finance", ids.other))).toBe(false);
  });

  it("gives the owner every step everywhere", () => {
    const owner: Principal = { personId: crypto.randomUUID(), workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] };
    for (const { step } of cases) expect(may(step, owner)).toBe(true);
    expect(can(owner, "payroll:approve", { entityId: ids.other })).toBe(true);
  });
});

describe("period locking (DR-07)", () => {
  it("closes the month to every new run once the run is locked", async () => {
    expect(await isPayrollPeriodLocked(ids.entity, "2026-07")).toBe(true);
    await expect(createRegularRun({ entityId: ids.entity, month: "2026-07" }, ids.actor)).rejects.toThrow("payroll_period_locked");
    // Not even a bonus: it would change the tax of a month already declared.
    await expect(createOffCycleRun({ entityId: ids.entity, month: "2026-07", name: "Thưởng", lines: [{ personId: ids.huy, code: "BONUS", amount: 1_000_000 }] }, ids.actor)).rejects.toThrow("payroll_period_locked");
  });

  it("leaves an open month open", async () => {
    expect(await isPayrollPeriodLocked(ids.entity, "2026-08")).toBe(false);
    expect(await isPayrollPeriodLocked(ids.other, "2026-07")).toBe(false);
  });

  it("refuses to change a locked run at all — the database says no, whatever the code does", async () => {
    const run = await runOfMonth("2026-07");
    await refused(db().update(schema.payrollRun).set({ note: "sửa trộm" }).where(eq(schema.payrollRun.id, run.id)), /is locked/);
    await refused(db().delete(schema.payrollRun).where(eq(schema.payrollRun.id, run.id)), /is locked/);
    // …and nothing hanging off it either: not a person's figures, not a typed-in amount.
    await refused(db().update(schema.payrollRunPerson).set({ warnings: ["negative_net"] }).where(eq(schema.payrollRunPerson.runId, run.id)), /is locked/);
    await refused(db().delete(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, run.id)), /is locked/);
    // A recalculation is refused before it reaches the trigger, by the status itself.
    await expect(calculateRun(run.id)).rejects.toThrow("run_not_editable");
  });

  it("keeps the record of the steps as it was written", async () => {
    const run = await runOfMonth("2026-07");
    const [event] = await listRunEvents(run.id);
    await refused(db().update(schema.payrollRunEvent).set({ comment: "viết lại" }).where(eq(schema.payrollRunEvent.id, event.id)), /append-only/);
    await refused(db().delete(schema.payrollRunEvent).where(eq(schema.payrollRunEvent.id, event.id)), /append-only/);
  });
});

describe("the variance check (FR-PAY-31)", () => {
  it("compares the month with the one before, per person and in total", async () => {
    const run = await runOfMonth("2026-08");
    const variance = await getRunVariance(run);

    expect(variance.hasPrevious).toBe(true);
    expect(variance.previousMonth).toBe("2026-07");
    expect(variance.totals).toMatchObject({ headcount: 3, previousHeadcount: 2 });
    // The joiner is named as new, not as a rise out of nowhere.
    expect(variance.people.find((person) => person.personId === ids.newcomer)).toMatchObject({ flags: ["new_person"], changeBp: null });
    // The two who were paid last month on the same terms are quiet.
    expect(variance.people.find((person) => person.personId === ids.huy)?.flags).toEqual([]);
    // Names come with it, so the screen shows people rather than uuids.
    expect(variance.names.get(ids.huy)?.fullName).toBe("Ho Gia Huy");
  });

  it("flags someone with no bank account, and never the cash-paid Simple profile", async () => {
    const run = await runOfMonth("2026-08");
    const variance = await getRunVariance(run);
    // Lan is on the Simple profile: paid in cash, no account needed (FR-PAY-39).
    expect(variance.people.find((person) => person.personId === ids.lan)?.flags).not.toContain("missing_bank_account");

    // Take Huy's account away and the run says so.
    await db().update(schema.personSensitive).set({ bankAccounts: null }).where(eq(schema.personSensitive.personId, ids.huy));
    const again = await getRunVariance(run);
    expect(again.people.find((person) => person.personId === ids.huy)?.flags).toContain("missing_bank_account");
    expect(again.counts.missing_bank_account).toBe(1);
    await db()
      .update(schema.personSensitive)
      .set({ bankAccounts: fieldCipher().encrypt(JSON.stringify([{ bankName: "VCB", accountNumber: "0123456789", accountHolder: "NV", branch: null }]), sensitiveContext("bankAccounts", ids.huy)) })
      .where(eq(schema.personSensitive.personId, ids.huy));
  });

  it("has nothing to compare for an entity's first run, and does not pretend otherwise", async () => {
    // An entity that has never run payroll: no earlier month exists to compare against.
    const [fresh] = await db().insert(schema.entity).values({ code: "SZG", legalName: "SuZu Group", shortName: "Group", wageRegion: 1 }).returning();
    const run = await createRegularRun({ entityId: fresh.id, month: "2026-08" }, ids.actor);
    const variance = await getRunVariance(run);
    expect(variance.hasPrevious).toBe(false);
    expect(variance.totals.changeBp).toBeNull();
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, run.id));
  });
});

describe("the calculation as background work (ADR-09)", () => {
  it("reports progress while it works and finishes done", async () => {
    const run = await createRegularRun({ entityId: ids.entity, month: "2026-09" }, ids.actor);
    await queueRunCalculation(run.id);
    expect(isCalculating(await getRun(run.id))).toBe(true);
    expect(progressOf(await getRun(run.id)).state).toBe("queued");

    const outcome = await workOneRun(run.id);
    expect(outcome).toMatchObject({ outcome: "calculated", headcount: 3 });
    const after = await getRun(run.id);
    expect(progressOf(after)).toMatchObject({ state: "done", done: 3, total: 3, error: null });
    expect(after.status).toBe("calculated");
    // The claim is given back, so the next calculation is free to start.
    expect(after.calcClaim).toBeNull();
  });

  it("never runs twice at once: a second worker is told the run is busy", async () => {
    const run = await runOfMonth("2026-09");
    await queueRunCalculation(run.id);
    // A live claim younger than the stale window belongs to somebody.
    await db().update(schema.payrollRun).set({ calcState: "running", calcClaim: crypto.randomUUID(), calcHeartbeatAt: new Date() }).where(eq(schema.payrollRun.id, run.id));
    expect(await workOneRun(run.id)).toMatchObject({ outcome: "busy" });
    await expect(queueRunCalculation(run.id)).rejects.toThrow("run_calculating");
  });

  it("takes over a calculation whose server died, and the job needs nobody to ask", async () => {
    const run = await runOfMonth("2026-09");
    // The claim stopped beating twenty minutes ago: its server is gone.
    await db()
      .update(schema.payrollRun)
      .set({ calcState: "running", calcClaim: crypto.randomUUID(), calcHeartbeatAt: sql`now() - interval '20 minutes'` })
      .where(eq(schema.payrollRun.id, run.id));

    expect(await payrollCalculateJob.run({ today: "2026-10-01" })).toMatchObject({ calculated: 1, failed: 0 });
    expect(progressOf(await getRun(run.id))).toMatchObject({ state: "done", done: 3 });
    // Run again with nothing waiting: it does nothing at all (idempotent).
    expect(await payrollCalculateJob.run({ today: "2026-10-01" })).toMatchObject({ calculated: 0, busy: 0, failed: 0 });
  });

  it("records why a calculation would not run, without saying anything about anyone's pay", async () => {
    // October has no locked timesheet: there is nothing to pay on (FR-PAY-10).
    const run = await createRegularRun({ entityId: ids.entity, month: "2026-10" }, ids.actor);
    await queueRunCalculation(run.id);
    const outcome = await workOneRun(run.id);
    expect(outcome).toMatchObject({ outcome: "failed", error: "timesheet_not_locked" });

    const failed = await getRun(run.id);
    expect(progressOf(failed)).toMatchObject({ state: "failed", error: "timesheet_not_locked" });
    expect(failed.status).toBe("draft");
    expect(failed.calcError).not.toMatch(/\d{7,}/);
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, run.id));
  });

  it("refuses to recalculate a run that has been put forward", async () => {
    const run = await runOfMonth("2026-09");
    await stepRun(run.id, "propose", { personId: ids.actor });
    await expect(queueRunCalculation(run.id)).rejects.toThrow("run_not_editable");
    // …and a calculation cannot sneak in under a proposal either.
    await db().update(schema.payrollRun).set({ calcState: "queued" }).where(eq(schema.payrollRun.id, run.id));
    expect(await workOneRun(run.id)).toMatchObject({ outcome: "busy" });
    await db().update(schema.payrollRun).set({ calcState: "done" }).where(eq(schema.payrollRun.id, run.id));
  });
});

describe("what other modules are told (FR-OPS-10)", () => {
  it("reports how far each entity's month has got — statuses and dates, never a figure", async () => {
    const milestones = await listRunMilestones({ entityIds: [ids.entity], months: ["2026-07", "2026-08", "2026-09"] });
    const july = milestones.find((row) => row.month === "2026-07")!;
    expect(july).toMatchObject({ entityId: ids.entity, status: "locked" });
    expect(july.paidAt).toBeInstanceOf(Date);
    expect(Object.keys(july).sort()).toEqual(["approvedAt", "entityId", "lockedAt", "month", "paidAt", "payslipsPublishedAt", "proposedAt", "status"]);
    expect(milestones.find((row) => row.month === "2026-09")?.status).toBe("proposed");
  });

  it("leaves out cancelled runs and asks for nothing when nothing is asked about", async () => {
    expect(await listRunMilestones({ entityIds: [] })).toEqual([]);
    expect((await listRunMilestones({ entityIds: [ids.other] })).every((row) => row.status !== "cancelled")).toBe(true);
  });
});
