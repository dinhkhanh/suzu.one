// Expense claims against a real database (PGlite): filing one, the approval turning it into money
// in a payroll run, and the three ways that can go wrong — paying it twice, two claims quietly
// replacing each other, and a run that is cancelled underneath a claim already in it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));

import { and, eq, inArray } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { findOpenRegularRun, findOpenRegularRuns } from "@/modules/payroll/service";
import { tableToCsv } from "@/modules/platform/export/csv";
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { ExpenseLine } from "./engine/expense";
import { buildExpenseClaimsExport } from "./exports";
import { claimsOwed, fileExpenseClaim, getExpenseClaim, listExpenseClaims } from "./expense";
import { EXPENSE_CLAIM_CODE, postApprovedClaim, REIMBURSEMENT_COMPONENT, sweepApprovedClaims } from "./expense-posting";
import { REQUEST_TYPE_SEED } from "./seed-types";
import { decideGenericRequest } from "./service";

const ids = {} as Record<"entity" | "other" | "boss" | "huy" | "lan", string>;
const TODAY = new Date().toISOString().slice(0, 10);
const money = (amount: number) => `${amount} đ`;

const line = (overrides: Partial<ExpenseLine> = {}): ExpenseLine => ({ lineDate: TODAY, category: "transport", description: "Taxi", amount: 250_000, receiptFileId: null, projectTag: null, ...overrides });

async function requester(personId: string) {
  const [row] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return { personId, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId };
}

/** A draft regular run for a month, the kind an approved claim looks for. */
async function openRun(entityId: string, month: string) {
  const [run] = await db().insert(schema.payrollRun).values({ entityId, month, kind: "regular", status: "draft", createdByPersonId: ids.boss }).returning();
  return run;
}

async function fileAndApprove(personId: string, lines: ExpenseLine[], approvers: string[]) {
  const filed = await fileExpenseClaim({ values: { title: "Công tác Đà Nẵng", project_tag: null, note: null }, lines }, await requester(personId), money);
  for (const approver of approvers) await decideGenericRequest(filed.requestId, approver, { action: "approve", comment: null });
  return filed;
}

/**
 * The reimbursement line payroll ended up with, read from the run's own table rather than through
 * payroll's API: a module boundary the production code respects, and no figure ever comes back out
 * of payroll. The binding is `payroll/field-contexts.ts`'s, repeated here on purpose — if payroll
 * changes how it seals a figure, this test should notice.
 */
async function reimbursementOf(runId: string, personId: string): Promise<{ amount: number; note: string | null } | null> {
  const [row] = await db()
    .select()
    .from(schema.payrollRunInput)
    .where(and(eq(schema.payrollRunInput.runId, runId), eq(schema.payrollRunInput.personId, personId), eq(schema.payrollRunInput.code, REIMBURSEMENT_COMPONENT)))
    .limit(1);
  return row ? { amount: Number(fieldCipher().decrypt(row.amountEnc, `payroll_run_input.amount:${row.id}`)), note: row.note } : null;
}

