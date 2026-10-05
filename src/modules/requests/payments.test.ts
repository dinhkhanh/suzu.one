// Requests that end in a payment, against a real database (PGlite) (REQ-01, REQ-02): finance's
// "to pay" queue and the paid date and reference that close a request; a trip's advance netted
// against its settlement, both ways; the trip itself becoming the attendance record of its days;
// and the letter an approved confirmation-letter request makes.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { saveTemplate, type TemplateInput } from "@/modules/documents/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { issueConfirmationLetter } from "./letters";
import { listPayouts, markRequestPaid, payoutOf } from "./payments";
import { canPayRequests } from "./policy";
import { REQUEST_TYPE_SEED } from "./seed-types";
import { decideGenericRequest, fileRequest } from "./service";

const ids = {} as Record<"entity" | "other" | "boss" | "huy" | "lan" | "hr", string>;
const money = (amount: number) => `${amount} đ`;
const TODAY = todayInVietnam();
const ALL = { all: true } as const;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);

async function requester(personId: string) {
  const [row] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return { personId, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId };
}

async function invoice(personId: string, amount: number) {
  const [file] = await db()
    .insert(schema.storedFile)
    .values({ bucket: "suzu-private", ownerType: "request_attachment", ownerId: personId, entityId: ids.entity, tier: "personal", fileName: "hoadon.pdf", objectPath: `x/${Math.random()}`, contentType: "application/pdf", sizeBytes: 10, status: "ready" })
    .returning();
  return { payee: "Vietnam Airlines", amount, method: "transfer", bank_account: "0071000 VCB", due_date: "2099-01-01", purpose: "Quyết toán chuyến công tác Đà Nẵng", invoice: [file.id] };
}

const trip = (startDate: string, endDate: string) => ({ destination: "Đà Nẵng", start_date: startDate, end_date: endDate, transport: ["plane"], amount: 6_000_000, needs_accommodation: false, purpose: "Quay TVC cho khách hàng ở Đà Nẵng" });
const advance = (amount: number) => ({ amount, purpose: "Tạm ứng vé máy bay và khách sạn", settle_by: "2099-01-01", method: "cash", agree: true });

async function fileApproved(personId: string, code: string, values: Record<string, unknown>, parentRequestId: string | null = null) {
  const filed = await fileRequest({ code, values: values as never, parentRequestId }, await requester(personId), money);
  await decideGenericRequest(filed.requestId, ids.boss, { action: "approve", comment: null });
  return filed.requestId;
}

const pay = (requestId: string, reference = "FT2610") => markRequestPaid(requestId, { paidOn: TODAY, reference }, ids.boss);

beforeAll(async () => {
  await migrateTestDb();
  const [group, other] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "SZM", taxCode: "0101", wageRegion: 1 },
      { code: "SZC", legalName: "SuZu Creative", shortName: "SZC", taxCode: "0102", wageRegion: 1 },
    ])
    .returning();
  ids.entity = group.id;
  ids.other = other.id;
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  const hire = async (fullName: string, managerId: string | null) =>
    (
      await hirePerson(
        {
          fullName,
          workEmail: `${fullName.toLowerCase()}@suzu.group`,
          profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
          entityId: ids.entity,
          employeeCode: null,
          startDate: "2024-01-01",
          seniorityDate: null,
          placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, seniorityLevel: null, positionLevel: null, managerId, dottedManagerId: null, workLocation: null },
        },
        actor.id,
        { onboarding: false },
      )
    ).person.id;
  ids.boss = await hire("Boss", null);
  ids.huy = await hire("Huy", ids.boss);
  ids.lan = await hire("Lan", ids.boss);
  ids.hr = await hire("Hanh", ids.boss);

  // The types as `pnpm db:seed` ships them, each approved by the line manager alone.
  for (const code of ["business_trip", "advance", "payment", "purchase", "confirmation_letter"]) {
    const seed = REQUEST_TYPE_SEED.find((entry) => entry.code === code)!;
    await db().insert(schema.requestType).values({ ...seed, flow: undefined } as typeof schema.requestType.$inferInsert);
    await db().insert(schema.approvalFlow).values({ requestType: `request:${code}`, entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] } });
  }
  // The two letter templates by the codes `pnpm db:seed` gives them; the salary one is compensation tier.
  const template = (code: string, body: string, tier: TemplateInput["tier"]): TemplateInput => ({ code, name: code, entityId: null, kind: "confirmation_letter", tier, body, letterhead: {}, isActive: true });
  await saveTemplate(null, template("XN-CONG-TAC", "Xác nhận {{person.fullName}} làm việc từ {{employment.startDate}}.", "personal"), ids.boss);
  await saveTemplate(null, template("XN-LUONG", "Thu nhập của {{person.fullName}}: {{salary.total}} đồng.", "compensation"), ids.boss);
});

