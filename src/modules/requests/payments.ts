// Requests that end in a payment (REQ-01): finance's "to pay" queue, the paid date and reference
// that close one, and the settlement of a trip's advances against what it cost.
//
// A type says what finance does with it once approved (`request_type.payout`): pay it, or pay it as
// an advance. An advance filed under a parent (a business trip) is netted against the payments
// filed under the same parent (engine/settlement.ts), so the trip's settling payment pays only
// what is still owed — or asks for the unspent advance back. An expense claim is not here: it is
// paid through the payroll run (expense-posting.ts).
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import type { RequestPayout } from "./enums";
import { type Settlement, settleAdvances } from "./engine/settlement";

type Executor = Tx | ReturnType<typeof db>;
type Reach = { all: true } | { all: false; entityIds: string[] };

export type PayoutRow = {
  requestId: string;
  submissionId: string;
  code: string;
  nameVi: string;
  nameEn: string;
  payout: Exclude<RequestPayout, "none">;
  summary: string;
  requesterPersonId: string;
  requesterName: string;
  entityId: string | null;
  amount: number;
  approvedAt: Date | null;
  /** The request it was filed under (a business trip), when there is one. */
  parentRequestId: string | null;
  parentSummary: string | null;
  /** A payment under a parent: the advance netted against it, and what changes hands. Otherwise the amount. */
  settlement: Settlement;
  /** Why it may not be paid yet: an advance under the same parent was approved and is still unpaid. */
  blocked: "advance_unpaid" | null;
  paidOn: IsoDate | null;
  paidAmount: number | null;
  paidReference: string | null;
};

const parentSubmission = alias(schema.requestSubmission, "parent_submission");
const parentApproval = alias(schema.approvalRequest, "parent_approval");

/**
 * How each parent's paid advances settle its payments: the advances added up in SQL, the payments
 * in filing order through the engine. One read for any number of parents.
 */
async function settlementsUnder(executor: Executor, parentIds: readonly string[]): Promise<{ settlements: Map<string, Settlement>; unpaidAdvances: Set<string> }> {
  const settlements = new Map<string, Settlement>();
  const unpaidAdvances = new Set<string>();
  if (parentIds.length === 0) return { settlements, unpaidAdvances };
  const children = and(inArray(schema.requestSubmission.parentSubmissionId, [...parentIds]), eq(schema.approvalRequest.status, "approved"));
  const [advances, payments] = await Promise.all([
    executor
      .select({
        parentId: schema.requestSubmission.parentSubmissionId,
        paid: sql<number>`coalesce(sum(${schema.requestSubmission.amount}) filter (where ${schema.requestSubmission.paidOn} is not null), 0)::bigint`,
        unpaid: sql<number>`count(*) filter (where ${schema.requestSubmission.paidOn} is null)::int`,
      })
      .from(schema.requestSubmission)
      .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
      .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
      .where(and(children, eq(schema.requestType.payout, "advance")))
      .groupBy(schema.requestSubmission.parentSubmissionId),
    executor
      .select({ id: schema.requestSubmission.id, parentId: schema.requestSubmission.parentSubmissionId, amount: schema.requestSubmission.amount, paidAmount: schema.requestSubmission.paidAmount, paidOn: schema.requestSubmission.paidOn })
      .from(schema.requestSubmission)
      .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
      .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
      .where(and(children, eq(schema.requestType.payout, "payment")))
      .orderBy(asc(schema.requestSubmission.createdAt), asc(schema.requestSubmission.id)),
  ]);
  const paidByParent = new Map(advances.map((row) => [row.parentId!, Number(row.paid)]));
  for (const row of advances) if (row.unpaid > 0) unpaidAdvances.add(row.parentId!);
  for (const parentId of parentIds) {
    const under = payments.filter((row) => row.parentId === parentId).map((row) => ({ id: row.id, amount: row.amount ?? 0, paidAmount: row.paidOn ? (row.paidAmount ?? 0) : null }));
    for (const [id, settlement] of settleAdvances(paidByParent.get(parentId) ?? 0, under)) settlements.set(id, settlement);
  }
  return { settlements, unpaidAdvances };
}

const payoutColumns = {
  requestId: schema.approvalRequest.id,
  submissionId: schema.requestSubmission.id,
  code: schema.requestSubmission.typeCode,
  nameVi: schema.requestType.nameVi,
  nameEn: schema.requestType.nameEn,
  payout: schema.requestType.payout,
  summary: schema.approvalRequest.summary,
  requesterPersonId: schema.approvalRequest.requesterPersonId,
  requesterName: schema.person.fullName,
  entityId: schema.approvalRequest.entityId,
  amount: schema.requestSubmission.amount,
  approvedAt: schema.approvalRequest.decidedAt,
  parentSubmissionId: schema.requestSubmission.parentSubmissionId,
  parentRequestId: parentApproval.id,
  parentSummary: parentApproval.summary,
  paidOn: schema.requestSubmission.paidOn,
  paidAmount: schema.requestSubmission.paidAmount,
  paidReference: schema.requestSubmission.paidReference,
};

const payoutFrom = (executor: Executor) =>
  executor
    .select(payoutColumns)
    .from(schema.requestSubmission)
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalRequest.requesterPersonId))
    .leftJoin(parentSubmission, eq(parentSubmission.id, schema.requestSubmission.parentSubmissionId))
    .leftJoin(parentApproval, eq(parentApproval.id, parentSubmission.approvalRequestId));

