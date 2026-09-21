// The Phase 1 exit criterion, as a test: a line manager and a department head never reach
// restricted or compensation data — fields, dependents, vault documents, salary terms — while HR
// staff stop at restricted and HR admin reads everything. Runs on a real Postgres (PGlite).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({
    allowedWorkspaceDomains: ["suzu.vn", "suzu.group"],
    bootstrapOwnerEmails: [],
    BETTER_AUTH_URL: "https://suzu.one",
    DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
    DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64"),
  }),
}));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { sendHrAlerts } from "./alerts";
import { createContract, createDependent, deleteContract, findPeopleByNationalId, getContractSalaryTerms, getSensitiveFields, getSensitiveSummary, listContracts, listDependents, listDocuments, type SensitiveFields, updateSensitiveFields } from "./records";
import { rewrapEncryptedFields } from "./rewrap";
import { hirePerson } from "./service";

const today = todayInVietnam();
const ids = {} as Record<"media" | "video" | "manager" | "head" | "hrStaff" | "hrAdmin" | "huy" | "colleague", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
let viewers: Record<"self" | "lineManager" | "departmentHead" | "colleague" | "hrStaff" | "hrAdmin", Principal>;

const SENSITIVE: SensitiveFields = {
  nationalId: "079 201 001 234",
  nationalIdIssuedOn: "2021-05-10",
  nationalIdIssuedAt: "Cục CSQLHC về TTXH",
  passportNumber: null,
  taxCode: "8123456789",
  socialInsuranceNumber: "7912345678",
  healthInsuranceHospital: "BV Quận 1",
  bankAccounts: [{ bankName: "Vietcombank", accountNumber: "0071000123456", accountHolder: "HO GIA HUY", branch: "HCM" }],
};
let contractId: string;

beforeAll(async () => {
  await migrateTestDb();
  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ ...seed, status: "approved" as const })));
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();

  const hire = async (name: string, managerId: string | null = null) => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId: media.id,
        employeeCode: null,
        startDate: "2024-01-01",
        seniorityDate: null,
        placement: { workforceType: "employee", branchId: null, orgUnitId: video.id, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null },
      },
      actor.id,
    );
    return person.id;
  };
  const manager = await hire("Line Manager");
  const head = await hire("Department Head");
  const hrStaff = await hire("Hr Staff");
  const hrAdmin = await hire("Hr Admin");
  const huy = await hire("Ho Gia Huy", manager);
  const colleague = await hire("Some Colleague", manager);
  Object.assign(ids, { media: media.id, video: video.id, manager, head, hrStaff, hrAdmin, huy, colleague });
  await db().insert(schema.roleAssignment).values([
    { personId: head, role: "department_head", scopeType: "unit", scopeId: video.id, validFrom: "2024-01-01" },
    { personId: hrStaff, role: "hr_staff", scopeType: "entity", scopeId: media.id, validFrom: "2024-01-01" },
    { personId: hrAdmin, role: "hr_admin", scopeType: "group", validFrom: "2024-01-01" },
  ]);
  viewers = {
    self: principal(huy),
    lineManager: principal(manager),
    departmentHead: principal(head, [{ role: "department_head", scope: { type: "unit", id: video.id } }]),
    colleague: principal(colleague),
    hrStaff: principal(hrStaff, [{ role: "hr_staff", scope: { type: "entity", id: media.id } }]),
    hrAdmin: principal(hrAdmin, [{ role: "hr_admin", scope: { type: "group" } }]),
  };

  await updateSensitiveFields(huy, SENSITIVE);
  await createDependent(huy, { fullName: "Hồ Gia Bảo", relationship: "child", dateOfBirth: "2020-02-02", idNumber: "079220000111", taxCode: null, deductionFrom: "2024-01-01", deductionTo: null, note: null });
  const contract = await createContract(
    huy,
    { number: "HD-001", type: "fixed_term", parentContractId: null, jobCategory: null, signDate: null, startDate: addDays(today, -335), endDate: addDays(today, 30), salaryTerms: "Lương gộp 25.000.000 đ/tháng", note: null },
    actor.id,
  );
  contractId = contract.id;

  // Vault documents, one per tier. The bytes are irrelevant here; storage has its own integration test.
  for (const [category, tier] of [["degree", "personal"], ["id_scan", "restricted"], ["contract", "compensation"]] as const) {
    const [file] = await db().insert(schema.storedFile).values({ bucket: "test", objectPath: `test/${category}.pdf`, fileName: `${category}.pdf`, contentType: "application/pdf", sizeBytes: 10, ownerType: "person_document", ownerId: category, entityId: media.id, tier, status: "ready" }).returning();
    await db().insert(schema.personDocument).values({ personId: huy, entityId: media.id, category, title: category, tier, fileId: file.id, expiresOn: category === "id_scan" ? addDays(today, 12) : null });
  }
});

