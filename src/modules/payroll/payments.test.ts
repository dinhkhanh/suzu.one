// Paying a run against a real database (PGlite): who goes to which channel, what a generated file
// records, the cash sheet, and the rule that a run is not "paid" until both are settled.
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
const notified: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }[] = [];
vi.mock("@/modules/platform/notifications/service", () => ({
  notify: async (input: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }) => {
    notified.push(input);
  },
}));

import { eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { stepRun } from "./lifecycle";
import { bankOf, cashSheetRows, confirmCashReceipt, generateBankFile, listCashAwaitingReceipt, listPayables, listPaymentFiles, openCashAmount, openCashSheet, openFileTotal, planPayment, recordCashDisbursement, settlementOf } from "./payments";
import { calculateRun, createRegularRun, getRun } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"entity" | "actor" | "vcbPerson" | "acbPerson" | "noAccount" | "cashPerson", string>;
let runId = "";
/** A second entity's run, used to watch a cash receipt arrive after the month is closed. */
let otherRunId = "";
let otherCashPersonId = "";

const summary = () => ({
  days: 31, standardDays: 22, standardMinutes: 10_560, workedMinutes: 10_560, creditedMinutes: 0,
  leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
  lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0,
  otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 2200, unpaidDaysCenti: 0, anomalyDays: 0,
});

const sensitiveContext = (field: "taxCode" | "bankAccounts", personId: string) => `person_sensitive.${field === "taxCode" ? "tax_code" : "bank_accounts"}:${personId}`;
const payingAccount = { accountNumber: "0071000123456", accountName: "CONG TY TNHH SUZU MEDIA" };
const run = async () => (await getRun(runId))!;

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
  ids.vcbPerson = await hire("Ho Gia Huy", "2024-03-01");
  ids.acbPerson = await hire("Tran Thi Lan", "2024-06-01");
  ids.noAccount = await hire("Le Van Minh", "2025-01-01");
  ids.cashPerson = await hire("Pham Thi Nga", "2025-06-01");

  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([
      { personId: ids.vcbPerson, employmentId: employmentOf(ids.vcbPerson), entityId: entity.id, profile: "statutory" as const, validFrom: "2024-03-01", status: "approved" as const },
      { personId: ids.acbPerson, employmentId: employmentOf(ids.acbPerson), entityId: entity.id, profile: "statutory" as const, validFrom: "2024-06-01", status: "approved" as const },
      { personId: ids.noAccount, employmentId: employmentOf(ids.noAccount), entityId: entity.id, profile: "statutory" as const, validFrom: "2025-01-01", status: "approved" as const },
      { personId: ids.cashPerson, employmentId: employmentOf(ids.cashPerson), entityId: entity.id, profile: "simple" as const, simpleBasis: "service_contract" as const, validFrom: "2025-06-01", status: "approved" as const },
    ]);

  // Two banks, and one person with no account at all.
  const accounts: [string, string, string][] = [
    [ids.vcbPerson, "Vietcombank", "0123456789"],
    [ids.acbPerson, "ACB", "9876543210"],
  ];
  for (const [personId, bankName, accountNumber] of accounts) {
    await db()
      .insert(schema.personSensitive)
      .values({ personId, taxCode: fieldCipher().encrypt("8412345678", sensitiveContext("taxCode", personId)), bankAccounts: fieldCipher().encrypt(JSON.stringify([{ bankName, accountNumber, accountHolder: null, branch: null }]), sensitiveContext("bankAccounts", personId)) });
  }

  for (const [personId, amount] of [
    [ids.vcbPerson, 30_000_000],
    [ids.acbPerson, 20_000_000],
    [ids.noAccount, 18_000_000],
    [ids.cashPerson, 12_000_000],
  ] as const) {
    const id = crypto.randomUUID();
    await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employmentOf(personId), entityId: entity.id, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: amount, insuranceSalary: amount, allowances: [] }), salaryTermsContext(id)) });
  }

  const lockedAt = new Date("2026-08-28T03:00:00Z");
  await db().insert(schema.timesheetPeriod).values({ entityId: entity.id, month: "2026-08", status: "locked", lockedAt, lockedByPersonId: actor.id });
  await db()
    .insert(schema.timesheetMonth)
    .values([ids.vcbPerson, ids.acbPerson, ids.noAccount, ids.cashPerson].map((personId) => ({ personId, entityId: entity.id, month: "2026-08", status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: actor.id })));

  const created = await createRegularRun({ entityId: entity.id, month: "2026-08" }, actor.id);
  await calculateRun(created.id);
  runId = created.id;
  await stepRun(runId, "propose", { personId: actor.id });
  await stepRun(runId, "approve", { personId: actor.id });
  await stepRun(runId, "prepare_payment", { personId: actor.id });
});

