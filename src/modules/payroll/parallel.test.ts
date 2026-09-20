// The parallel run (FR-PAY-38) against a real database: what the reconciliation calls a
// difference, when an explanation stops covering one, and what "zero unexplained" means.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
}));

import { fieldCipher } from "@/lib/crypto";
// Through the mock, so the transaction type is the app's own and the services type-check here.
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { runResultContext, runTotalsContext } from "./field-contexts";
import type { PersonPayResult } from "./engine/types";
import { COMPARED_FIELDS, openReference, reconcile, saveFinding, saveReference } from "./parallel";

const ids = { entity: randomUUID(), other: randomUUID(), person: randomUUID(), second: randomUUID(), run: randomUUID() };

const result = (over: Partial<PersonPayResult["totals"]> = {}): PersonPayResult =>
  ({
    personId: ids.person,
    entityId: ids.entity,
    month: "2026-08",
    profile: "statutory",
    lines: [],
    totals: {
      grossEarnings: 25_000_000,
      taxableIncome: 25_000_000,
      exemptIncome: 0,
      employeeInsurance: 2_625_000,
      employerInsurance: 5_375_000,
      unionDues: 0,
      unionFund: 500_000,
      pit: 310_000,
      otherDeductions: 0,
      totalDeductions: 2_935_000,
      net: 22_065_000,
      employerCost: 30_875_000,
      ...over,
    },
    proration: { basis: "working_days", divisorDays: 22, paidDaysCenti: 2200, standardDays: 22 },
    insurance: { covered: true, reason: null, declaredBase: 25_000_000, bhxhBhytBase: 25_000_000, bhtnBase: 25_000_000, employee: { bhxh: 2_000_000, bhyt: 375_000, bhtn: 250_000 }, employer: { bhxh: 4_375_000, bhyt: 750_000, bhtn: 250_000 }, funds: { bhxh: true, bhyt: true, bhtn: true } },
    pit: { method: "progressive", taxableIncome: 25_000_000, exemptIncome: 0, personalDeduction: 15_500_000, dependentDeduction: 0, dependents: 0, insuranceDeduction: 2_625_000, otherDeductions: 0, assessableIncome: 6_875_000, brackets: [], monthTax: 310_000, priorTax: 0, tax: 310_000 },
    warnings: [],
    trace: [],
  }) as PersonPayResult;

async function seedRun(personIds: readonly string[]) {
  await db()
    .insert(schema.payrollRun)
    .values({ id: ids.run, entityId: ids.entity, month: "2026-08", kind: "regular", status: "approved", headcount: personIds.length, totalsEnc: fieldCipher().encrypt(JSON.stringify({ headcount: personIds.length }), runTotalsContext(ids.run)) });
  for (const personId of personIds) {
    const rowId = randomUUID();
    await db()
      .insert(schema.payrollRunPerson)
      .values({ id: rowId, runId: ids.run, personId, entityId: ids.entity, profile: "statutory", resultEnc: fieldCipher().encrypt(JSON.stringify({ ...result(), personId }), runResultContext(rowId)), inputEnc: fieldCipher().encrypt("{}", `payroll_run_person.input:${rowId}`) });
  }
}

const reference = (over: Partial<Record<(typeof COMPARED_FIELDS)[number], number>> = {}) => ({
  gross: 25_000_000,
  employeeInsurance: 2_625_000,
  unionDues: 0,
  pit: 310_000,
  otherDeductions: 0,
  net: 22_065_000,
  ...over,
});