beforeAll(async () => {
  await migrateTestDb();
  // Payroll takes a figure only under a code its catalogue holds as a typed-in component — what
  // `pnpm db:seed` gives every real database. Without it the posting is refused, not skipped.
  await db().insert(schema.payComponent).values({ code: REIMBURSEMENT_COMPONENT, name: "Hoàn ứng chi phí", kind: "earning", category: "other", source: "input", taxTreatment: "exempt", validFrom: "2026-01-01", status: "approved" });
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
  const hire = async (fullName: string, managerId: string | null, entityId = ids.entity) =>
    (
      await hirePerson(
        {
          fullName,
          workEmail: `${fullName.toLowerCase().replaceAll(" ", ".")}@suzu.group`,
          profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
          entityId,
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

  // The claim type, exactly as `pnpm db:seed` ships it — but with the line manager alone, so the
  // tests are about the money rather than about who signs.
  const seed = REQUEST_TYPE_SEED.find((type) => type.code === EXPENSE_CLAIM_CODE)!;
  await db().insert(schema.requestType).values({ code: seed.code, nameVi: seed.nameVi, nameEn: seed.nameEn, category: seed.category, form: seed.form, sortOrder: seed.sortOrder });
  await db().insert(schema.approvalFlow).values({ requestType: `request:${EXPENSE_CLAIM_CODE}`, entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] } });
});

describe("filing a claim", () => {
  it("asks for the lines added up, never a typed total", async () => {
    const filed = await fileExpenseClaim({ values: { title: "Taxi và ăn trưa", project_tag: null, note: null }, lines: [line({ amount: 250_000 }), line({ category: "meals", amount: 120_000 })] }, await requester(ids.huy), money);
    const [submission] = await db().select().from(schema.requestSubmission).where(eq(schema.requestSubmission.id, filed.submissionId));
    expect(submission.amount).toBe(370_000);
    const lines = await db().select().from(schema.expenseClaimLine).where(eq(schema.expenseClaimLine.submissionId, filed.submissionId));
    expect(lines).toHaveLength(2);
  });

  it("refuses a claim the engine would refuse", async () => {
    await expect(fileExpenseClaim({ values: { title: "Hôm qua chưa đến", project_tag: null, note: null }, lines: [line({ lineDate: "2099-01-01" })] }, await requester(ids.huy), money)).rejects.toThrow("expense_date_in_future");
  });

  it("records a receipt as an attachment of the request, so the attachment rule guards it", async () => {
    const [file] = await db().insert(schema.storedFile).values({ bucket: "suzu-private", ownerType: "request_attachment", ownerId: ids.huy, entityId: ids.entity, tier: "personal", fileName: "hoadon.pdf", objectPath: "x/1", contentType: "application/pdf", sizeBytes: 10, status: "ready" }).returning();
    const filed = await fileExpenseClaim({ values: { title: "Khách sạn", project_tag: null, note: null }, lines: [line({ amount: 2_000_000, category: "accommodation", receiptFileId: file.id })] }, await requester(ids.huy), money);
    const [submission] = await db().select().from(schema.requestSubmission).where(eq(schema.requestSubmission.id, filed.submissionId));
    expect(submission.attachmentFileIds).toContain(file.id);
  });

  it("refuses a receipt that is somebody else's upload, or not a finished one", async () => {
    const stored = (ownerId: string, status: "ready" | "pending", objectPath: string) => ({ bucket: "suzu-private", ownerType: "request_attachment", ownerId, entityId: ids.entity, tier: "personal" as const, fileName: "hoadon.pdf", objectPath, contentType: "application/pdf", sizeBytes: 10, status });
    const [lans, pending] = await db().insert(schema.storedFile).values([stored(ids.lan, "ready", "x/lan"), stored(ids.huy, "pending", "x/pending")]).returning();
    for (const receiptFileId of [lans.id, pending.id]) {
      await expect(fileExpenseClaim({ values: { title: "Hoá đơn của người khác", project_tag: null, note: null }, lines: [line({ amount: 100_000, receiptFileId })] }, await requester(ids.huy), money)).rejects.toThrow("form_value_not_a_file");
    }
  });
});

describe("approving one", () => {
  it("puts its figure into the entity's open run", async () => {
    const run = await openRun(ids.entity, "2026-10");
    const filed = await fileAndApprove(ids.huy, [line({ amount: 480_000 })], [ids.boss]);

    const input = await reimbursementOf(run.id, ids.huy);
    expect(input?.amount).toBe(480_000);
    const [posting] = await db().select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, filed.submissionId));
    expect(posting.runId).toBe(run.id);
  });

  it("adds a second claim to the first rather than replacing it", async () => {
    const run = await openRun(ids.other, "2026-10");
    const [person] = await db().update(schema.person).set({ primaryEntityId: ids.other }).where(eq(schema.person.id, ids.lan)).returning();
    expect(person.primaryEntityId).toBe(ids.other);

    await fileAndApprove(ids.lan, [line({ amount: 300_000 })], [ids.boss]);
    await fileAndApprove(ids.lan, [line({ amount: 45_000, category: "supplies" })], [ids.boss]);

    // One line in the run, holding both claims — `payroll_run_input` is keyed by
    // (run, person, component), so a per-claim line would have overwritten the first.
    expect((await reimbursementOf(run.id, ids.lan))?.amount).toBe(345_000);
    const postings = await db().select().from(schema.expenseClaimPosting).where(and(eq(schema.expenseClaimPosting.runId, run.id), eq(schema.expenseClaimPosting.personId, ids.lan)));
    expect(postings).toHaveLength(2);
  });

  it("leaves the claim waiting when the entity has no open run", async () => {
    const [lonely] = await db().insert(schema.entity).values({ code: "SZG", legalName: "SuZu Group", shortName: "SZG", taxCode: "0103", wageRegion: 1 }).returning();
    await db().update(schema.person).set({ primaryEntityId: lonely.id }).where(eq(schema.person.id, ids.huy));
    const filed = await fileAndApprove(ids.huy, [line({ amount: 90_000 })], [ids.boss]);

    expect(await db().select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, filed.submissionId))).toEqual([]);
    // A sweep with still no run for it counts it as waiting, without a transaction for it.
    const transaction = vi.spyOn(db(), "transaction");
    try {
      expect(await sweepApprovedClaims(ids.boss)).toMatchObject({ posted: 0, released: 0, stillWaiting: 1 });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }

    // …until a run exists, and the sweep offers it again.
    const run = await openRun(lonely.id, "2026-11");
    // The sweep asks for every entity's open run at once: the same answer as one at a time.
    const open = await findOpenRegularRuns([lonely.id, ids.entity, ids.other, lonely.id]);
    for (const entityId of [lonely.id, ids.entity, ids.other]) expect(open.get(entityId) ?? null).toEqual(await findOpenRegularRun(entityId));
    expect(open.get(lonely.id)?.id).toBe(run.id);
    expect((await sweepApprovedClaims(ids.boss)).posted).toBe(1);
    expect((await reimbursementOf(run.id, ids.huy))?.amount).toBe(90_000);

    // Idempotent: a second sweep changes nothing.
    expect((await sweepApprovedClaims(ids.boss)).posted).toBe(0);
    expect((await reimbursementOf(run.id, ids.huy))?.amount).toBe(90_000);
  });
});