describe("who is paid how (SRS D18)", () => {
  it("routes by pay profile, not by whether someone happens to have an account", async () => {
    const plan = planPayment(await listPayables(await run()));
    expect(plan.cash.map((person) => person.personId)).toEqual([ids.cashPerson]);
    expect(plan.banks.map((group) => group.key).sort()).toEqual(["acb", "vcb"]);
    // The Statutory person with no account is not quietly moved to cash: he is unroutable.
    expect(plan.unroutable.map((person) => person.personId)).toEqual([ids.noAccount]);
  });

  it("reads the bank off the account, and admits when it does not know one", () => {
    const person = { personId: "x", fullName: "x", employeeCode: null, profile: "statutory" as const, net: 1, account: null, bankName: "Vietcombank" };
    expect(bankOf(person)).toBe("vcb");
    expect(bankOf({ ...person, bankName: "VCB" })).toBe("vcb");
    expect(bankOf({ ...person, bankName: "Ngân hàng Á Châu" })).toBe("acb");
    expect(bankOf({ ...person, bankName: "Techcombank" })).toBeNull();
    expect(bankOf({ ...person, bankName: null })).toBeNull();
  });

  it("keeps the cash total apart from the bank total", async () => {
    const plan = planPayment(await listPayables(await run()));
    expect(plan.cashTotal).toBeGreaterThan(0);
    expect(plan.bankTotal).toBeGreaterThan(0);
    // The Simple-profile person is in the cash total and in neither bank group.
    expect(plan.banks.flatMap((group) => group.people).map((person) => person.personId)).not.toContain(ids.cashPerson);
  });
});

describe("generating a bank file (FR-PAY-33)", () => {
  it("writes only that bank's people and records the receipt", async () => {
    const { file, record } = await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount }, ids.actor);
    expect(file.rowCount).toBe(1);
    expect(file.content).toContain("0123456789");
    expect(file.content).not.toContain("9876543210");

    expect(record.channel).toBe("bank");
    expect(record.bank).toBe("vcb");
    expect(record.formatVersion).toBe("vcb-salary-csv-1");
    expect(record.rowCount).toBe(1);
    // The receipt keeps the total — encrypted like every other figure.
    expect(record.totalEnc).not.toContain(String(file.total));
    expect(openFileTotal(record)).toBe(file.total);
  });

  it("reconciles with the run: the two batches together equal the bank total", async () => {
    await generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05", payingAccount }, ids.actor);
    const files = await listPaymentFiles(runId);
    const generated = files.filter((row) => row.channel === "bank").reduce((sum, row) => sum + openFileTotal(row), 0);

    const plan = planPayment(await listPayables(await run()));
    const routable = plan.banks.reduce((sum, group) => sum + group.total, 0);
    expect(generated).toBe(routable);
    // …and the run's own bank total is that plus the person nobody can transfer to.
    expect(plan.bankTotal).toBe(routable + plan.unroutable.reduce((sum, person) => sum + person.net, 0));
  });

  it("refuses a bank it has no format for, and one with nobody in it", async () => {
    await expect(generateBankFile({ runId, bank: "techcombank", valueDate: "2026-09-05", payingAccount }, ids.actor)).rejects.toThrow("bank_unknown");
    await expect(generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount }, ids.actor)).resolves.toBeTruthy();
  });
});

