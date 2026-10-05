// "A run can always be brought to paid" (inspection PAY-05) and the cash sheet's real amounts
// (FR-PAY-39), against a real database (PGlite). The cases are the everyday ones that used to
// leave a month stuck: somebody banking outside Vietcombank and ACB, a net of zero, a negative
// net, an account fixed after the first file was made — and the way out when no file can help.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
}));
// A negative net is refused at proposal (`run-readiness.ts`, PAY-03, tested there). Payment still
// has to treat one safely if it ever arrives — an older run, a later engine — so this file lets
// its run past that one check to put a negative net in front of the payment code.
vi.mock("./run-readiness", async (importOriginal) => {
  const original = await importOriginal<typeof import("./run-readiness")>();
  return { ...original, getRunReadiness: async () => original.READY };
});
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
vi.mock("@/modules/platform/notifications/service", () => ({ notify: async () => {} }));

import { and, eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { saveEntityBankAccount } from "@/modules/platform/org/service";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { stepRun } from "./lifecycle";
import {
  CASH_SHEET_SCAN,
  cashSheetScanOwner,
  generateBankFile,
  latestBankFiles,
  listCashAwaitingReceipt,
  listCashPayments,
  listCashSheetScans,
  listOtherPayments,
  listPayables,
  listPaymentFiles,
  openCashAmount,
  openCashDisbursed,
  openCashSheet,
  planPayment,
  recordCashDisbursement,
  recordOtherPayment,
  removeOtherPayment,
  routeOf,
  settle,
  settlementOf,
} from "./payments";
import { calculateRun, createRegularRun, getRun, setRunInput } from "./runs";
import { payComponentSeedRows } from "./seed-components";

type Who = "vcb" | "elsewhere" | "noAccount" | "badAccount" | "zeroNet" | "negative" | "cashA" | "cashB";
const ids = {} as Record<"entity" | "actor" | Who, string>;
let runId = "";

const summary = () => ({
  days: 31, standardDays: 22, standardMinutes: 10_560, workedMinutes: 10_560, creditedMinutes: 0,
  leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
  lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0,
  otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 2200, unpaidDaysCenti: 0, anomalyDays: 0,
});

const bankAccountsContext = (personId: string) => `person_sensitive.bank_accounts:${personId}`;
const sealAccount = (personId: string, bankName: string, accountNumber: string) => fieldCipher().encrypt(JSON.stringify([{ bankName, accountNumber, accountHolder: null, branch: null }]), bankAccountsContext(personId));
const typedAccount = { accountNumber: "0071000123456", accountName: "CONG TY TNHH SUZU MEDIA" };
const run = async () => (await getRun(runId))!;
const settlement = async () => settlementOf(await run());
const stateOf = async (who: Who) => (await settlement()).people.find((person) => person.personId === ids[who])!.state;

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const people: [Who, string, "statutory" | "simple"][] = [
    ["vcb", "An Van Vcb", "statutory"],
    ["elsewhere", "Binh Thi Techcom", "statutory"],
    ["noAccount", "Cuong Van Khong", "statutory"],
    ["badAccount", "Dung Thi Sai", "statutory"],
    ["zeroNet", "Em Thi Thai San", "statutory"],
    ["negative", "Giang Van Am", "statutory"],
    ["cashA", "Hoa Thi Mat", "simple"],
    ["cashB", "Khanh Van Mat", "simple"],
  ];
  for (const [who, name] of people) {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${who.toLowerCase()}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate: "2024-03-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    ids[who] = person.id;
  }

  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values(people.map(([who, , profile]) => ({ personId: ids[who], employmentId: employmentOf(ids[who]), entityId: entity.id, profile, simpleBasis: profile === "simple" ? ("service_contract" as const) : null, validFrom: "2024-03-01", status: "approved" as const })));

  // Vietcombank; a bank we have no file format for; nothing at all; an account that is not a number.
  const accounts: [Who, string, string][] = [
    ["vcb", "Vietcombank", "0123456789"],
    ["elsewhere", "Techcombank", "1903000111222"],
    ["badAccount", "ACB", "12AB-99"],
    ["zeroNet", "Vietcombank", "0444555666"],
    ["negative", "Vietcombank", "0777888999"],
  ];
  for (const [who, bankName, accountNumber] of accounts) await db().insert(schema.personSensitive).values({ personId: ids[who], bankAccounts: sealAccount(ids[who], bankName, accountNumber) });

  for (const [who] of people) {
    const id = crypto.randomUUID();
    await db().insert(schema.salaryStructure).values({ id, personId: ids[who], employmentId: employmentOf(ids[who]), entityId: entity.id, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify({ baseSalary: 20_000_000, insuranceSalary: 20_000_000, allowances: [] }), salaryTermsContext(id)) });
  }

  const lockedAt = new Date("2026-08-28T03:00:00Z");
  await db().insert(schema.timesheetPeriod).values({ entityId: entity.id, month: "2026-08", status: "locked", lockedAt, lockedByPersonId: actor.id });
  await db().insert(schema.timesheetMonth).values(people.map(([who]) => ({ personId: ids[who], entityId: entity.id, month: "2026-08", status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: actor.id })));

  const created = await createRegularRun({ entityId: entity.id, month: "2026-08" }, actor.id);
  runId = created.id;
  await calculateRun(runId);
  // One person's advance is exactly what she would have taken home, another's is more than that:
  // a net of zero and a negative net, the two figures that used to be "skipped" by every file.
  const netOf = new Map((await listPayables(await run())).map((person) => [person.personId, person.net]));
  await setRunInput({ runId, personId: ids.zeroNet, code: "ADVANCE", amount: netOf.get(ids.zeroNet)! }, actor.id);
  await setRunInput({ runId, personId: ids.negative, code: "ADVANCE", amount: netOf.get(ids.negative)! + 3_000_000 }, actor.id);
  await calculateRun(runId);
  for (const step of ["propose", "approve", "prepare_payment"] as const) await stepRun(runId, step, { personId: actor.id });
});

