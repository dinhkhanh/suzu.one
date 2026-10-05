// Follow-up requests against a real database (PGlite) (FR-REQ-05): a business trip, the advance
// filed under it once it is approved, and the payment that settles it once it is over — and the
// ways that must be refused: too early, too many, somebody else's trip, a type the trip does not
// name, and a type that would end up under itself.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));

import { eq } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { REQUEST_TYPE_SEED } from "./seed-types";
import type { RequestCategory } from "./enums";
import { decideGenericRequest, fileRequest, findRequestTypeByCode, getGenericRequest, getRequestFamily, listAvailableTypes, type SaveTypeInput, saveRequestType } from "./service";

const ids = {} as Record<"entity" | "boss" | "huy" | "lan", string>;
const money = (amount: number) => `${amount} đ`;
const TODAY = todayInVietnam();
const principal = (personId: string): Principal => ({ personId, workforceType: "employee", grants: [] });

async function requester(personId: string) {
  const [row] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return { personId, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId };
}

const trip = (endDate: string) => ({
  destination: "Đà Nẵng",
  start_date: "2026-01-01",
  end_date: endDate,
  transport: ["plane"],
  amount: 6_000_000,
  needs_accommodation: false,
  purpose: "Quay TVC cho khách hàng ở Đà Nẵng",
});
const advance = { amount: 3_000_000, purpose: "Tạm ứng vé máy bay và khách sạn", settle_by: "2099-01-01", method: "cash", agree: true };

const pick = <Row extends object, Key extends keyof Row>(row: Row, keys: readonly Key[]) => Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<Row, Key>;

/** A stored type as the designer would send it back, with `change` applied. */
async function resave(code: string, change: Partial<SaveTypeInput>) {
  const row = (await findRequestTypeByCode(code))!;
  const input: SaveTypeInput = {
    ...pick(row, ["code", "nameVi", "nameEn", "descriptionVi", "descriptionEn", "entityId", "form", "icon", "sortOrder", "active", "slaRemindAfterDays", "slaEscalateAfterDays", "followUps", "standalone", "payout"]),
    category: row.category as RequestCategory,
    slaEscalateTo: row.slaEscalateTo ?? null,
  };
  return saveRequestType(row.id, { ...input, ...change }, ids.boss);
}

async function invoice(personId: string) {
  const [file] = await db()
    .insert(schema.storedFile)
    .values({ bucket: "suzu-private", ownerType: "request_attachment", ownerId: personId, entityId: ids.entity, tier: "personal", fileName: "hoadon.pdf", objectPath: `x/${Math.random()}`, contentType: "application/pdf", sizeBytes: 10, status: "ready" })
    .returning();
  return { payee: "Vietnam Airlines", amount: 5_500_000, method: "cash", due_date: "2099-01-01", purpose: "Quyết toán chuyến công tác Đà Nẵng", invoice: [file.id] };
}

async function fileTrip(personId: string, endDate: string, approve = true) {
  const filed = await fileRequest({ code: "business_trip", values: trip(endDate) }, await requester(personId), money);
  if (approve) await decideGenericRequest(filed.requestId, ids.boss, { action: "approve", comment: null });
  return filed;
}

beforeAll(async () => {
  await migrateTestDb();
  const [group] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "SZM", taxCode: "0101", wageRegion: 1 }).returning();
  ids.entity = group.id;
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

  // The types exactly as `pnpm db:seed` ships them — follow-ups included — each approved by the
  // line manager alone, so the tests are about the family rather than about who signs.
  for (const code of ["business_trip", "advance", "payment", "purchase"]) {
    const seed = REQUEST_TYPE_SEED.find((entry) => entry.code === code)!;
    await db().insert(schema.requestType).values({ ...seed, flow: undefined } as typeof schema.requestType.$inferInsert);
    await db().insert(schema.approvalFlow).values({ requestType: `request:${code}`, entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] } });
  }
});