describe("who reads what", () => {
  it("refuses restricted fields to the line manager, the department head and colleagues", async () => {
    for (const viewer of [viewers.lineManager, viewers.departmentHead, viewers.colleague]) {
      expect(await getSensitiveSummary(viewer, ids.huy)).toBeNull();
      expect(await getSensitiveFields(viewer, ids.huy)).toBeNull();
      expect(await listDependents(viewer, ids.huy)).toBeNull();
    }
  });

  it("shows restricted fields to the person, HR staff of the entity and HR admin", async () => {
    for (const viewer of [viewers.self, viewers.hrStaff, viewers.hrAdmin]) {
      expect((await getSensitiveSummary(viewer, ids.huy))?.filled).toMatchObject({ nationalId: true, passportNumber: false, bankAccounts: true });
      const fields = await getSensitiveFields(viewer, ids.huy);
      expect(fields).toMatchObject(SENSITIVE);
      expect(fields?.dependents).toEqual([expect.objectContaining({ idNumber: "079220000111", taxCode: null })]);
      expect(await listDependents(viewer, ids.huy)).toEqual([expect.objectContaining({ fullName: "Hồ Gia Bảo", hasIdNumber: true, hasTaxCode: false })]);
    }
  });

  it("lists only the vault documents of tiers the viewer reads", async () => {
    const categories = async (viewer: Principal) => (await listDocuments(viewer, ids.huy)).map((document) => document.category).sort();
    expect(await categories(viewers.colleague)).toEqual([]);
    expect(await categories(viewers.lineManager)).toEqual(["degree"]);
    expect(await categories(viewers.departmentHead)).toEqual(["degree"]);
    expect(await categories(viewers.hrStaff)).toEqual(["degree", "id_scan"]);
    expect(await categories(viewers.hrAdmin)).toEqual(["contract", "degree", "id_scan"]);
    expect(await categories(viewers.self)).toEqual(["contract", "degree", "id_scan"]);
  });

  it("keeps salary terms and signed copies for the compensation tier", async () => {
    expect(await listContracts(viewers.colleague, ids.huy)).toBeNull();
    for (const viewer of [viewers.lineManager, viewers.departmentHead, viewers.hrStaff]) {
      expect(await listContracts(viewer, ids.huy)).toEqual([expect.objectContaining({ number: "HD-001", hasSalaryTerms: null, files: null })]);
      expect(await getContractSalaryTerms(viewer, contractId)).toBeNull();
    }
    for (const viewer of [viewers.self, viewers.hrAdmin]) {
      expect(await listContracts(viewer, ids.huy)).toEqual([expect.objectContaining({ hasSalaryTerms: true, files: [] })]);
      expect(await getContractSalaryTerms(viewer, contractId)).toBe("Lương gộp 25.000.000 đ/tháng");
    }
  });
});