describe("paying it twice", () => {
  it("is refused by the database, not only by the service", async () => {
    const run = await openRun(ids.entity, "2026-12");
    const filed = await fileAndApprove(ids.lan, [line({ amount: 111_000 })], [ids.boss]);
    // Not through the use-case — straight past it, the way a race would arrive.
    const refusal = await db()
      .insert(schema.expenseClaimPosting)
      .values({ submissionId: filed.submissionId, runId: run.id, personId: ids.lan, amount: 111_000 })
      .then(() => null)
      .catch((error: unknown) => error);
    const cause = (refusal as { cause?: { code?: string; constraint?: string } } | null)?.cause;
    expect(cause?.code).toBe("23505");
    expect(cause?.constraint).toBe("expense_claim_posting_submission_key");
  });

  it("is a no-op through the use-case: the claim is already where it is", async () => {
    const run = await openRun(ids.entity, "2027-01");
    await db().update(schema.person).set({ primaryEntityId: ids.entity }).where(eq(schema.person.id, ids.lan));
    const filed = await fileAndApprove(ids.lan, [line({ amount: 222_000 })], [ids.boss]);
    const before = await reimbursementOf(run.id, ids.lan);

    const again = await db().transaction((tx) => postApprovedClaim(tx, { submissionId: filed.submissionId, personId: ids.lan, entityId: ids.entity, amount: 222_000 }, ids.boss));
    expect(again.state).toBe("posted");
    expect((await reimbursementOf(run.id, ids.lan))?.amount).toBe(before?.amount);
  });
});

describe("a run cancelled underneath a claim", () => {
  it("puts the claim back to waiting and lets the next run take it", async () => {
    const [entity] = await db().insert(schema.entity).values({ code: "SZX", legalName: "SuZu X", shortName: "SZX", taxCode: "0104", wageRegion: 1 }).returning();
    await db().update(schema.person).set({ primaryEntityId: entity.id }).where(eq(schema.person.id, ids.huy));
    const first = await openRun(entity.id, "2027-02");
    const filed = await fileAndApprove(ids.huy, [line({ amount: 333_000 })], [ids.boss]);
    expect((await reimbursementOf(first.id, ids.huy))?.amount).toBe(333_000);

    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, first.id));
    // The read tells the truth at once, without changing anything.
    const view = await getExpenseClaim({ personId: ids.huy, principal: { personId: ids.huy, workforceType: "employee", grants: [] } }, filed.requestId);
    expect(view?.payment.state).toBe("awaiting_payroll");

    const second = await openRun(entity.id, "2027-03");
    const swept = await sweepApprovedClaims(ids.boss);
    expect(swept.posted).toBe(1);
    expect((await reimbursementOf(second.id, ids.huy))?.amount).toBe(333_000);
    const postings = await db().select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, filed.submissionId));
    expect(postings).toHaveLength(1);
    expect(postings[0].runId).toBe(second.id);
  });
});

describe("one sweep over many claims", () => {
  // The sweep handles every claim in one transaction and a fixed number of statements; what it
  // posts must be what offering the claims one by one did: one line per person, the sum of theirs.
  it("posts them all in one transaction, one summed line per person, and counts what moved", async () => {
    const [entity] = await db().insert(schema.entity).values({ code: "SZW", legalName: "SuZu W", shortName: "SZW", taxCode: "0106", wageRegion: 1 }).returning();
    await db().update(schema.person).set({ primaryEntityId: entity.id }).where(inArray(schema.person.id, [ids.huy, ids.lan]));
    // Filed while the entity has no open run: they wait.
    for (const [person, amount] of [[ids.huy, 10_000], [ids.huy, 20_000], [ids.lan, 40_000]] as const) await fileAndApprove(person, [line({ amount })], [ids.boss]);
    // And one freed from a cancelled run.
    const cancelled = await openRun(entity.id, "2027-05");
    await fileAndApprove(ids.lan, [line({ amount: 5_000 })], [ids.boss]);
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, cancelled.id));
    const run = await openRun(entity.id, "2027-06");

    const transaction = vi.spyOn(db(), "transaction");
    try {
      expect(await sweepApprovedClaims(null)).toEqual({ posted: 4, released: 1, stillWaiting: 0 });
      expect(transaction).toHaveBeenCalledTimes(1);
    } finally {
      transaction.mockRestore();
    }
    expect((await reimbursementOf(run.id, ids.huy))?.amount).toBe(30_000);
    expect((await reimbursementOf(run.id, ids.lan))?.amount).toBe(45_000);
    expect(await db().select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.runId, cancelled.id))).toEqual([]);
    expect(await sweepApprovedClaims(null)).toEqual({ posted: 0, released: 0, stillWaiting: 0 });
  });
});

