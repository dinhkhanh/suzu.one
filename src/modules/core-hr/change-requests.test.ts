// The approval engine end to end, through its first request type: an employee's change request.
// Submit → HR is asked → approve applies the change in the same transaction; reject, return and
// resubmit, withdraw; who may and may not decide; nothing restricted in plain text. PGlite.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { db, schema } from "@/lib/db";
import { countInbox, listInbox, listMyRequests, withdrawRequest } from "@/modules/platform/approvals/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { decideProfileChange, getProfileChange, listProfileChanges, type ProfileChangeInput, resubmitProfileChange, revealProfileChange, submitProfileChange } from "./change-requests";
import { getSensitiveFields } from "./records";
import { hirePerson } from "./service";

const ids = {} as Record<"media" | "creative" | "video" | "manager" | "hrStaff" | "hrAdmin" | "otherHr" | "payroll" | "huy" | "owner", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
let who: Record<"huy" | "manager" | "hrStaff" | "hrAdmin" | "otherHr" | "payroll", { personId: string; principal: Principal }>;

const NO_CHANGE: ProfileChangeInput = {
  personal: { phone: "0900000000", personalEmail: null, permanentAddress: null, currentAddress: null, maritalStatus: null },
  restricted: { nationalId: null, nationalIdIssuedOn: null, nationalIdIssuedAt: null, taxCode: null, socialInsuranceNumber: null },
  bankAccount: null,
};
const change = (overrides: Partial<ProfileChangeInput>): ProfileChangeInput => ({ ...NO_CHANGE, ...overrides });
const BANK = { bankName: "Techcombank", accountNumber: "19031234567890", accountHolder: "HO GIA HUY", branch: null };
const approve = { action: "approve" as const, comment: null, verifiedSecondChannel: false };

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  const hire = async (name: string, entityId: string, managerId: string | null = null) => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: "0900000000", personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId,
        employeeCode: null,
        startDate: "2024-01-01",
        seniorityDate: null,
        placement: { workforceType: "employee", branchId: null, departmentId: video.id, teamId: null, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null },
      },
      actor.id,
    );
    return person.id;
  };
  const manager = await hire("Line Manager", media.id);
  const hrStaff = await hire("Hr Staff", media.id);
  const hrAdmin = await hire("Hr Admin", media.id);
  const otherHr = await hire("Other Hr", creative.id);
  const payroll = await hire("Pay Roll", media.id);
  const owner = await hire("The Owner", media.id);
  const huy = await hire("Ho Gia Huy", media.id, manager);
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, manager, hrStaff, hrAdmin, otherHr, payroll, huy, owner });

  const grants: Record<string, Grant[]> = {
    [hrStaff]: [{ role: "hr_staff", scope: { type: "entity", id: media.id } }],
    [hrAdmin]: [{ role: "hr_admin", scope: { type: "group" } }],
    [otherHr]: [{ role: "hr_staff", scope: { type: "entity", id: creative.id } }],
    [payroll]: [{ role: "payroll", scope: { type: "group" } }],
    [manager]: [{ role: "department_head", scope: { type: "department", id: video.id } }],
    [owner]: [{ role: "owner", scope: { type: "group" } }],
  };
  for (const [personId, list] of Object.entries(grants)) {
    await db().insert(schema.roleAssignment).values(list.map((grant) => ({ personId, role: grant.role, scopeType: grant.scope.type, scopeId: grant.scope.type === "group" ? null : grant.scope.id })));
  }
  const viewer = (personId: string) => ({ personId, principal: principal(personId, grants[personId] ?? []) });
  who = { huy: viewer(huy), manager: viewer(manager), hrStaff: viewer(hrStaff), hrAdmin: viewer(hrAdmin), otherHr: viewer(otherHr), payroll: viewer(payroll) };
});

beforeEach(async () => {
  // Every test starts without an open request.
  const open = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.status, "pending"));
  for (const request of open) await db().transaction((tx) => withdrawRequest(tx, request.id, request.requesterPersonId));
  await db().delete(schema.notification);
});

const profileOf = async (personId: string) => (await db().select().from(schema.personProfile).where(eq(schema.personProfile.personId, personId)))[0];