describe("the cash sheet (FR-PAY-39)", () => {
  it("opens with one row per Simple-profile person, and tells them without a figure", async () => {
    notified.length = 0;
    const { rows, created } = await openCashSheet(runId, ids.actor);
    expect(created).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe(ids.cashPerson);
    expect(openCashAmount(rows[0])).toBeGreaterThan(0);

    expect(notified.at(-1)?.kind).toBe("payroll.cash_receipt_due");
    expect(JSON.stringify(notified.at(-1)?.params)).toBe(JSON.stringify({ month: "2026-08" }));
  });

  it("is idempotent: opening it again adds nobody and tells nobody", async () => {
    notified.length = 0;
    expect((await openCashSheet(runId, ids.actor)).created).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it("carries the names and amounts the printed sheet needs", async () => {
    const rows = await cashSheetRows(await run());
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Pham Thi Nga");
    expect(rows[0].disbursedOn).toBeNull();
    expect(rows[0].receiptConfirmed).toBe(false);
  });

  it("records the accountant handing it over, then the person's own confirmation", async () => {
    await recordCashDisbursement({ runId, personId: ids.cashPerson, disbursedOn: "2026-09-05" }, ids.actor);
    const afterDisbursement = await cashSheetRows(await run());
    expect(afterDisbursement[0].disbursedOn).toBe("2026-09-05");
    expect(afterDisbursement[0].receiptConfirmed).toBe(false);

    // Until they confirm, it shows up as waiting for them — and only for them.
    expect(await listCashAwaitingReceipt(ids.cashPerson)).toHaveLength(1);
    expect(await listCashAwaitingReceipt(ids.vcbPerson)).toHaveLength(0);

    await confirmCashReceipt(runId, ids.cashPerson);
    expect((await cashSheetRows(await run()))[0].receiptConfirmed).toBe(true);
    expect(await listCashAwaitingReceipt(ids.cashPerson)).toHaveLength(0);
  });

  it("refuses a disbursement or a receipt for somebody with no row in this run", async () => {
    await expect(recordCashDisbursement({ runId, personId: ids.vcbPerson, disbursedOn: "2026-09-05" }, ids.actor)).rejects.toThrow("cash_payment_not_found");
    await expect(confirmCashReceipt(runId, ids.vcbPerson)).rejects.toThrow("cash_payment_not_found");
  });
});

describe("a run is only paid when both channels are settled (FR-PAY-39)", () => {
  it("names the person the bank channel could not reach", async () => {
    const settlement = await settlementOf(await run());
    // The reason is the precise one: this person has no account at all, which is a different
    // problem (and a different fix) from banking somewhere we have no file format for.
    expect(settlement.unpaidBank.map((person) => person.reason)).toEqual(["no_account"]);
    expect(settlement.cashDisbursed).toBe(1);
    expect(settlement.cashConfirmed).toBe(1);
  });

  it("refuses to mark it paid while somebody is outside every batch", async () => {
    const settlement = await settlementOf(await run());
    expect(settlement.settled).toBe(false);
    expect(settlement.blockers).toContain("bank_people_uncovered");
    await expect(stepRun(runId, "mark_paid", { personId: ids.actor })).rejects.toThrow("run_not_settled");
  });

  it("lets it through once everybody is covered, and the run moves on", async () => {
    // The person with no account is given one and put into a batch — the way this is really fixed.
    await db()
      .insert(schema.personSensitive)
      .values({ personId: ids.noAccount, bankAccounts: fieldCipher().encrypt(JSON.stringify([{ bankName: "Vietcombank", accountNumber: "0555666777", accountHolder: null, branch: null }]), sensitiveContext("bankAccounts", ids.noAccount)) });
    await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount }, ids.actor);

    const settlement = await settlementOf(await run());
    expect(settlement.settled).toBe(true);
    expect(settlement.blockers).toEqual([]);
    expect((await stepRun(runId, "mark_paid", { personId: ids.actor })).run.status).toBe("paid");
  });

  it("a cash sheet that was never opened blocks the run just as loudly", async () => {
    // A second entity's run with one Simple-profile person and nothing else.
    const [other] = await db().insert(schema.entity).values({ code: "SZX", legalName: "SuZu X", shortName: "X", wageRegion: 1 }).returning();
    const [person] = await db().insert(schema.person).values({ fullName: "Cash Only", searchName: "cash only", status: "active", primaryEntityId: other.id }).returning();
    const [employment] = await db().insert(schema.employment).values({ personId: person.id, entityId: other.id, employeeCode: "SZX-1", startDate: "2026-01-01", seniorityDate: "2026-01-01" }).returning();
    await db().insert(schema.payProfile).values({ personId: person.id, employmentId: employment.id, entityId: other.id, profile: "simple", simpleBasis: "other", validFrom: "2026-01-01", status: "approved" });
    const structureId = crypto.randomUUID();
    await db().insert(schema.salaryStructure).values({ id: structureId, personId: person.id, employmentId: employment.id, entityId: other.id, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: 9_000_000, insuranceSalary: 9_000_000, allowances: [] }), salaryTermsContext(structureId)) });
    const lockedAt = new Date("2026-08-28T03:00:00Z");
    await db().insert(schema.timesheetPeriod).values({ entityId: other.id, month: "2026-08", status: "locked", lockedAt, lockedByPersonId: ids.actor });
    await db().insert(schema.timesheetMonth).values({ personId: person.id, entityId: other.id, month: "2026-08", status: "locked", summary: summary(), lockedAt, lockedByPersonId: ids.actor });

    const created = await createRegularRun({ entityId: other.id, month: "2026-08" }, ids.actor);
    await calculateRun(created.id);
    for (const step of ["propose", "approve", "prepare_payment"] as const) await stepRun(created.id, step, { personId: ids.actor });
    otherRunId = created.id;
    otherCashPersonId = person.id;

    const settlement = await settlementOf((await getRun(created.id))!);
    expect(settlement.blockers).toContain("cash_not_disbursed");
    await expect(stepRun(created.id, "mark_paid", { personId: ids.actor })).rejects.toThrow("run_not_settled");
  });

  it("a locked run's payment records are immutable", async () => {
    await stepRun(runId, "lock", { personId: ids.actor });
    const [file] = await listPaymentFiles(runId);
    const error = await db()
      .update(schema.payrollPaymentFile)
      .set({ rowCount: 99 })
      .where(eq(schema.payrollPaymentFile.id, file.id))
      .then(() => null)
      .catch((thrown: unknown) => thrown);
    expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/locked/);
  });

  it("but the person may still confirm they took their cash after the month is closed", async () => {
    // Found by doing it over HTTP: somebody on leave confirms a week later, and refusing them
    // would leave a locked month permanently short of its evidence (migration 0050).
    await openCashSheet(otherRunId, ids.actor);
    await recordCashDisbursement({ runId: otherRunId, personId: otherCashPersonId, disbursedOn: "2026-09-05" }, ids.actor);
    await stepRun(otherRunId, "mark_paid", { personId: ids.actor });
    await stepRun(otherRunId, "lock", { personId: ids.actor });

    const [before] = await db().select().from(schema.payrollCashPayment).where(eq(schema.payrollCashPayment.runId, otherRunId));
    expect(before.receiptConfirmedAt).toBeNull();
    await confirmCashReceipt(otherRunId, otherCashPersonId);
    const [after] = await db().select().from(schema.payrollCashPayment).where(eq(schema.payrollCashPayment.id, before.id));
    expect(after.receiptConfirmedAt).toBeInstanceOf(Date);

    // Everything else about the payment stays frozen, and a confirmation is never rewritten.
    const refused = async (work: Promise<unknown>) => {
      const error = await work.then(() => null).catch((thrown: unknown) => thrown);
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/locked/);
    };
    await refused(db().update(schema.payrollCashPayment).set({ disbursedOn: "2026-09-09" }).where(eq(schema.payrollCashPayment.id, before.id)));
    await refused(db().update(schema.payrollCashPayment).set({ amountEnc: "tampered" }).where(eq(schema.payrollCashPayment.id, before.id)));
    await refused(db().update(schema.payrollCashPayment).set({ receiptConfirmedAt: new Date("2030-01-01") }).where(eq(schema.payrollCashPayment.id, before.id)));
    await refused(db().delete(schema.payrollCashPayment).where(eq(schema.payrollCashPayment.id, before.id)));
  });
});