async function withSettlements(executor: Executor, rows: Awaited<ReturnType<ReturnType<typeof payoutFrom>["where"]>>): Promise<PayoutRow[]> {
  const parents = [...new Set(rows.filter((row) => row.payout === "payment" && row.parentSubmissionId).map((row) => row.parentSubmissionId!))];
  const { settlements, unpaidAdvances } = await settlementsUnder(executor, parents);
  return rows.map(({ parentSubmissionId, ...row }) => {
    const amount = row.amount ?? 0;
    const settled = row.payout === "payment" && parentSubmissionId ? settlements.get(row.submissionId) : undefined;
    return {
      ...row,
      payout: row.payout as PayoutRow["payout"],
      amount,
      settlement: settled ?? { nettedAdvance: 0, toPay: row.paidOn ? (row.paidAmount ?? amount) : amount },
      blocked: !row.paidOn && row.payout === "payment" && parentSubmissionId && unpaidAdvances.has(parentSubmissionId) ? "advance_unpaid" : null,
    };
  });
}

/**
 * Finance's queue: every approved request of a payable type in the entities `reach` covers that is
 * not paid yet, then what was paid since `paidSince`. Oldest approval first — that is the order
 * they are owed in.
 */
export async function listPayouts(reach: Reach, options: { paidSince: IsoDate; limit?: number }): Promise<PayoutRow[]> {
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await payoutFrom(db())
    .where(
      and(
        ne(schema.requestType.payout, "none"),
        eq(schema.approvalRequest.status, "approved"),
        reach.all ? undefined : inArray(schema.approvalRequest.entityId, reach.entityIds),
        or(isNull(schema.requestSubmission.paidOn), gte(schema.requestSubmission.paidOn, options.paidSince)),
      ),
    )
    .orderBy(sql`${schema.requestSubmission.paidOn} is not null`, desc(schema.requestSubmission.paidOn), asc(schema.approvalRequest.decidedAt))
    .limit(options.limit ?? 300);
  return withSettlements(db(), rows);
}

/** Where one request stands with finance, for its own page. null = not a payable type, or not approved. */
export async function payoutOf(requestId: string, executor: Executor = db()): Promise<PayoutRow | null> {
  const rows = await payoutFrom(executor).where(and(eq(schema.approvalRequest.id, requestId), ne(schema.requestType.payout, "none"), eq(schema.approvalRequest.status, "approved"))).limit(1);
  return (await withSettlements(executor, rows))[0] ?? null;
}

/** The entity a request belongs to — what the "paid" action authorizes against. */
export async function payoutEntityOf(requestId: string): Promise<{ entityId: string | null } | null> {
  const [row] = await db()
    .select({ entityId: schema.approvalRequest.entityId })
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .where(and(eq(schema.approvalRequest.id, requestId), ne(schema.requestType.payout, "none")))
    .limit(1);
  return row ?? null;
}

const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");
const formatDong = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;

/**
 * Finance records that it paid (or, for a settlement the advance more than covered, collected) an
 * approved request. Once only. The figure is worked out here, never typed: the amount less the
 * advance netted against it. A settlement waits until every approved advance under its parent is
 * paid, and an advance is not paid once its parent has been settled.
 */
export async function markRequestPaid(requestId: string, input: { paidOn: IsoDate; reference: string }, actorPersonId: string): Promise<{ before: PayoutRow; after: PayoutRow }> {
  return db().transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: schema.requestSubmission.id, parentId: schema.requestSubmission.parentSubmissionId })
      .from(schema.requestSubmission)
      .where(eq(schema.requestSubmission.approvalRequestId, requestId))
      .limit(1)
      .for("update");
    if (!locked) throw new ActionError("approval_not_found");
    // The parent's row is the lock every settlement under it takes, so two payments of one trip are
    // worked out one after the other, each seeing what the other netted.
    if (locked.parentId) await tx.select({ id: schema.requestSubmission.id }).from(schema.requestSubmission).where(eq(schema.requestSubmission.id, locked.parentId)).for("update");

    const before = await payoutOf(requestId, tx);
    if (!before) throw new ActionError("request_not_payable");
    if (before.paidOn) throw new ActionError("request_already_paid");
    if (before.blocked === "advance_unpaid") throw new ActionError("request_advance_unpaid");
    if (before.payout === "advance" && locked.parentId) {
      const [settled] = await tx
        .select({ id: schema.requestSubmission.id })
        .from(schema.requestSubmission)
        .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
        .where(and(eq(schema.requestSubmission.parentSubmissionId, locked.parentId), eq(schema.requestType.payout, "payment"), isNotNull(schema.requestSubmission.paidOn)))
        .limit(1);
      if (settled) throw new ActionError("request_already_settled");
    }

    const paidAmount = before.settlement.toPay;
    await tx
      .update(schema.requestSubmission)
      .set({ paidOn: input.paidOn, paidAmount, paidReference: input.reference, paidByPersonId: actorPersonId, paidAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.requestSubmission.id, locked.id));
    const after = (await payoutOf(requestId, tx))!;
    // Written in Vietnamese like every request notice; the requester learns the money moved.
    await notify(
      {
        recipients: [before.requesterPersonId],
        kind: paidAmount < 0 ? "approvals.request_repayment_recorded" : "approvals.request_paid",
        params: { summary: before.summary, amount: formatDong(Math.abs(paidAmount)), date: formatDay(input.paidOn), reference: input.reference },
        link: `/approvals/request/${requestId}`,
      },
      tx,
    );
    return { before, after };
  });
}