describe("what the database holds", () => {
  it("stores no plaintext in encrypted columns", async () => {
    const [sensitive] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, ids.huy));
    const [dependent] = await db().select().from(schema.dependent);
    const [contract] = await db().select().from(schema.contract);
    const stored = JSON.stringify([sensitive, dependent.idNumber, contract.salaryTerms]);
    for (const secret of ["079 201 001 234", "079201001234", "8123456789", "0071000123456", "Vietcombank", "079220000111", "25.000.000"]) expect(stored).not.toContain(secret);
    expect(sensitive.nationalId).toMatch(/^v1\.k1\./);
    expect(sensitive.passportNumber).toBeNull();
  });

  it("finds a national ID again through the blind index, however it was typed", async () => {
    expect(await findPeopleByNationalId("079201001234")).toEqual([ids.huy]);
    expect(await findPeopleByNationalId("079.201.001.234", ids.huy)).toEqual([]);
    expect(await findPeopleByNationalId("079201009999")).toEqual([]);
  });

  it("reports only the names of changed fields, and re-encrypts only those", async () => {
    const [before] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, ids.huy));
    expect(await updateSensitiveFields(ids.huy, { ...SENSITIVE, passportNumber: "C1234567" })).toMatchObject({ changed: ["passportNumber"] });
    const [after] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, ids.huy));
    expect(after.nationalId).toBe(before.nationalId);
    expect(await updateSensitiveFields(ids.huy, { ...SENSITIVE, passportNumber: "C1234567" })).toMatchObject({ changed: [] });
    expect(await rewrapEncryptedFields()).toMatchObject({ rewrapped: 0 });
  });
});

describe("contract rules at the service", () => {
  it("applies the statutory limits in force on the start date", async () => {
    const base = { parentContractId: null, jobCategory: null, signDate: null, salaryTerms: null, note: null };
    await expect(createContract(ids.colleague, { ...base, number: "HD-X1", type: "fixed_term", startDate: "2026-01-01", endDate: "2029-01-01" }, ids.hrAdmin)).rejects.toThrow("contract_fixed_term_too_long");
    await expect(createContract(ids.colleague, { ...base, number: "HD-X2", type: "probation", jobCategory: "professional", startDate: "2026-01-01", endDate: "2026-03-15" }, ids.hrAdmin)).rejects.toThrow("contract_probation_too_long");
    await expect(createContract(ids.huy, { ...base, number: "HD-X3", type: "indefinite", startDate: today, endDate: null }, ids.hrAdmin)).rejects.toThrow("contract_overlap");
    await expect(createContract(ids.colleague, { ...base, number: "HD-001", type: "nda", startDate: "2026-01-01", endDate: null }, ids.hrAdmin)).rejects.toThrow("contract_number_taken");
  });


  it("frees the number of a contract deleted as a mistake", async () => {
    const nda = { number: "NDA-7", type: "nda" as const, parentContractId: null, jobCategory: null, signDate: null, startDate: "2026-01-01", endDate: null, salaryTerms: null, note: null };
    const first = await createContract(ids.colleague, nda, ids.hrAdmin);
    await expect(createContract(ids.colleague, nda, ids.hrAdmin)).rejects.toThrow("contract_number_taken");
    await deleteContract(first.id);
    expect((await createContract(ids.colleague, nda, ids.hrAdmin)).id).not.toBe(first.id);
    expect((await listContracts(viewers.hrAdmin, ids.colleague))?.map((row) => row.number)).toEqual(["NDA-7"]);
  });
});

describe("daily alerts", () => {
  it("warns HR and the line manager once per threshold, and the person about their own documents", async () => {
    expect(await sendHrAlerts(today)).toEqual({ contractAlerts: 1, probationAlerts: 0, documentAlerts: 1 });
    const sent = await db().select().from(schema.notification);
    const recipients = (kind: string) => sent.filter((row) => row.kind === kind).map((row) => row.recipientPersonId).sort();
    expect(recipients("hr.contract_expiring")).toEqual([ids.hrStaff, ids.hrAdmin, ids.manager].sort());
    expect(recipients("hr.document_expiring")).toEqual([ids.hrStaff, ids.hrAdmin, ids.huy].sort());
    expect(sent.find((row) => row.kind === "hr.contract_expiring")?.params).toMatchObject({ person: "Ho Gia Huy", label: "HD-001", days: 30 });

    // Same day again, and the next day: nothing new until the next threshold.
    expect(await sendHrAlerts(today)).toEqual({ contractAlerts: 0, probationAlerts: 0, documentAlerts: 0 });
    expect(await sendHrAlerts(addDays(today, 1))).toEqual({ contractAlerts: 0, probationAlerts: 0, documentAlerts: 0 });
    expect(await sendHrAlerts(addDays(today, 15))).toMatchObject({ contractAlerts: 1 });
  });
});
