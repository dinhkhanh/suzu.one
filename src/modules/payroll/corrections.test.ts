// Correcting what was approved wrong (PAY-13) and loading a company's pay from spreadsheets
// (PAY-14), end to end on PGlite: a voided version stops counting and the one before it runs on,
// nothing a paid run stood on is voided, and an import becomes the owner's approval, request by
// request, of exactly what the owner was shown.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({
    allowedWorkspaceDomains: ["suzu.vn", "suzu.group"],
    bootstrapOwnerEmails: [],
    BETTER_AUTH_URL: "https://suzu.one",
    DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 5).toString("base64")}`,
    DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 8).toString("base64"),
  }),
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
  // The imports build their actions with it; these tests call the import's own steps instead.
  createAction: () => async () => ({ ok: false, error: "not_in_tests" }),
}));

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { decideComponent, proposeComponent, resolveCatalogue, voidComponent } from "./components";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { decidePolicy, getPayrollPolicy, proposePolicy, voidPolicy } from "./policies";
import { decideProfile, getProfilesOn, submitProfile, voidProfile } from "./profiles";
import { listPendingProfileImports, listProfileImport, profileImport, approveProfileImport } from "./profile-import";
import { getRunReadiness } from "./run-readiness";
import { approveSalaryImport, getSalaryImport, listPendingSalaryImports, resolveSalaryRows, salaryImport } from "./salary-import";
import { decideSalaryChange, getSalaryFile, getStructureOn, submitSalaryChange, voidSalaryStructure } from "./salaries";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"media" | "owner" | "cnb" | "huy" | "lan" | "minh" | "tam", string>;
type Viewer = { personId: string; principal: Principal };
const who = {} as Record<"owner" | "cnb", Viewer>;
const approve = { action: "approve" as const, comment: null };
const terms = (baseSalary: number, probationPercent?: number) => ({ baseSalary, insuranceSalary: baseSalary, allowances: [{ code: "ALW_MEAL", amount: 730_000 }], ...(probationPercent ? { probationPercent } : {}) });

/** A salary change filed by C&B and approved by the owner; the structure it made. */
async function approvedStructure(personId: string, validFrom: string, baseSalary: number, reason: "initial" | "raise" = "raise") {
  const { request } = await submitSalaryChange(who.cnb.personId, { personId, validFrom, reason, terms: terms(baseSalary), note: null });
  const { structureId } = await decideSalaryChange(who.owner, request.id, approve);
  return structureId!;
}

/** A run of the entity's month with these people in it, at the given status — what "used" means. */
async function runWith(month: string, status: "calculated" | "approved" | "paid", personIds: string[], context: Record<string, unknown> | null = null) {
  const [run] = await db()
    .insert(schema.payrollRun)
    .values({ entityId: ids.media, month, status, context, calculatedAt: new Date("2020-01-01T00:00:00Z"), kind: "off_cycle" })
    .returning();
  if (personIds.length > 0)
    await db()
      .insert(schema.payrollRunPerson)
      .values(personIds.map((personId) => ({ runId: run.id, personId, entityId: ids.media, profile: "statutory" as const, resultEnc: "sealed", inputEnc: "sealed" })));
  return run;
}

beforeAll(async () => {
  await migrateTestDb();
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [unit] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  const hire = async (name: string, employeeCode: string) => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId: media.id,
        employeeCode,
        startDate: "2025-01-01",
        seniorityDate: null,
        placement: { workforceType: "employee", branchId: null, orgUnitId: unit.id, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null },
      },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  Object.assign(ids, {
    media: media.id,
    owner: await hire("The Owner", "SZM-0001"),
    cnb: await hire("Cnb Media", "SZM-0002"),
    huy: await hire("Ho Gia Huy", "SZM-0003"),
    lan: await hire("Tran Thi Lan", "SZM-0004"),
    minh: await hire("Le Van Minh", "SZM-0005"),
    tam: await hire("Vo Thi Tam", "SZM-0006"),
  });
  const grants: Record<string, Grant[]> = { [ids.owner]: [{ role: "owner", scope: { type: "group" } }], [ids.cnb]: [{ role: "payroll", scope: { type: "entity", id: media.id } }] };
  for (const [personId, list] of Object.entries(grants))
    await db()
      .insert(schema.roleAssignment)
      .values(list.map((grant) => ({ personId, role: grant.role, scopeType: grant.scope.type, scopeId: grant.scope.type === "group" ? null : grant.scope.id })));
  const viewer = (personId: string): Viewer => ({ personId, principal: { personId, workforceType: "employee", grants: grants[personId] ?? [] } });
  Object.assign(who, { owner: viewer(ids.owner), cnb: viewer(ids.cnb) });

  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });
  await db()
    .insert(schema.statutoryParameter)
    .values({ key: "probation.limits", value: { managerDays: 180, professionalDays: 60, intermediateDays: 30, otherDays: 6, minimumPayPercent: 85 }, validFrom: "2021-01-01", status: "approved" });
});

describe("voiding a salary structure approved wrong (PAY-13)", () => {
  let initial = "";
  let wrong = "";

  beforeAll(async () => {
    initial = await approvedStructure(ids.huy, "2025-01-01", 20_000_000, "initial");
    // A raise from September typed with a zero too few.
    wrong = await approvedStructure(ids.huy, "2026-09-01", 2_500_000);
  });

  it("takes it back: the structure before runs on, and the wrong one stays on the file with the reason", async () => {
    const { after } = await voidSalaryStructure(wrong, "Gõ thiếu một số 0", ids.owner);
    expect(after).toMatchObject({ voidReason: "Gõ thiếu một số 0", voidedByPersonId: ids.owner });
    expect((await getStructureOn(ids.huy, "2026-09-15"))?.id).toBe(initial);
    expect((await getStructureOn(ids.huy, "2026-09-15"))?.validTo).toBeNull();
    const file = await getSalaryFile(who.owner, ids.huy);
    expect(file?.structures.map((structure) => structure.id)).toEqual([initial]);
    expect(file?.voided.map((structure) => structure.id)).toEqual([wrong]);
    await expect(voidSalaryStructure(wrong, "lần nữa", ids.owner)).rejects.toThrow("version_not_voidable");
  });

  it("lets the correct figure be approved from the same day", async () => {
    const fixed = await approvedStructure(ids.huy, "2026-09-01", 25_000_000);
    expect(await getStructureOn(ids.huy, "2026-09-15")).toMatchObject({ id: fixed, terms: { baseSalary: 25_000_000 } });
    expect((await getStructureOn(ids.huy, "2026-08-31"))?.validTo).toBe("2026-08-31");
  });

  it("is refused while a run past C&B paid the person on it — and allowed when the run is still with C&B", async () => {
    const current = (await getStructureOn(ids.huy, "2026-09-15"))!.id;
    const run = await runWith("2026-09", "paid", [ids.huy]);
    await expect(voidSalaryStructure(current, "sai", ids.owner)).rejects.toThrow("void_used_by_paid_run");
    await db().update(schema.payrollRun).set({ status: "approved" }).where(eq(schema.payrollRun.id, run.id));
    await expect(voidSalaryStructure(current, "sai", ids.owner)).rejects.toThrow("void_run_in_review");
    // A month before the structure began is not its month: a paid August stands in nobody's way.
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, run.id));
    await runWith("2026-08", "paid", [ids.huy]);
    await expect(voidSalaryStructure(current, "sai", ids.owner)).resolves.toBeTruthy();
  });
});

describe("voiding a pay profile, a component and a pay policy (PAY-13)", () => {
  it("takes back a profile approved wrong and lets the one before run on", async () => {
    const first = await submitProfile(
      {
        personId: ids.lan,
        profile: "statutory",
        simpleBasis: null,
        reviewDate: null,
        taxResidency: "resident",
        pitMethod: "progressive",
        pitCommitment: false,
        insuranceExemption: null,
        unionMember: false,
        validFrom: "2025-01-01",
        note: null,
      },
      ids.cnb,
    );
    const move = await submitProfile(
      {
        personId: ids.lan,
        profile: "simple",
        simpleBasis: "other",
        reviewDate: null,
        taxResidency: "resident",
        pitMethod: "progressive",
        pitCommitment: false,
        insuranceExemption: null,
        unionMember: false,
        validFrom: "2026-10-01",
        note: null,
      },
      ids.cnb,
    );
    await decideProfile(move.id, "approve", ids.owner);
    expect((await getProfilesOn([ids.lan], "2026-10-15")).get(ids.lan)?.profile).toBe("simple");

    await voidProfile(move.id, "Nhầm người", ids.owner);
    const now = (await getProfilesOn([ids.lan], "2026-10-15")).get(ids.lan);
    expect(now).toMatchObject({ id: first.id, profile: "statutory", validTo: null });
  });

  it("takes back a component version and a policy version; the earlier ones apply again", async () => {
    const [meal] = (await resolveCatalogue(ids.media, "2026-09-30")).filter((component) => component.code === "ALW_MEAL");
    const proposed = await proposeComponent(
      {
        entityId: null,
        code: "ALW_MEAL",
        name: "Phụ cấp ăn trưa",
        nameEn: null,
        kind: meal.kind,
        category: meal.category,
        source: meal.source,
        taxTreatment: meal.taxTreatment,
        exemptCap: meal.exemptCap,
        subjectToInsurance: meal.subjectToInsurance,
        proration: meal.proration,
        roundingRule: meal.roundingRule,
        formula: meal.formula,
        sortOrder: meal.sortOrder,
        validFrom: "2026-10-01",
        note: null,
      },
      ids.cnb,
    );
    await decideComponent(proposed.id, "approve", ids.owner);
    expect((await resolveCatalogue(ids.media, "2026-10-15")).find((component) => component.code === "ALW_MEAL")?.id).toBe(proposed.id);
    await voidComponent(proposed.id, "Sai mức trần", ids.owner);
    expect((await resolveCatalogue(ids.media, "2026-10-15")).find((component) => component.code === "ALW_MEAL")?.id).toBe(meal.id);

    const policy = await proposePolicy({ entityId: ids.media, value: { ...DEFAULT_PAYROLL_POLICY, payDay: 5 }, validFrom: "2026-10-01", note: null }, ids.cnb);
    await decidePolicy(policy.id, "approve", ids.owner);
    expect((await getPayrollPolicy(ids.media, "2026-10-15")).id).toBe(policy.id);
    // A paid run worked out under it holds it in place.
    const run = await runWith("2026-10", "paid", [], { policyVersionId: policy.id, componentVersionIds: [], parameterVersions: {} });
    await expect(voidPolicy(policy.id, "sai", ids.owner)).rejects.toThrow("void_used_by_paid_run");
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, run.id));
    await voidPolicy(policy.id, "Sai ngày trả lương", ids.owner);
    expect((await getPayrollPolicy(ids.media, "2026-10-15")).entityId).toBeNull();
  });

  it("makes a run still with C&B stale when a version it was calculated with is voided", async () => {
    const policy = await proposePolicy({ entityId: ids.media, value: { ...DEFAULT_PAYROLL_POLICY, payDay: 7 }, validFrom: "2026-11-01", note: null }, ids.cnb);
    await decidePolicy(policy.id, "approve", ids.owner);
    const run = await runWith("2026-11", "calculated", [], { policyVersionId: policy.id, componentVersionIds: [], parameterVersions: {} });
    expect((await getRunReadiness(run)).stale).toEqual([]);
    await voidPolicy(policy.id, "Sai", ids.owner);
    expect((await getRunReadiness(run)).stale).toEqual(["version_voided"]);
  });
});

describe("a probation share below the law (FR-PAY-05)", () => {
  it("is refused when proposed; at or above the minimum it is kept with the terms", async () => {
    await expect(submitSalaryChange(who.cnb.personId, { personId: ids.tam, validFrom: "2025-01-01", reason: "initial", terms: terms(20_000_000, 80), note: null })).rejects.toThrow("salary_probation_below_minimum");
    const { request } = await submitSalaryChange(who.cnb.personId, { personId: ids.tam, validFrom: "2025-01-01", reason: "initial", terms: terms(20_000_000, 85), note: null });
    await decideSalaryChange(who.owner, request.id, approve);
    expect((await getStructureOn(ids.tam, "2025-02-01"))?.terms.probationPercent).toBe(85);
  });
});

describe("salaries from a spreadsheet, approved by the owner as one import (PAY-14)", () => {
  const row = (line: number, values: Partial<Parameters<typeof resolveSalaryRows>[0][number]["values"]>) =>
    ({ row: line, values: { employeeCode: null, validFrom: null, reason: null, baseSalary: null, insuranceSalary: null, allowances: null, probationPercent: null, note: null, ...values } }) as Parameters<typeof resolveSalaryRows>[0][number];
  const batchId = crypto.randomUUID();

  it("checks every row the way the pay file's form checks one change", async () => {
    const rows = [
      row(2, { employeeCode: "SZM-0005", validFrom: "2025-01-01", baseSalary: 18_000_000, allowances: [{ code: "ALW_MEAL", amount: 730_000 }] }),
      row(3, { employeeCode: "SZM-9999", validFrom: "2025-01-01", baseSalary: 1 }),
      row(4, { employeeCode: "SZM-0003", validFrom: "2025-01-01", baseSalary: 30_000_000 }),
      row(5, { employeeCode: "SZM-0002", validFrom: "2025-01-01", baseSalary: 1, allowances: [{ code: "NOT_A_CODE", amount: 1 }] }),
      row(6, { employeeCode: "SZM-0001", validFrom: "2025-01-01", baseSalary: 1, probationPercent: 70 }),
      row(7, { employeeCode: "SZM-0005", validFrom: "2025-01-01", baseSalary: 1 }),
    ];
    const { problems, resolved } = await resolveSalaryRows(rows, who.cnb, { entityId: ids.media });
    expect(problems.map((problem) => [problem.row, problem.code])).toEqual([
      [3, "person_not_found"],
      [4, "version_exists"],
      [5, "allowance_unknown"],
      [6, "probation_below_minimum"],
      [7, "duplicate_person"],
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ personId: ids.minh, initial: true, terms: { baseSalary: 18_000_000, insuranceSalary: 18_000_000 } });
    // Somebody who may not manage the entity's pay finds nobody at all.
    const stranger = { principal: { personId: ids.lan, workforceType: "employee" as const, grants: [] } };
    expect((await resolveSalaryRows(rows.slice(0, 1), stranger, { entityId: ids.media })).problems.map((problem) => problem.code)).toEqual(["person_not_found"]);

    // Committed: one request per person, marked with the import, and nothing in force yet.
    const counts = await db().transaction((tx) => salaryImport.definition.commit(rows.slice(0, 1), tx, { person: { id: ids.cnb }, principal: who.cnb.principal } as never, { entityId: ids.media }, batchId));
    expect(counts).toEqual({ requests: 1 });
    expect(await getStructureOn(ids.minh, "2025-02-01")).toBeNull();
    expect(await listPendingSalaryImports(who.cnb.principal)).toMatchObject([{ batchId, entityId: ids.media, pending: 1, total: 1 }]);
  });

  it("shows the owner every figure, and approves exactly the requests that were shown", async () => {
    const view = (await getSalaryImport(who.owner, batchId))!;
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ personId: ids.minh, status: "pending", proposed: { baseSalary: 18_000_000 }, current: null });
    expect(view.canApprove).toBe(true);
    // C&B read it too, but do not sign it.
    expect((await getSalaryImport(who.cnb, batchId))?.canApprove).toBe(false);

    // An id that is not in the import is not approved by it.
    const stray = await submitSalaryChange(who.cnb.personId, { personId: ids.lan, validFrom: "2025-01-01", reason: "initial", terms: terms(15_000_000), note: null });
    const result = await approveSalaryImport(who.owner, batchId, [view.lines[0].requestId, stray.request.id]);
    expect(result).toEqual({ approved: 1, failed: [] });
    expect((await getStructureOn(ids.minh, "2025-02-01"))?.terms.baseSalary).toBe(18_000_000);
    expect((await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, stray.request.id)))[0].status).toBe("pending");
    expect(await listPendingSalaryImports(who.owner.principal)).toEqual([]);
  });
});

describe("pay profiles from a spreadsheet (PAY-14)", () => {
  const batchId = crypto.randomUUID();
  const row = (line: number, values: Record<string, unknown>) =>
    ({
      row: line,
      values: { employeeCode: null, profile: null, simpleBasis: null, validFrom: null, taxResidency: null, pitMethod: null, pitCommitment: null, insuranceExemption: null, unionMember: null, reviewDate: null, note: null, ...values },
    }) as never;

  it("puts a first Statutory profile in force at once and leaves the rest to the owner", async () => {
    const rows = [
      row(2, { employeeCode: "SZM-0005", profile: "statutory", validFrom: "2025-01-01", unionMember: "yes" }),
      row(3, { employeeCode: "SZM-0006", profile: "simple", simpleBasis: "probation", validFrom: "2025-01-01" }),
      row(4, { employeeCode: "SZM-0002", profile: "simple", validFrom: "2025-01-01" }),
    ];
    const { problems } = await import("./profile-import").then((module) => module.resolveProfileRows(rows, who.cnb, { entityId: ids.media }));
    // A Simple profile needs its basis.
    expect(problems.map((problem) => [problem.row, problem.code])).toEqual([[4, "profile_basis_required"]]);

    const counts = await db().transaction((tx) => profileImport.definition.commit(rows.slice(0, 2), tx, { person: { id: ids.cnb }, principal: who.cnb.principal } as never, { entityId: ids.media }, batchId));
    expect(counts).toEqual({ approved: 1, proposed: 1 });
    expect((await getProfilesOn([ids.minh], "2025-02-01")).get(ids.minh)).toMatchObject({ profile: "statutory", unionMember: true, importBatchId: batchId });
    expect((await getProfilesOn([ids.tam], "2025-02-01")).get(ids.tam)).toBeUndefined();
    expect(await listPendingProfileImports(who.owner.principal)).toMatchObject([{ batchId, pending: 1 }]);
  });

  it("lets the owner approve the proposals shown, each as if approved alone", async () => {
    const lines = await listProfileImport(who.owner.principal, batchId);
    const waiting = lines.filter((line) => line.status === "proposed").map((line) => line.id);
    expect(waiting).toHaveLength(1);
    expect(await approveProfileImport(ids.owner, batchId, waiting)).toEqual({ approved: 1, failed: [] });
    expect((await getProfilesOn([ids.tam], "2025-02-01")).get(ids.tam)).toMatchObject({ profile: "simple", simpleBasis: "probation", status: "approved" });
    expect(
      await db()
        .select()
        .from(schema.payProfile)
        .where(and(eq(schema.payProfile.importBatchId, batchId), isNull(schema.payProfile.decidedAt))),
    ).toEqual([]);
  });
});