describe("who goes into which file, and why (FR-PAY-33)", () => {
  it("sends a person to their own bank's file, and anyone banking elsewhere through the interbank format", async () => {
    const payables = await listPayables(await run());
    const routeFor = (who: Who) => routeOf(payables.find((person) => person.personId === ids[who])!);
    expect(routeFor("vcb")).toEqual({ channel: "bank", bank: "vcb", via: "own_bank" });
    // Techcombank has no format of its own: ACB's layout carries a beneficiary bank, VCB's does not.
    expect(routeFor("elsewhere")).toEqual({ channel: "bank", bank: "acb", via: "interbank" });
    expect(routeFor("noAccount")).toEqual({ channel: "none", reason: "no_account" });
    expect(routeFor("cashA")).toEqual({ channel: "cash" });

    const plan = planPayment(payables);
    expect(plan.banks.map((group) => [group.key, group.people.length, group.interbank])).toEqual([
      ["vcb", 1, 0],
      ["acb", 2, 1],
    ]);
    expect(plan.unroutable.map((person) => person.personId)).toEqual([ids.noAccount]);
  });

  it("keeps people who are owed nothing out of every channel", async () => {
    const plan = planPayment(await listPayables(await run()));
    expect(plan.nothingOwed.map((person) => [person.personId, person.net])).toEqual([[ids.zeroNet, 0]]);
    expect(plan.negative.map((person) => person.personId)).toEqual([ids.negative]);
    expect(plan.negative[0].net).toBe(-3_000_000);
    // Neither is in a bank group, and the negative figure does not shrink what the bank is owed.
    expect(plan.banks.flatMap((group) => group.people).map((person) => person.personId)).not.toContain(ids.zeroNet);
    expect(plan.bankTotal).toBe([...plan.banks.flatMap((group) => group.people), ...plan.unroutable].reduce((sum, person) => sum + person.net, 0));
  });

  it("an interbank row names the other bank; a zero or negative net is never handed to a format", async () => {
    const vcb = await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    // Three people bank with Vietcombank; only the one who is owed money is in the batch — and
    // the other two are not "skipped" either, because they were never a payment problem.
    expect(vcb.file.rowCount).toBe(1);
    expect(vcb.file.skipped).toEqual([]);
    expect(vcb.record.skippedCount).toBe(0);
    expect(vcb.record.coveredPersonIds).toEqual([ids.vcb]);

    const acb = await generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    expect(acb.file.content).toContain("1903000111222");
    expect(acb.file.content).toContain("TECHCOMBANK");
    // The account that is not a number is reported by name, and left out of what the file covers.
    expect(acb.file.skipped.map((row) => [row.personId, row.reason])).toEqual([[ids.badAccount, "account_not_numeric"]]);
    expect(acb.record.coveredPersonIds).toEqual([ids.elsewhere]);
  });
});