describe("a run that has moved past calculated", () => {
  it("keeps the figure it was signed with", async () => {
    const [entity] = await db().insert(schema.entity).values({ code: "SZY", legalName: "SuZu Y", shortName: "SZY", taxCode: "0105", wageRegion: 1 }).returning();
    await db().update(schema.person).set({ primaryEntityId: entity.id }).where(eq(schema.person.id, ids.lan));
    const run = await openRun(entity.id, "2027-04");
    await fileAndApprove(ids.lan, [line({ amount: 55_000 })], [ids.boss]);
    await db().update(schema.payrollRun).set({ status: "proposed" }).where(eq(schema.payrollRun.id, run.id));

    // A second claim finds no open run: the proposed one is evidence, not a draft.
    const filed = await fileAndApprove(ids.lan, [line({ amount: 66_000 })], [ids.boss]);
    expect(await db().select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, filed.submissionId))).toEqual([]);
    expect((await reimbursementOf(run.id, ids.lan))?.amount).toBe(55_000);
  });
});

describe("what is owed", () => {
  it("is counted and summed in SQL, the same as the claims list adds it up", async () => {
    // One still being decided (never owed), and one whose run is cancelled under it (owed again).
    await fileExpenseClaim({ values: { title: "Chưa duyệt", project_tag: null, note: null }, lines: [line({ amount: 77_000 })] }, await requester(ids.huy), money);
    const [entity] = await db().insert(schema.entity).values({ code: "SZZ", legalName: "SuZu Z", shortName: "SZZ", taxCode: "0106", wageRegion: 1 }).returning();
    await db().update(schema.person).set({ primaryEntityId: entity.id }).where(eq(schema.person.id, ids.huy));
    const run = await openRun(entity.id, "2027-05");
    await fileAndApprove(ids.huy, [line({ amount: 44_000 }), line({ amount: 6_000 })], [ids.boss]);
    await db().update(schema.payrollRun).set({ status: "cancelled" }).where(eq(schema.payrollRun.id, run.id));

    const entities = (await db().select({ id: schema.entity.id }).from(schema.entity)).map((row) => row.id);
    const reaches = [{ all: true as const }, { all: false as const, entityIds: [entity.id] }, { all: false as const, entityIds: entities.slice(0, 2) }, { all: false as const, entityIds: [] }];
    for (const reach of reaches) {
      // What the claims page used to add up from the list.
      const waiting = (await listExpenseClaims({ reach }, 100_000)).filter((claim) => claim.status === "approved" && !claim.payment);
      expect(await claimsOwed(reach)).toEqual({ count: waiting.length, amount: waiting.reduce((total, claim) => total + claim.total, 0) });
    }
    expect(await claimsOwed({ all: false, entityIds: [entity.id] })).toEqual({ count: 1, amount: 50_000 });
    expect((await claimsOwed({ all: true })).count).toBeGreaterThan(1);
  });
});

describe("the claims export", () => {
  const finance = (entityIds: string[] | null): Principal => ({ personId: ids.boss, workforceType: "employee", grants: entityIds ? entityIds.map((id) => ({ role: "finance" as const, scope: { type: "entity" as const, id } })) : [{ role: "finance" as const, scope: { type: "group" as const } }] });

  it("holds the claims the desk lists for the entities the reader pays", async () => {
    const all = await listExpenseClaims({ reach: { all: true } }, 100_000);
    expect(all.length).toBeGreaterThan(0);
    const { file, total } = await buildExpenseClaimsExport(finance(null), "en");
    expect([total, file.rowCount]).toEqual([all.length, all.length]);
    expect(file.table.header[2]).toBe("Amount");
    expect(file.table.rows.map((cells) => cells[2]).sort()).toEqual(all.map((claim) => claim.total).sort());
    expect(tableToCsv(file.table)).toContain("Công tác Đà Nẵng");

    const [entity] = await db().insert(schema.entity).values({ code: "SZQ", legalName: "SuZu Q", shortName: "SZQ", taxCode: "0107", wageRegion: 1 }).returning();
    expect((await buildExpenseClaimsExport(finance([entity.id]), "en")).total).toBe(0);
  });
});
