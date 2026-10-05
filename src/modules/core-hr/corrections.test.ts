// CHR-02: records that could not be corrected. Contracts on any employment, dependents, contacts,
// vault titles and expiry, an employment's first day and code, a position's name — and a person
// created in error, who goes only while nothing else names them. Real Postgres (PGlite).
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
import type { Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { correctEmployment, listPositionCatalogue, removePersonCreatedInError, renamePosition } from "./corrections";
import { rehirePerson, terminateEmployment } from "./lifecycle";
import { createContract, createDependent, getSensitiveFields, listContracts, listDependents, listDocuments, addEmergencyContact, listEmergencyContacts, updateContract, updateDependent, updateDocument, updateEmergencyContact } from "./records";
import { hirePerson, type HireInput } from "./service";

const today = todayInVietnam();
const ids = {} as Record<"media" | "video" | "actor", string>;
const owner: Principal = { personId: "owner", workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] };
const NO_PROFILE = { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null };
const placement = (positionName: string | null = "Editor") => ({ workforceType: "employee" as const, branchId: null, orgUnitId: ids.video, positionName, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null });

const hire = (fullName: string, overrides: Partial<HireInput> = {}) =>
  hirePerson({ fullName, workEmail: `${fullName.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: NO_PROFILE, entityId: ids.media, employeeCode: null, startDate: "2024-01-01", seniorityDate: null, placement: placement(), ...overrides }, ids.actor);
const contract = (over: Record<string, unknown> = {}) => ({ number: "HD-1", type: "fixed_term" as const, parentContractId: null, jobCategory: null, signDate: null, startDate: "2024-01-01", endDate: "2024-12-31", salaryTerms: null, note: null, ...over });

beforeAll(async () => {
  await migrateTestDb();
  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ ...seed, status: "approved" as const })));
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, video: video.id, actor: actor.id });
});

describe("contracts", () => {
  it("are entered and corrected on the employment they belong to — not only the latest", async () => {
    const { person, employment: first } = await hire("Came Back");
    await terminateEmployment(person.id, { lastDay: "2024-12-31", reason: "contract_end", note: null }, ids.actor);
    const { employment: second } = await rehirePerson(person.id, { entityId: ids.media, employeeCode: null, startDate: "2025-06-01", seniorityDate: null, placement: placement() }, ids.actor);

    // A contract of the first period, entered after the rehire, lands in the first period.
    const old = await createContract(person.id, contract({ number: "HD-OLD", startDate: "2024-01-01", endDate: "2024-06-30" }), ids.actor);
    expect(old.employmentId).toBe(first.id);
    const current = await createContract(person.id, contract({ number: "HD-NEW", startDate: "2025-06-01", endDate: "2026-05-31" }), ids.actor);
    expect(current.employmentId).toBe(second.id);

    // Corrected: a typo in the number, the real end date.
    const { before, after } = await updateContract(old.id, { ...contract({ number: "HD-OLD-1", startDate: "2024-01-01", endDate: "2024-12-31" }) });
    expect(before.number).toBe("HD-OLD");
    expect(after).toMatchObject({ number: "HD-OLD-1", endDate: "2024-12-31", employmentId: first.id });
    // The legal checks still apply, against the other contracts of that period.
    await expect(updateContract(current.id, contract({ number: "HD-NEW", startDate: "2025-06-01", endDate: "2029-06-01" }))).rejects.toThrow("contract_fixed_term_too_long");
    expect((await listContracts(owner, person.id))?.map((row) => row.number).sort()).toEqual(["HD-NEW", "HD-OLD-1"]);
  });

  it("keeps the sealed pay terms unless new ones are given", async () => {
    const { person } = await hire("Has Terms");
    const created = await createContract(person.id, contract({ number: "HD-T", salaryTerms: "25.000.000 đ" }), ids.actor);
    const ownerSelf: Principal = { ...owner, personId: person.id };
    await updateContract(created.id, { ...contract({ number: "HD-T", note: "corrected" }), salaryTerms: undefined });
    const [kept] = await db().select().from(schema.contract).where(eq(schema.contract.id, created.id));
    expect(kept.note).toBe("corrected");
    expect(kept.salaryTerms).toBe(created.salaryTerms);
    await updateContract(created.id, { ...contract({ number: "HD-T" }), salaryTerms: "27.000.000 đ" });
    const { getContractSalaryTerms } = await import("./records");
    expect(await getContractSalaryTerms(ownerSelf, created.id)).toBe("27.000.000 đ");
  });
});

describe("dependents, contacts and the vault", () => {
  it("corrects a dependent without touching the sealed numbers unless they are given", async () => {
    const { person } = await hire("Has Family");
    const child = await createDependent(person.id, { fullName: "Bé Na", relationship: "child", dateOfBirth: "2020-02-02", idNumber: "079220000111", taxCode: null, deductionFrom: "2024-01-01", deductionTo: null, note: null });
    await updateDependent(child.id, { fullName: "  Bé   Ngân ", relationship: "child", dateOfBirth: "2020-03-02", deductionFrom: "2024-02-01", deductionTo: null, note: null });
    const [view] = (await listDependents(owner, person.id))!;
    expect(view).toMatchObject({ fullName: "Bé Ngân", dateOfBirth: "2020-03-02", deductionFrom: "2024-02-01", hasIdNumber: true });
    expect((await getSensitiveFields({ ...owner, personId: person.id }, person.id))?.dependents[0].idNumber).toBe("079220000111");
    await updateDependent(child.id, { fullName: "Bé Ngân", relationship: "child", dateOfBirth: null, idNumber: "079220000999", deductionFrom: "2024-02-01", deductionTo: null, note: null });
    expect((await getSensitiveFields({ ...owner, personId: person.id }, person.id))?.dependents[0].idNumber).toBe("079220000999");
    await expect(updateDependent(child.id, { fullName: "Bé Ngân", relationship: "child", dateOfBirth: null, deductionFrom: "2024-02-01", deductionTo: "2023-01-01", note: null })).rejects.toThrow("dependent_months");
  });

  it("corrects an emergency contact and a vault entry's title and expiry", async () => {
    const { person } = await hire("Has Papers");
    const contact = await addEmergencyContact(person.id, { fullName: "Mẹ", relationship: "mẹ", phone: "0900", note: null });
    await updateEmergencyContact(contact.id, { fullName: "Nguyễn Thị Mẹ", relationship: "mẹ", phone: "0901 234 567", note: null });
    expect((await listEmergencyContacts(owner, person.id))?.[0]).toMatchObject({ fullName: "Nguyễn Thị Mẹ", phone: "0901 234 567" });

    const [file] = await db().insert(schema.storedFile).values({ bucket: "test", objectPath: `test/${person.id}.pdf`, fileName: "cccd.pdf", contentType: "application/pdf", sizeBytes: 10, ownerType: "person_document", ownerId: person.id, entityId: ids.media, tier: "restricted", status: "ready" }).returning();
    const [document] = await db().insert(schema.personDocument).values({ personId: person.id, entityId: ids.media, category: "id_scan", title: "CCCD", tier: "restricted", fileId: file.id }).returning();
    const { after } = await updateDocument(document.id, { title: "CCCD mặt trước", expiresOn: "2031-05-10" });
    expect(after).toMatchObject({ title: "CCCD mặt trước", expiresOn: "2031-05-10", category: "id_scan", tier: "restricted" });
    expect((await listDocuments(owner, person.id)).map((row) => row.title)).toEqual(["CCCD mặt trước"]);
  });
});

describe("an employment's first day and code", () => {
  it("moves the first assignment and the hire event with the first day, and the code with it", async () => {
    const { person, employment, event } = await hire("Started Earlier", { startDate: "2024-03-01" });
    const { after } = await correctEmployment(employment.id, { employeeCode: "szm-0999", startDate: "2024-02-15", seniorityDate: "2024-02-15" });
    expect(after).toMatchObject({ employeeCode: "SZM-0999", startDate: "2024-02-15", seniorityDate: "2024-02-15" });
    const [assignment] = await db().select().from(schema.assignment).where(eq(schema.assignment.employmentId, employment.id));
    expect(assignment.validFrom).toBe("2024-02-15");
    const [hireEvent] = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, event.id));
    expect(hireEvent.effectiveDate).toBe("2024-02-15");

    const { employment: other } = await hire("Code Owner");
    await expect(correctEmployment(other.id, { employeeCode: "SZM-0999", startDate: other.startDate, seniorityDate: other.seniorityDate })).rejects.toThrow("employee_code_taken");
    await expect(correctEmployment(employment.id, { employeeCode: "SZM-0999", startDate: addDays(today, 5), seniorityDate: "2024-02-15" })).rejects.toThrow("employment_start_after_today");
    expect(person.id).toBeTruthy();
  });

  it("lets a newcomer in at once when their first day is moved to today", async () => {
    const { person, employment } = await hire("Came Early", { startDate: addDays(today, 7) });
    expect((await db().select().from(schema.person).where(eq(schema.person.id, person.id)))[0].status).toBe("preboarding");
    const { activated } = await correctEmployment(employment.id, { employeeCode: employment.employeeCode, startDate: today, seniorityDate: today });
    expect(activated).toBe(true);
    expect((await db().select().from(schema.person).where(eq(schema.person.id, person.id)))[0].status).toBe("active");
  });
});

describe("positions", () => {
  it("are renamed once for everybody, counted in SQL, and never merged by a rename", async () => {
    await hire("Holder One", { placement: placement("Dung phim") });
    await hire("Holder Two", { placement: placement("Dung phim") });
    await hire("Holder Three", { placement: placement("Quay phim") });
    const catalogue = await listPositionCatalogue();
    const typo = catalogue.find((row) => row.name === "Dung phim")!;
    expect(typo.holders).toBe(2);
    await renamePosition(typo.id, "Dựng  phim ");
    expect((await listPositionCatalogue()).find((row) => row.id === typo.id)).toMatchObject({ name: "Dựng phim", holders: 2 });
    await expect(renamePosition(typo.id, "quay phim")).rejects.toThrow("position_name_taken");
  });
});

describe("a person created in error", () => {
  it("goes with what creating them made — the hire, its checklist, the profile", async () => {
    const { person } = await hire("Typo Person");
    await expect(removePersonCreatedInError(person.id, ids.actor, "Someone Else")).rejects.toThrow("remove_name_mismatch");
    await removePersonCreatedInError(person.id, ids.actor, "typo  person");
    expect(await db().select().from(schema.person).where(eq(schema.person.id, person.id))).toEqual([]);
    expect(await db().select().from(schema.employment).where(eq(schema.employment.personId, person.id))).toEqual([]);
  });

  it("is REFUSED once anything else names them — a contract, a termination", async () => {
    const { person } = await hire("Real Person");
    await createContract(person.id, contract({ number: "HD-REAL" }), ids.actor);
    await expect(removePersonCreatedInError(person.id, ids.actor, "Real Person")).rejects.toThrow("person_in_use");
    expect(await db().select().from(schema.person).where(eq(schema.person.id, person.id))).toHaveLength(1);

    const { person: leaver } = await hire("Left Already");
    await terminateEmployment(leaver.id, { lastDay: "2024-06-30", reason: "contract_end", note: null }, ids.actor);
    await expect(removePersonCreatedInError(leaver.id, ids.actor, "Left Already")).rejects.toThrow("person_in_use");
    await expect(removePersonCreatedInError(ids.actor, ids.actor, "Seed Actor")).rejects.toThrow("remove_self");
  });
});