describe("finance's queue", () => {
  it("lists an approved payment until it is paid, then closes it with the day and the reference", async () => {
    const requestId = await fileApproved(ids.lan, "payment", await invoice(ids.lan, 900_000));
    const waiting = (await listPayouts(ALL, { paidSince: TODAY })).find((row) => row.requestId === requestId)!;
    expect(waiting).toMatchObject({ payout: "payment", amount: 900_000, settlement: { nettedAdvance: 0, toPay: 900_000 }, blocked: null, paidOn: null });

    const { after } = await pay(requestId, "FT26100501");
    expect(after).toMatchObject({ paidOn: TODAY, paidAmount: 900_000, paidReference: "FT26100501" });
    expect(await fails(pay(requestId))).toBe("request_already_paid");
    const [told] = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.lan), eq(schema.notification.kind, "approvals.request_paid")));
    expect(told.params).toMatchObject({ reference: "FT26100501" });
    // Paid long ago, it drops off the list.
    expect((await listPayouts(ALL, { paidSince: addDays(TODAY, 1) })).some((row) => row.requestId === requestId)).toBe(false);
  });

  it("keeps out what is not approved, and a type finance does not pay", async () => {
    const pending = await fileRequest({ code: "payment", values: (await invoice(ids.lan, 100_000)) as never }, await requester(ids.lan), money);
    const letter = await fileApproved(ids.lan, "confirmation_letter", { letter_kind: "introduction", addressed_to: "Đại sứ quán", language: "en", copies: 1, needed_by: "2099-01-01" });
    const listed = (await listPayouts(ALL, { paidSince: TODAY })).map((row) => row.requestId);
    expect(listed).not.toContain(pending.requestId);
    expect(listed).not.toContain(letter);
    expect(await fails(pay(pending.requestId))).toBe("request_not_payable");
  });

  it("shows finance of one entity that entity's requests only", async () => {
    expect(await listPayouts({ all: false, entityIds: [ids.other] }, { paidSince: TODAY })).toEqual([]);
    expect((await listPayouts({ all: false, entityIds: [ids.entity] }, { paidSince: TODAY })).length).toBeGreaterThan(0);
  });
});

describe("a trip's advance and its settlement", () => {
  it("pays the advance first, then only what the trip cost beyond it", async () => {
    const tripId = await fileApproved(ids.huy, "business_trip", trip("2026-09-01", TODAY));
    const advanceId = await fileApproved(ids.huy, "advance", advance(3_000_000), tripId);
    const settlementId = await fileApproved(ids.huy, "payment", await invoice(ids.huy, 5_500_000), tripId);

    // The advance was approved and not paid: settling now would net money that never left.
    expect((await payoutOf(settlementId))!.blocked).toBe("advance_unpaid");
    expect(await fails(pay(settlementId))).toBe("request_advance_unpaid");

    expect((await pay(advanceId)).after.paidAmount).toBe(3_000_000);
    expect((await payoutOf(settlementId))!.settlement).toEqual({ nettedAdvance: 3_000_000, toPay: 2_500_000 });
    expect((await pay(settlementId)).after.paidAmount).toBe(2_500_000);

    // Settled: a further advance under the trip is not paid.
    const late = await fileApproved(ids.huy, "advance", advance(500_000), tripId);
    expect(await fails(pay(late))).toBe("request_already_settled");
  });

  it("records the unspent rest of an advance as paid back", async () => {
    const tripId = await fileApproved(ids.huy, "business_trip", trip("2026-08-10", TODAY));
    const advanceId = await fileApproved(ids.huy, "advance", advance(3_000_000), tripId);
    await pay(advanceId);
    const settlementId = await fileApproved(ids.huy, "payment", await invoice(ids.huy, 1_200_000), tripId);
    expect((await payoutOf(settlementId))!.settlement).toEqual({ nettedAdvance: 3_000_000, toPay: -1_800_000 });
    expect((await pay(settlementId, "PT-0042")).after.paidAmount).toBe(-1_800_000);
    const [told] = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.huy), eq(schema.notification.kind, "approvals.request_repayment_recorded")));
    expect(told.params).toMatchObject({ reference: "PT-0042" });
  });
});