describe("only the latest file of a bank counts (PAY-05)", () => {
  it("says who is still outside every batch, and nothing about the people owed nothing", async () => {
    const now = await settlement();
    expect(now.blockers).toContain("bank_people_uncovered");
    expect(now.blockers).not.toContain("bank_file_missing");
    expect(now.unpaidBank.map((person) => [person.personId, person.reason]).sort()).toEqual(
      [
        [ids.noAccount, "no_account"],
        [ids.badAccount, "account_not_numeric"],
      ].sort(),
    );
    expect(await stateOf("zeroNet")).toBe("nothing_owed");
    expect(await stateOf("negative")).toBe("negative_net");
    expect(await stateOf("elsewhere")).toBe("in_file");
  });

  it("a regenerated file supersedes the one before it — the old file's skip no longer blocks", async () => {
    // HR corrects the account; the accountant builds the ACB batch again.
    await db().update(schema.personSensitive).set({ bankAccounts: sealAccount(ids.badAccount, "ACB", "9876543210") }).where(eq(schema.personSensitive.personId, ids.badAccount));
    // Until then she is waiting for a batch: the one that exists does not hold her.
    expect(await stateOf("badAccount")).toBe("awaiting_file");

    const again = await generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    expect(again.record.skippedCount).toBe(0);

    const files = await listPaymentFiles(runId);
    const acbFiles = files.filter((file) => file.bank === "acb");
    expect(acbFiles).toHaveLength(2);
    // The first ACB file still says it skipped one person. It is superseded, and counts for nothing.
    expect(acbFiles[0].skippedCount).toBe(1);
    expect(latestBankFiles(files).get("acb")!.id).toBe(again.record.id);

    const now = await settlement();
    expect(now.latestFileIds).not.toContain(acbFiles[0].id);
    expect(await stateOf("badAccount")).toBe("in_file");
    expect(now.unpaidBank.map((person) => person.personId)).toEqual([ids.noAccount]);
  });
});

describe("paid another way (PAY-05)", () => {
  it("needs a reference and a reason, and is only for somebody the bank channel owes money", async () => {
    const base = { runId, personId: ids.noAccount, paidOn: "2026-09-05" };
    await expect(recordOtherPayment({ ...base, reference: "  ", reason: "Chưa có tài khoản" }, ids.actor)).rejects.toThrow("reference_required");
    await expect(recordOtherPayment({ ...base, reference: "FT26248123456", reason: "" }, ids.actor)).rejects.toThrow("reason_required");
    // Cash has its own sheet; a net of zero or below is not a payment at all.
    for (const who of ["cashA", "zeroNet", "negative"] as const) {
      await expect(recordOtherPayment({ ...base, personId: ids[who], reference: "FT1", reason: "x" }, ids.actor)).rejects.toThrow("other_payment_not_applicable");
    }
  });

  it("settles the person no file can carry, so the bank side no longer blocks", async () => {
    const row = await recordOtherPayment({ runId, personId: ids.noAccount, paidOn: "2026-09-05", reference: "FT26248123456", reason: "Chưa có tài khoản — chuyển khoản lẻ cho người thân theo giấy ủy quyền" }, ids.actor);
    expect(row.recordedByPersonId).toBe(ids.actor);
    expect(row.entityId).toBe(ids.entity);

    const now = await settlement();
    expect(await stateOf("noAccount")).toBe("paid_other");
    expect(now.unpaidBank).toEqual([]);
    expect(now.paidAnotherWay).toBe(1);
    expect(now.bankCovered).toBe(now.bankPeople);
    expect(now.blockers.filter((blocker) => blocker.startsWith("bank_"))).toEqual([]);
  });

  it("recording it again corrects it; taking it back brings the blocker back", async () => {
    await recordOtherPayment({ runId, personId: ids.noAccount, paidOn: "2026-09-06", reference: "FT26249000001", reason: "Ghi nhầm ngày" }, ids.actor);
    const rows = await listOtherPayments(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].paidOn).toBe("2026-09-06");

    await removeOtherPayment(runId, ids.noAccount);
    expect((await settlement()).blockers).toContain("bank_people_uncovered");
    await expect(removeOtherPayment(runId, ids.noAccount)).rejects.toThrow("other_payment_not_found");
    await recordOtherPayment({ runId, personId: ids.noAccount, paidOn: "2026-09-05", reference: "FT26248123456", reason: "Chưa có tài khoản" }, ids.actor);
  });

  it("keeps somebody paid another way out of a batch generated afterwards", async () => {
    await recordOtherPayment({ runId, personId: ids.elsewhere, paidOn: "2026-09-05", reference: "FT26248999999", reason: "Ngân hàng trả lại dòng liên ngân hàng" }, ids.actor);
    const file = await generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    expect(file.file.content).not.toContain("1903000111222");
    expect(file.record.coveredPersonIds).toEqual([ids.badAccount]);
    expect(await stateOf("elsewhere")).toBe("paid_other");

    // The mark is taken back: she is in no batch that counts, until one is generated again.
    await removeOtherPayment(runId, ids.elsewhere);
    expect(await stateOf("elsewhere")).toBe("awaiting_file");
    expect((await settlement()).blockers).toContain("bank_people_uncovered");
    await generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    expect(await stateOf("elsewhere")).toBe("in_file");
  });
});

