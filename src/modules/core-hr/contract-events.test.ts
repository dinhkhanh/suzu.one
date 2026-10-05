// FR-CHR-09: a probation pass and a renewal change the contract and the workforce type together with
// the event; a transfer, a promotion or a termination waits for an approval wherever an
// administrator saved a flow for it, and the final approval carries it out. Real Postgres (PGlite).
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

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { cancelRecordedEvent, recordContractEvent } from "./lifecycle";
import { changeNeedsApproval, decideLifecycleChange, proposeAssignmentChange, proposeTermination } from "./lifecycle-approvals";
import { createContract } from "./records";
import { hirePerson, type HireInput } from "./service";

const today = todayInVietnam();
const ids = {} as Record<"media" | "video" | "actor" | "approver" | "hr", string>;
const NO_PROFILE = { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null };
const placement = (over: Partial<HireInput["placement"]> = {}) => ({ workforceType: "employee" as const, branchId: null, orgUnitId: ids.video, positionName: "Editor", seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null, ...over });
const hire = (fullName: string, over: Partial<HireInput> = {}) =>
  hirePerson({ fullName, workEmail: `${fullName.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: NO_PROFILE, entityId: ids.media, employeeCode: null, startDate: "2026-01-05", seniorityDate: null, placement: placement(), ...over }, ids.actor);

beforeAll(async () => {
  await migrateTestDb();
  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ ...seed, status: "approved" as const })));
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, video: video.id, actor: actor.id });
  ids.approver = (await hire("The Director")).person.id;
  ids.hr = (await hire("Hr Officer")).person.id;
});

describe("a passed probation", () => {
  it("ends the probation contract, starts the new one and makes the person an employee — in one step", async () => {
    const { person } = await hire("On Probation", { placement: placement({ workforceType: "probation" }) });
    const probation = await createContract(person.id, { number: "TV-1", type: "probation", parentContractId: null, jobCategory: "professional", signDate: null, startDate: "2026-01-05", endDate: "2026-03-04", salaryTerms: null, note: null }, ids.actor);
    const effectiveDate = "2026-03-01";

    const { event, contract, ended, moved } = await recordContractEvent(
      person.id,
      { type: "probation_pass", effectiveDate, reason: "Đạt yêu cầu", note: null, workforceType: "employee", contract: { number: "HD-1", type: "fixed_term", jobCategory: null, signDate: "2026-02-27", startDate: effectiveDate, endDate: "2027-02-28", salaryTerms: null, note: null } },
      ids.hr,
    );
    expect(ended.map((row) => row.id)).toEqual([probation.id]);
    expect((await db().select().from(schema.contract).where(eq(schema.contract.id, probation.id)))[0].terminatedOn).toBe("2026-02-28");
    expect(contract).toMatchObject({ number: "HD-1", type: "fixed_term", startDate: effectiveDate });
    expect(moved?.before.workforceType).toBe("probation");
    expect(moved?.after).toMatchObject({ workforceType: "employee", validFrom: effectiveDate, positionId: moved?.before.positionId, orgUnitId: ids.video });
    expect(event).toMatchObject({ type: "probation_pass", effectiveDate, assignmentId: moved?.after.id });
    expect(event.details).toMatchObject({ contractId: contract.id, workforceType: { from: "probation", to: "employee" } });
    // In force since 1 March: the person reads as an employee now.
    if (effectiveDate <= today) expect((await db().select().from(schema.person).where(eq(schema.person.id, person.id)))[0].workforceType).toBe("employee");
    // It wrote a contract and moved the placement: it is not struck like a note.
    await expect(cancelRecordedEvent(event.id)).rejects.toThrow("event_has_effects");
  });

  it("writes nothing when the new contract breaks a rule", async () => {
    const { person } = await hire("Bad Contract", { placement: placement({ workforceType: "probation" }) });
    await expect(
      recordContractEvent(person.id, { type: "probation_pass", effectiveDate: "2026-03-01", reason: null, note: null, workforceType: "employee", contract: { number: "HD-X", type: "fixed_term", jobCategory: null, signDate: null, startDate: "2026-03-01", endDate: "2030-03-01", salaryTerms: null, note: null } }, ids.hr),
    ).rejects.toThrow("contract_fixed_term_too_long");
    expect(await db().select().from(schema.lifecycleEvent).where(and(eq(schema.lifecycleEvent.personId, person.id), eq(schema.lifecycleEvent.type, "probation_pass")))).toEqual([]);
    expect((await db().select().from(schema.assignment).innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId)).where(eq(schema.employment.personId, person.id))).map((row) => row.assignment.workforceType)).toEqual(["probation"]);
  });

  it("renews a contract: the running one stops the day before, the type stays", async () => {
    const { person } = await hire("Renewing");
    const first = await createContract(person.id, { number: "HD-A", type: "fixed_term", parentContractId: null, jobCategory: null, signDate: null, startDate: "2026-01-05", endDate: "2027-01-04", salaryTerms: null, note: null }, ids.actor);
    const { contract, ended, moved } = await recordContractEvent(person.id, { type: "contract_renewal", effectiveDate: "2026-12-01", reason: null, note: null, contract: { number: "HD-B", type: "indefinite", jobCategory: null, signDate: null, startDate: "2026-12-01", endDate: null, salaryTerms: null, note: null } }, ids.hr);
    expect(ended.map((row) => row.id)).toEqual([first.id]);
    expect(contract.type).toBe("indefinite");
    expect(moved).toBeNull();
  });
});

describe("approval for a transfer, a promotion, a termination", () => {
  const flowFor = (requestType: string) => db().insert(schema.approvalFlow).values({ requestType, entityId: ids.media, definition: { steps: [{ key: "director", mode: "any", approvers: [{ rule: "person", personId: ids.approver }] }] } });

  it("is not asked until an administrator saves a flow for it", async () => {
    expect(await changeNeedsApproval("transfer", ids.media)).toBe(false);
    expect(await changeNeedsApproval("termination", ids.media)).toBe(false);
    await flowFor("lifecycle_termination");
    await flowFor("lifecycle_promotion");
    expect(await changeNeedsApproval("termination", ids.media)).toBe(true);
    expect(await changeNeedsApproval("promotion", ids.media)).toBe(true);
    expect(await changeNeedsApproval("transfer", ids.media)).toBe(false);
    // A correction is never an approval.
    expect(await changeNeedsApproval("correction", ids.media)).toBe(false);
  });

  it("holds a termination until it is approved, then carries it out in the proposer's name", async () => {
    const { person, employment } = await hire("Maybe Leaving");
    const lastDay = addDays(today, 20);
    const { request, outcome } = await proposeTermination(person.id, { lastDay, reason: "mutual_agreement", note: null, resignationEventId: null }, ids.hr);
    expect(outcome).toBe("pending");
    expect((await db().select().from(schema.employment).where(eq(schema.employment.id, employment.id)))[0].endDate).toBeNull();
    await expect(proposeTermination(person.id, { lastDay, reason: "mutual_agreement", note: null, resignationEventId: null }, ids.hr)).rejects.toThrow("lifecycle_change_open");

    await expect(decideLifecycleChange(ids.hr, request.id, { action: "approve", comment: null })).rejects.toThrow();
    const decided = await decideLifecycleChange(ids.approver, request.id, { action: "approve", comment: null });
    expect(decided.outcome).toBe("approved");
    expect((await db().select().from(schema.employment).where(eq(schema.employment.id, employment.id)))[0].endDate).toBe(lastDay);
    const [termination] = await db().select().from(schema.lifecycleEvent).where(and(eq(schema.lifecycleEvent.personId, person.id), eq(schema.lifecycleEvent.type, "termination")));
    expect(termination).toMatchObject({ effectiveDate: lastDay, createdByPersonId: ids.hr, reason: "mutual_agreement" });
  });

  it("applies nothing when the promotion is rejected", async () => {
    const { person } = await hire("Hopeful");
    const { request } = await proposeAssignmentChange(person.id, { kind: "promotion", validFrom: today, changeReason: "Good year", placement: placement({ positionName: "Lead Editor", positionLevel: "leader" }) }, ids.hr);
    await decideLifecycleChange(ids.approver, request.id, { action: "reject", comment: "Next year" });
    expect(await db().select().from(schema.lifecycleEvent).where(and(eq(schema.lifecycleEvent.personId, person.id), eq(schema.lifecycleEvent.type, "promotion")))).toEqual([]);

    const again = await proposeAssignmentChange(person.id, { kind: "promotion", validFrom: today, changeReason: "Good year", placement: placement({ positionName: "Lead Editor", positionLevel: "leader" }) }, ids.hr);
    await decideLifecycleChange(ids.approver, again.request.id, { action: "approve", comment: null });
    const [promotion] = await db().select().from(schema.lifecycleEvent).where(and(eq(schema.lifecycleEvent.personId, person.id), eq(schema.lifecycleEvent.type, "promotion")));
    expect(promotion.details).toMatchObject({ from: { position: "Editor" }, to: { position: "Lead Editor", positionLevel: "leader" } });
  });
});