describe("parallel run reconciliation", () => {
  beforeAll(async () => {
    await migrateTestDb();
    await db().insert(schema.entity).values([
      { id: ids.entity, code: "SZM", legalName: "SuZu Media", shortName: "SZM" },
      { id: ids.other, code: "SZC", legalName: "SuZu Creative", shortName: "SZC" },
    ]);
    await db().insert(schema.person).values([
      { id: ids.person, fullName: "Nguyễn Văn A", searchName: "nguyen van a", workforceType: "employee", status: "active", primaryEntityId: ids.entity },
      { id: ids.second, fullName: "Trần Thị B", searchName: "tran thi b", workforceType: "employee", status: "active", primaryEntityId: ids.entity },
    ]);
    await seedRun([ids.person, ids.second]);
  });

  it("says nothing has been compared until the other method's figures exist", async () => {
    const report = await reconcile(ids.entity, "2026-08");
    expect(report.hasReference).toBe(false);
    // Nothing to reconcile is not the same as a clean reconciliation.
    expect(report.summary.zeroUnexplained).toBe(false);
  });

  it("finds a person identical, and reports only the figures that differ", async () => {
    await db().transaction(async (tx) => {
      await saveReference(tx, { entityId: ids.entity, month: "2026-08", personId: ids.person, figures: reference(), note: null }, null);
      await saveReference(tx, { entityId: ids.entity, month: "2026-08", personId: ids.second, figures: reference({ pit: 300_000, net: 22_075_000 }), note: null }, null);
    });

    const report = await reconcile(ids.entity, "2026-08");
    const same = report.rows.find((row) => row.personId === ids.person)!;
    const differs = report.rows.find((row) => row.personId === ids.second)!;

    expect(same.matches).toBe(true);
    expect(same.differences).toHaveLength(0);
    // Only PIT and net moved; gross and insurance agreed and are not listed.
    expect(differs.differences.map((line) => line.field)).toEqual(["pit", "net"]);
    expect(differs.differences[0].delta).toBe(10_000);
    expect(differs.differences[1].delta).toBe(-10_000);
    expect(differs.unexplained).toBe(2);
    expect(report.summary.zeroUnexplained).toBe(false);
  });

  it("counts a difference as explained only while it is the same difference", async () => {
    const line = (await reconcile(ids.entity, "2026-08")).rows.find((row) => row.personId === ids.second)!.differences.find((difference) => difference.field === "pit")!;
    await db().transaction((tx) => saveFinding(tx, { entityId: ids.entity, month: "2026-08", personId: ids.second, field: "pit", delta: line.delta, classification: "spreadsheet_error", note: "Bảng cũ làm tròn xuống" }, null));

    const explained = (await reconcile(ids.entity, "2026-08")).rows.find((row) => row.personId === ids.second)!;
    expect(explained.differences.find((difference) => difference.field === "pit")?.classification).toBe("spreadsheet_error");
    expect(explained.unexplained).toBe(1);

    // The spreadsheet is corrected: the gap changes, so the old explanation no longer covers it.
    await db().transaction((tx) => saveReference(tx, { entityId: ids.entity, month: "2026-08", personId: ids.second, figures: reference({ pit: 290_000, net: 22_075_000 }), note: null }, null));
    const moved = (await reconcile(ids.entity, "2026-08")).rows.find((row) => row.personId === ids.second)!;
    const pit = moved.differences.find((difference) => difference.field === "pit")!;
    expect(pit.delta).toBe(20_000);
    expect(pit.classification).toBeNull();
    expect(pit.stale).toBe(true);
  });

  it("reaches zero unexplained only when every line is explained and nobody is missing", async () => {
    await db().transaction(async (tx) => {
      await saveReference(tx, { entityId: ids.entity, month: "2026-08", personId: ids.second, figures: reference({ pit: 300_000, net: 22_075_000 }), note: null }, null);
      for (const [field, delta] of [["pit", 10_000] as const, ["net", -10_000] as const]) {
        await saveFinding(tx, { entityId: ids.entity, month: "2026-08", personId: ids.second, field, delta, classification: "accepted_rounding", note: "Chênh lệch làm tròn" }, null);
      }
    });

    const report = await reconcile(ids.entity, "2026-08");
    expect(report.summary.unexplainedLines).toBe(0);
    expect(report.summary.zeroUnexplained).toBe(true);
    expect(report.summary.matching).toBe(1);
    expect(report.summary.differing).toBe(1);
  });

  it("treats somebody present on one side only as an open difference", async () => {
    const stranger = randomUUID();
    await db().insert(schema.person).values({ id: stranger, fullName: "Lê Văn C", searchName: "le van c", workforceType: "employee", status: "active", primaryEntityId: ids.entity });
    await db().transaction((tx) => saveReference(tx, { entityId: ids.entity, month: "2026-08", personId: stranger, figures: reference(), note: "Người bảng cũ có, hệ thống không" }, null));

    const report = await reconcile(ids.entity, "2026-08");
    const row = report.rows.find((candidate) => candidate.personId === stranger)!;
    expect(row.presence).toBe("reference_only");
    expect(report.summary.missingFromSystem).toBe(1);
    // Somebody the system never paid keeps the month from being clean, even with no differing line.
    expect(report.summary.zeroUnexplained).toBe(false);
  });

  it("keeps one entity's reconciliation out of another's", async () => {
    const report = await reconcile(ids.other, "2026-08");
    expect(report.rows).toHaveLength(0);
    expect(report.hasReference).toBe(false);
  });

  it("stores the other method's figures encrypted and bound to their row", async () => {
    const [row] = await db().select().from(schema.payrollParallelReference).limit(1);
    // Nothing readable in the clear: the column is a ciphertext, and the figures come back only
    // through the row it belongs to.
    expect(row.figuresEnc).not.toContain("25000000");
    expect(row.figuresEnc.startsWith("v1.")).toBe(true);
    expect(openReference(row).gross).toBeGreaterThan(0);
    expect(() => JSON.parse(fieldCipher().decrypt(row.figuresEnc, "payroll_parallel_reference.figures:" + randomUUID()))).toThrow();
  });
});