describe("the entity's paying accounts (FR-PLT-11, FR-PAY-33)", () => {
  it("still takes a typed account while the entity has none configured at the bank — but takes one", async () => {
    await expect(generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05" }, ids.actor)).rejects.toThrow("paying_account_required");
    const { record } = await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount: typedAccount }, ids.actor);
    expect(record.payingAccountId).toBeNull();
  });

  it("picks from the entity's accounts once it has some: the default unless another is chosen, never a typed one", async () => {
    const { after: first } = await saveEntityBankAccount(ids.entity, null, { bank: "vcb", accountNumber: "0071 000 123 456", accountName: "CONG TY TNHH SUZU MEDIA", branch: "CN TP.HCM", isDefault: false, isActive: true });
    const { after: second } = await saveEntityBankAccount(ids.entity, null, { bank: "vcb", accountNumber: "0071000999888", accountName: "CONG TY TNHH SUZU MEDIA", branch: null, isDefault: false, isActive: true });

    const byDefault = await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccount: { accountNumber: "9999999999", accountName: "SOMEBODY ELSE" } }, ids.actor);
    expect(byDefault.record.payingAccountId).toBe(first.id);
    const chosen = await generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccountId: second.id }, ids.actor);
    expect(chosen.record.payingAccountId).toBe(second.id);
    await expect(generateBankFile({ runId, bank: "vcb", valueDate: "2026-09-05", payingAccountId: crypto.randomUUID() }, ids.actor)).rejects.toThrow("paying_account_not_found");
    // Accounts at Vietcombank say nothing about ACB: that bank still has none, and is still typed.
    await expect(generateBankFile({ runId, bank: "acb", valueDate: "2026-09-05" }, ids.actor)).rejects.toThrow("paying_account_required");
  });
});