describe("submitting", () => {
  it("asks the HR people with authority over the employee — not the owner, not other entities' HR, not the manager", async () => {
    const { request, payload } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0911111111" } }));
    expect(payload).toEqual({ personal: { phone: { from: "0900000000", to: "0911111111" } }, restricted: [] });
    expect(request.summary).toBe("Số điện thoại");
    expect(request.link).toBe(`/approvals/profile-change/${request.id}`);

    const asked = await db().select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, request.id));
    expect(asked.map((row) => row.approverPersonId).sort()).toEqual([ids.hrStaff, ids.hrAdmin].sort());
    expect(await countInbox(ids.hrStaff)).toBe(1);
    expect(await countInbox(ids.manager)).toBe(0);
    expect((await listInbox(ids.hrAdmin))[0]).toMatchObject({ id: request.id, requesterName: "Ho Gia Huy", type: "profile_change" });
    expect((await listMyRequests(ids.huy))[0].id).toBe(request.id);

    const notified = await db().select().from(schema.notification).where(eq(schema.notification.kind, "approvals.requested"));
    expect(notified.map((row) => row.recipientPersonId).sort()).toEqual([ids.hrStaff, ids.hrAdmin].sort());
  });

  it("refuses an empty request and a second one while the first is open", async () => {
    await expect(submitProfileChange(ids.huy, NO_CHANGE)).rejects.toThrow("change_request_empty");
    await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, currentAddress: "12 Lê Lợi" } }));
    await expect(submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0922222222" } }))).rejects.toThrow("change_request_open");
  });

  it("falls back to the owners when HR itself is the requester and nobody else holds the permission", async () => {
    // Take the other HR people out of the picture for this one request.
    await db().update(schema.person).set({ status: "suspended" }).where(eq(schema.person.id, ids.hrStaff));
    const { request } = await submitProfileChange(ids.hrAdmin, change({ personal: { ...NO_CHANGE.personal, phone: "0933333333" } }));
    await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, ids.hrStaff));
    const asked = await db().select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, request.id));
    expect(asked.map((row) => row.approverPersonId)).toEqual([ids.owner]);
  });

  it("keeps restricted values out of the plain payload, the summary and the stored ciphertext", async () => {
    const { request, payload } = await submitProfileChange(ids.huy, change({ restricted: { ...NO_CHANGE.restricted, nationalId: "079201001234", taxCode: "8123456789" }, bankAccount: BANK }));
    expect(payload.restricted).toEqual(["nationalId", "taxCode", "bankAccount"]);
    const [raw] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, request.id));
    const stored = JSON.stringify(raw);
    for (const secret of ["079201001234", "8123456789", "19031234567890", "Techcombank"]) expect(stored).not.toContain(secret);
    expect(raw.payloadEnc).toMatch(/^v1\./);
  });
});