describe("a business trip is filed once", () => {
  it("becomes the attendance record of its days when approved", async () => {
    const tripId = await fileApproved(ids.lan, "business_trip", trip("2099-03-02", "2099-03-04"));
    const rows = await db().select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.personId, ids.lan));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "remote_work", status: "approved", startDate: "2099-03-02", endDate: "2099-03-04", details: { kind: "business_trip", locationName: "Đà Nẵng" } });
    expect(rows[0].reason).toContain(tripId);
  });

  it("is not recorded twice when the days are already on file", async () => {
    await fileApproved(ids.lan, "business_trip", trip("2099-03-03", "2099-03-05"));
    expect(await db().select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.personId, ids.lan))).toHaveLength(1);
  });
});

describe("an approved confirmation letter", () => {
  const hr = (): { principal: Principal; personId: string } => ({ personId: ids.hr, principal: { personId: ids.hr, workforceType: "employee", grants: [{ role: "hr_staff", scope: { type: "entity", id: ids.entity } }] } });
  const letter = (kind: string) => ({ letter_kind: kind, addressed_to: "Ngân hàng VCB", language: "vi", copies: 1, needed_by: "2099-01-01" });

  it("makes the employment letter as the approver and remembers it on the request", async () => {
    const requestId = await fileApproved(ids.huy, "confirmation_letter", letter("employment"));
    const issued = await issueConfirmationLetter(requestId, hr());
    expect(issued).toMatchObject({ number: expect.stringMatching(/^SZM-/) });
    const [submission] = await db().select().from(schema.requestSubmission).where(eq(schema.requestSubmission.approvalRequestId, requestId));
    expect(submission.documentId).toBe((issued as { documentId: string }).documentId);
    expect(await issueConfirmationLetter(requestId, hr())).toEqual({ skipped: "already_issued" });
  });

  it("refuses the salary letter to an approver without the compensation tier, and makes nothing for an introduction", async () => {
    const salary = await fileApproved(ids.huy, "confirmation_letter", letter("salary"));
    expect(await fails(issueConfirmationLetter(salary, hr()))).toBe("document_forbidden");
    const introduction = await fileApproved(ids.huy, "confirmation_letter", letter("introduction"));
    expect(await issueConfirmationLetter(introduction, hr())).toEqual({ skipped: "no_template" });
  });
});

describe("who pays", () => {
  const holder = (role: "finance" | "hr_admin" | "owner", entityId: string | null): Principal => ({ personId: "x", workforceType: "employee", grants: [{ role, scope: entityId ? { type: "entity", id: entityId } : { type: "group" } }] });

  it("is finance of the request's own entity", () => {
    expect(canPayRequests(holder("finance", ids.entity), ids.entity)).toBe(true);
    expect(canPayRequests(holder("finance", ids.entity), ids.other)).toBe(false);
    // A request of nobody's entity takes a group-wide grant.
    expect(canPayRequests(holder("finance", ids.entity), null)).toBe(false);
    expect(canPayRequests(holder("finance", null), null)).toBe(true);
    expect(canPayRequests(holder("hr_admin", null), ids.entity)).toBe(false);
    expect(canPayRequests(holder("owner", null), ids.other)).toBe(true);
    // The screen's door: anywhere at all.
    expect(canPayRequests(holder("finance", ids.other))).toBe(true);
  });
});