describe("filing under a business trip", () => {
  it("waits for the trip to be approved before its advance", async () => {
    const pending = await fileTrip(ids.huy, "2099-12-31", false);
    await expect(fileRequest({ code: "advance", values: advance, parentRequestId: pending.requestId }, await requester(ids.huy), money)).rejects.toThrow("follow_up_parent_not_approved");
  });

  it("files an advance under an approved trip and remembers which", async () => {
    const parent = await fileTrip(ids.huy, "2099-12-31");
    const child = await fileRequest({ code: "advance", values: advance, parentRequestId: parent.requestId }, await requester(ids.huy), money);
    const [row] = await db().select().from(schema.requestSubmission).where(eq(schema.requestSubmission.id, child.submissionId));
    expect(row.parentSubmissionId).toBe(parent.submissionId);
    // More than one advance is allowed.
    await fileRequest({ code: "advance", values: advance, parentRequestId: parent.requestId }, await requester(ids.huy), money);
  });

  it("opens the settling payment only from the trip's last day, and only once", async () => {
    const ongoing = await fileTrip(ids.huy, "2099-12-31");
    await expect(fileRequest({ code: "payment", values: await invoice(ids.huy), parentRequestId: ongoing.requestId }, await requester(ids.huy), money)).rejects.toThrow("follow_up_not_yet");

    const over = await fileTrip(ids.huy, TODAY);
    const first = await fileRequest({ code: "payment", values: await invoice(ids.huy), parentRequestId: over.requestId }, await requester(ids.huy), money);
    await expect(fileRequest({ code: "payment", values: await invoice(ids.huy), parentRequestId: over.requestId }, await requester(ids.huy), money)).rejects.toThrow("follow_up_limit_reached");
    // A rejected one no longer counts: the requester files it again.
    await decideGenericRequest(first.requestId, ids.boss, { action: "reject", comment: "Sai hóa đơn" });
    await fileRequest({ code: "payment", values: await invoice(ids.huy), parentRequestId: over.requestId }, await requester(ids.huy), money);
  });

  it("refuses somebody else's trip, and a type the trip does not name", async () => {
    const parent = await fileTrip(ids.huy, "2099-12-31");
    await expect(fileRequest({ code: "advance", values: advance, parentRequestId: parent.requestId }, await requester(ids.lan), money)).rejects.toThrow("follow_up_parent_not_found");
    const purchase = { item: "Máy quay", quantity: 1, amount: 1_000_000, category: "equipment", needed_by: "2099-01-01", reason: "Cho chuyến công tác" };
    await expect(fileRequest({ code: "purchase", values: purchase, parentRequestId: parent.requestId }, await requester(ids.huy), money)).rejects.toThrow("follow_up_not_allowed");
  });

  it("shows the family on both sides, with what the approved children come to", async () => {
    const parent = await fileTrip(ids.huy, "2099-12-31");
    const child = await fileRequest({ code: "advance", values: advance, parentRequestId: parent.requestId }, await requester(ids.huy), money);
    await decideGenericRequest(child.requestId, ids.boss, { action: "approve", comment: null });

    const view = (await getGenericRequest({ personId: ids.huy, principal: principal(ids.huy) }, parent.requestId))!;
    const family = await getRequestFamily(view, { entityId: ids.entity });
    expect(family.children.map((row) => row.requestId)).toEqual([child.requestId]);
    const standing = Object.fromEntries(family.followUps.map((entry) => [entry.code, entry]));
    expect(standing.advance).toMatchObject({ live: 1, approvedAmount: 3_000_000, gate: { open: true } });
    expect(standing.payment.gate).toEqual({ open: false, reason: "not_yet", opensOn: "2099-12-31" });

    // The approver of the advance sees which trip it is for; nobody but the requester is offered a filing.
    const childView = (await getGenericRequest({ personId: ids.boss, principal: principal(ids.boss) }, child.requestId))!;
    expect((await getRequestFamily(childView, { entityId: ids.entity })).parent?.requestId).toBe(parent.requestId);
    const bossView = (await getGenericRequest({ personId: ids.boss, principal: principal(ids.boss) }, parent.requestId))!;
    expect((await getRequestFamily(bossView, { entityId: ids.entity })).followUps.every((entry) => entry.gate === null)).toBe(true);
  });
});

describe("a type that is only ever a follow-up", () => {
  it("is left off the picker and refused on its own, but filed under its parent", async () => {
    await resave("advance", { standalone: false });
    try {
      expect((await listAvailableTypes(ids.entity)).map((row) => row.code)).not.toContain("advance");
      await expect(fileRequest({ code: "advance", values: advance }, await requester(ids.huy), money)).rejects.toThrow("request_type_needs_parent");
      const parent = await fileTrip(ids.huy, "2099-12-31");
      await fileRequest({ code: "advance", values: advance, parentRequestId: parent.requestId }, await requester(ids.huy), money);
    } finally {
      await resave("advance", { standalone: true });
    }
  });

  it("cannot be designed into a loop", async () => {
    await expect(resave("advance", { followUps: [{ code: "business_trip", opensWhen: "approved" }] })).rejects.toThrow("follow_up_cycle");
  });
});