describe("deciding", () => {
  it("approve applies the personal change, tells the requester, and closes the request for everyone else", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0944444444", maritalStatus: "married" } }));
    const result = await decideProfileChange(who.hrStaff, request.id, approve);
    expect(result.outcome).toBe("approved");
    expect(await profileOf(ids.huy)).toMatchObject({ phone: "0944444444", maritalStatus: "married" });
    expect(await countInbox(ids.hrAdmin)).toBe(0);
    await expect(decideProfileChange(who.hrAdmin, request.id, approve)).rejects.toThrow("approval_not_pending");

    const told = await db().select().from(schema.notification).where(eq(schema.notification.kind, "approvals.decided"));
    expect(told.map((row) => [row.recipientPersonId, row.params.outcome])).toEqual([[ids.huy, "approved"]]);
    await db().update(schema.personProfile).set({ phone: "0900000000", maritalStatus: null }).where(eq(schema.personProfile.personId, ids.huy));
  });

  it("reject and return need a reason and change nothing", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0955555555" } }));
    await expect(decideProfileChange(who.hrStaff, request.id, { ...approve, action: "reject" })).rejects.toThrow("approval_comment_required");
    expect((await decideProfileChange(who.hrStaff, request.id, { ...approve, action: "reject", comment: "Số không đúng" })).outcome).toBe("rejected");
    expect((await profileOf(ids.huy)).phone).toBe("0900000000");
    const view = await getProfileChange(who.huy, request.id);
    expect(view?.events.map((event) => [event.type, event.comment])).toEqual([["submitted", null], ["rejected", "Số không đúng"]]);
  });

  it("return for changes → the requester corrects and resubmits → approve applies the corrected values", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, currentAddress: "12 Le Loi" } }));
    await decideProfileChange(who.hrAdmin, request.id, { ...approve, action: "return", comment: "Ghi đủ phường, quận" });
    expect(await countInbox(ids.hrAdmin)).toBe(0);
    await expect(resubmitProfileChange(ids.manager, request.id, NO_CHANGE)).rejects.toThrow();
    await resubmitProfileChange(ids.huy, request.id, change({ personal: { ...NO_CHANGE.personal, currentAddress: "12 Lê Lợi, P. Bến Nghé, Q.1" } }));
    expect(await countInbox(ids.hrAdmin)).toBe(1);
    expect((await decideProfileChange(who.hrStaff, request.id, approve)).outcome).toBe("approved");
    expect((await profileOf(ids.huy)).currentAddress).toBe("12 Lê Lợi, P. Bến Nghé, Q.1");
  });

  it("the requester may withdraw, and nobody can decide a withdrawn request", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0966666666" } }));
    await expect(db().transaction((tx) => withdrawRequest(tx, request.id, ids.hrStaff))).rejects.toThrow("approval_not_requester");
    await db().transaction((tx) => withdrawRequest(tx, request.id, ids.huy));
    await expect(decideProfileChange(who.hrStaff, request.id, approve)).rejects.toThrow("approval_not_pending");
    expect((await profileOf(ids.huy)).phone).toBe("0900000000");
  });

  it("nobody decides their own request, and nobody decides who was not asked", async () => {
    const own = await submitProfileChange(ids.hrStaff, change({ personal: { ...NO_CHANGE.personal, phone: "0977777777" } }));
    const asked = await db().select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, own.request.id));
    expect(asked.map((row) => row.approverPersonId)).toEqual([ids.hrAdmin]);
    await expect(decideProfileChange(who.hrStaff, own.request.id, approve)).rejects.toThrow("forbidden");

    const { request } = await submitProfileChange(ids.huy, change({ personal: { ...NO_CHANGE.personal, phone: "0988888888" } }));
    // The line manager (also department head) has no HR authority; another entity's HR has none here.
    await expect(decideProfileChange(who.manager, request.id, approve)).rejects.toThrow("forbidden");
    await expect(decideProfileChange(who.otherHr, request.id, approve)).rejects.toThrow("forbidden");
    // Holding the permission without having been asked is not enough either.
    const lateHr = { personId: ids.payroll, principal: principal(ids.payroll, [{ role: "hr_admin", scope: { type: "group" } }]) };
    await expect(decideProfileChange(lateHr, request.id, approve)).rejects.toThrow("approval_not_assignee");
  });

  it("a bank account change needs the second-channel confirmation, which is kept with the decision", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ restricted: { ...NO_CHANGE.restricted, taxCode: "8123456789" }, bankAccount: BANK }));
    await expect(decideProfileChange(who.hrStaff, request.id, approve)).rejects.toThrow("change_request_verification_required");
    expect((await decideProfileChange(who.hrStaff, request.id, { ...approve, verifiedSecondChannel: true })).outcome).toBe("approved");

    const fields = await getSensitiveFields(who.hrAdmin.principal, ids.huy);
    expect(fields).toMatchObject({ taxCode: "8123456789", nationalId: null, bankAccounts: [BANK] });
    const events = await db().select().from(schema.approvalEvent).where(eq(schema.approvalEvent.requestId, request.id));
    expect(events.find((event) => event.type === "approved")?.meta).toEqual({ verifiedSecondChannel: true });

    // A later account becomes the pay account; the record itself never holds plain text.
    const next = await submitProfileChange(ids.huy, change({ bankAccount: { ...BANK, bankName: "ACB", accountNumber: "555666777" } }));
    await decideProfileChange(who.hrAdmin, next.request.id, { ...approve, verifiedSecondChannel: true });
    expect((await getSensitiveFields(who.hrAdmin.principal, ids.huy))?.bankAccounts.map((account) => account.accountNumber)).toEqual(["555666777"]);
    const [raw] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, ids.huy));
    expect(JSON.stringify(raw)).not.toContain("555666777");
  });

  it("an approver below the restricted tier cannot decide or see a request that carries restricted values", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ restricted: { ...NO_CHANGE.restricted, socialInsuranceNumber: "7912345678" } }));
    // Asked by the flow (imagine a role that manages people but reads only the personal tier).
    const [step] = await db().select().from(schema.approvalStep).where(eq(schema.approvalStep.requestId, request.id));
    await db().insert(schema.approvalAssignee).values({ stepId: step.id, requestId: request.id, approverPersonId: ids.manager });
    const weakHr = { personId: ids.manager, principal: principal(ids.manager, [{ role: "department_head", scope: { type: "department", id: ids.video } }]) };
    expect((await getProfileChange(weakHr, request.id))?.canDecide).toBe(false);
    expect((await getProfileChange(weakHr, request.id))?.canReveal).toBe(false);
    expect(await revealProfileChange(weakHr, request.id)).toBeNull();
    await expect(decideProfileChange(weakHr, request.id, approve)).rejects.toThrow("forbidden");
  });
});

describe("reading", () => {
  it("the requester, the approvers and HR over the person may open a request; the line manager and other entities' HR may not", async () => {
    const { request } = await submitProfileChange(ids.huy, change({ restricted: { ...NO_CHANGE.restricted, nationalId: "079201009999" } }));
    expect((await getProfileChange(who.huy, request.id))?.isRequester).toBe(true);
    expect((await getProfileChange(who.hrStaff, request.id))?.canDecide).toBe(true);
    expect(await getProfileChange(who.manager, request.id)).toBeNull();
    expect(await getProfileChange(who.otherHr, request.id)).toBeNull();
    expect(await getProfileChange(who.payroll, request.id)).toBeNull();

    expect((await revealProfileChange(who.hrStaff, request.id))?.values).toEqual({ nationalId: "079201009999" });
    expect((await revealProfileChange(who.huy, request.id))?.values).toEqual({ nationalId: "079201009999" });
    expect(await revealProfileChange(who.manager, request.id)).toBeNull();

    expect(await listProfileChanges(who.manager, ids.huy)).toBeNull();
    expect((await listProfileChanges(who.hrStaff, ids.huy, "pending"))?.map((row) => row.id)).toEqual([request.id]);
  });
});