describe("the cash sheet records what was actually handed over (FR-PAY-39)", () => {
  const cashRow = async (who: Who) => (await db().select().from(schema.payrollCashPayment).where(and(eq(schema.payrollCashPayment.runId, runId), eq(schema.payrollCashPayment.personId, ids[who]))))[0];

  it("opens with the two people on the Simple profile and blocks until they are paid", async () => {
    expect((await settlement()).blockers).toEqual(["cash_not_disbursed"]);
    const { rows } = await openCashSheet(runId, ids.actor);
    expect(rows.map((row) => row.personId).sort()).toEqual([ids.cashA, ids.cashB].sort());
    expect((await settlement()).blockers).toEqual(["cash_not_disbursed"]);
  });

  it("defaults the amount to the person's net", async () => {
    const row = await recordCashDisbursement({ runId, personId: ids.cashA, disbursedOn: "2026-09-05" }, ids.actor);
    expect(openCashDisbursed(row)).toBe(openCashAmount(row));
    // The figure is sealed against its own context, like the net beside it.
    expect(row.disbursedAmountEnc).not.toContain(String(openCashAmount(row)));
  });

  it("refuses a different amount without a note, and takes it with one", async () => {
    const net = openCashAmount(await cashRow("cashB"));
    await expect(recordCashDisbursement({ runId, personId: ids.cashB, disbursedOn: "2026-09-05", amount: net - 2_000_000 }, ids.actor)).rejects.toThrow("cash_difference_needs_note");
    await expect(recordCashDisbursement({ runId, personId: ids.cashB, disbursedOn: "2026-09-05", amount: -1, note: "x" }, ids.actor)).rejects.toThrow("amount_invalid");

    const row = await recordCashDisbursement({ runId, personId: ids.cashB, disbursedOn: "2026-09-05", amount: net - 2_000_000, note: "Đã ứng 2.000.000 đ ngày 20/8" }, ids.actor);
    expect(openCashDisbursed(row)).toBe(net - 2_000_000);
    expect(row.disbursementNote).toContain("ứng");
    // What the person is asked to confirm having taken is what was handed over, not the net.
    expect((await listCashAwaitingReceipt(ids.cashB)).map((waiting) => waiting.amount)).toEqual([net - 2_000_000]);
  });

  it("reconciles disbursed against net, and lets the run be paid", async () => {
    const now = await settlement();
    expect(now.cashDisbursed).toBe(2);
    expect(now.cashNet - now.cashDisbursedTotal).toBe(2_000_000);
    expect(now.blockers).toEqual([]);
    expect(now.settled).toBe(true);
    expect((await stepRun(runId, "mark_paid", { personId: ids.actor })).run.status).toBe("paid");
  });

  it("a difference with neither a note nor the person's confirmation does not settle", async () => {
    const [payables, files, cash, others] = await Promise.all([listPayables(await run()), listPaymentFiles(runId), listCashPayments(runId), listOtherPayments(runId)]);
    // The service never stores this; the rule is checked on a row as it would look if something did.
    const doctored = cash.map((row) => (row.personId === ids.cashB ? { ...row, disbursementNote: null } : row));
    expect(settle(planPayment(payables), files, doctored, others).blockers).toEqual(["cash_difference_unexplained"]);
    const confirmed = doctored.map((row) => (row.personId === ids.cashB ? { ...row, receiptConfirmedAt: new Date() } : row));
    expect(settle(planPayment(payables), files, confirmed, others).blockers).toEqual([]);
    // A row disbursed before the amount was recorded separately reads as paid in full.
    expect(openCashDisbursed({ ...cash[0], disbursedAmountEnc: null })).toBe(openCashAmount(cash[0]));
  });

  it("holds the signed sheet's scan against the run, at the compensation tier", async () => {
    const owner = cashSheetScanOwner(await run());
    expect(owner).toEqual({ ownerType: CASH_SHEET_SCAN, ownerId: runId, entityId: ids.entity, tier: "compensation" });
    await db().insert(schema.storedFile).values({ bucket: "suzu-private", objectPath: `${CASH_SHEET_SCAN}/2026/sheet.pdf`, fileName: "bang-chi-thang-8.pdf", contentType: "application/pdf", sizeBytes: 1000, status: "ready", uploadedByPersonId: ids.actor, ...owner });
    const scans = await listCashSheetScans(runId);
    expect(scans.map((file) => [file.fileName, file.tier])).toEqual([["bang-chi-thang-8.pdf", "compensation"]]);
  });
});

describe("once paid and locked, how it was paid is evidence", () => {
  const refused = async (work: Promise<unknown>) => {
    const error = await work.then(() => null).catch((thrown: unknown) => thrown);
    expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/locked/);
  };

  it("takes no more paid-another-way marks after the run is paid", async () => {
    await expect(recordOtherPayment({ runId, personId: ids.vcb, paidOn: "2026-09-07", reference: "FT1", reason: "muộn" }, ids.actor)).rejects.toThrow("run_already_paid");
    await expect(removeOtherPayment(runId, ids.noAccount)).rejects.toThrow("run_already_paid");
  });

  it("freezes the mark and the amount handed over with the run", async () => {
    await stepRun(runId, "lock", { personId: ids.actor });
    const [other] = await listOtherPayments(runId);
    await refused(db().update(schema.payrollOtherPayment).set({ reference: "sửa trộm" }).where(eq(schema.payrollOtherPayment.id, other.id)));
    await refused(db().delete(schema.payrollOtherPayment).where(eq(schema.payrollOtherPayment.id, other.id)));

    const [cash] = await listCashPayments(runId);
    // Not even together with a receipt confirmation, the one change a locked cash row still takes.
    await refused(db().update(schema.payrollCashPayment).set({ disbursedAmountEnc: "tampered", receiptConfirmedAt: new Date() }).where(eq(schema.payrollCashPayment.id, cash.id)));
    await expect(recordCashDisbursement({ runId, personId: cash.personId, disbursedOn: "2026-09-09" }, ids.actor)).rejects.toThrow();
  });
});
