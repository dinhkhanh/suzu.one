// What happens when an expense claim is approved (FR-REQ-03): it becomes money in a payroll run.
//
// This file is deliberately the *only* place that knows both about claims and about payroll, and
// it knows about payroll only through `payroll/service.ts` — it finds the entity's open run, types
// a figure in under one pay component, and can take it out again. It never reads a figure back.
//
// Kept apart from `service.ts` so nothing here imports it: `service.ts` calls this on approval and
// `expense.ts` calls both. One direction, no cycle.
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { findOpenRegularRun, getRunHandle, removeRunInput, setRunInput } from "@/modules/payroll/service";

type Executor = Tx | ReturnType<typeof db>;

/** The request type an expense claim is filed under. The builder owns the form; this owns the effect. */
export const EXPENSE_CLAIM_CODE = "expense_claim";

/**
 * The pay component an approved claim is paid under — seeded by `pnpm db:seed`, exempt from tax
 * and insurance and never pro-rated, because it refunds money the employee already spent.
 */
export const REIMBURSEMENT_COMPONENT = "EXPENSE_REIMBURSE";

/** Where a claim stands once its approvers have finished with it. */
export type ClaimPayment =
  /** Approved, but the entity has no open run yet: the next sweep puts it in one. */
  | { state: "awaiting_payroll" }
  /** In a run, waiting for that run to be paid. */
  | { state: "posted"; runId: string; month: string; runStatus: string }
  /** Not approved — yet, or at all. Nothing to pay. */
  | { state: "not_payable" };

/**
 * The person's reimbursement line in a run is the sum of every claim posted to it — **one line,
 * not one per claim**, because `payroll_run_input` is keyed by (run, person, component) and a
 * second claim would otherwise quietly *replace* the first instead of adding to it.
 */
async function rewriteRunInput(executor: Executor, runId: string, personId: string, actorPersonId: string): Promise<void> {
  const run = await getRunHandle(runId, executor);
  // A run that has moved past `calculated` keeps what it was given: its figures are what somebody
  // signed, and payroll refuses to change them anyway.
  if (!run || !run.openForEditing) return;

  const [totals] = await executor
    .select({ total: sql<string | null>`sum(${schema.expenseClaimPosting.amount})`, count: sql<string>`count(*)` })
    .from(schema.expenseClaimPosting)
    .where(and(eq(schema.expenseClaimPosting.runId, runId), eq(schema.expenseClaimPosting.personId, personId)));
  const total = Number(totals?.total ?? 0);
  const count = Number(totals?.count ?? 0);

  if (total <= 0) {
    await removeRunInput(runId, personId, REIMBURSEMENT_COMPONENT, executor);
    return;
  }
  await setRunInput({ runId, personId, code: REIMBURSEMENT_COMPONENT, amount: total, note: `${count} đề nghị hoàn ứng đã duyệt` }, actorPersonId, executor);
}

/**
 * A posting only counts while its run is still a run. A cancelled run is not a payment, so the
 * claim it held goes back to waiting and the stale row is cleared out of the way — otherwise the
 * unique key would stop the claim ever being posted again.
 */
async function liveOrRelease(executor: Executor, submissionId: string, actorPersonId: string): Promise<{ runId: string; month: string; status: string } | null> {
  const [row] = await executor.select().from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, submissionId)).limit(1);
  if (!row) return null;
  const run = await getRunHandle(row.runId, executor);
  if (run && run.status !== "cancelled") return { runId: row.runId, month: run.month, status: run.status };
  await executor.delete(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.id, row.id));
  await rewriteRunInput(executor, row.runId, row.personId, actorPersonId);
  return null;
}

/**
 * Hands an approved claim to payroll. Returns where it ended up.
 *
 * Paying one twice is impossible because `expense_claim_posting.submission_id` is unique: a second
 * insert fails **in the database**, not in a check here that two approvals landing together would
 * both pass.
 */
export async function postApprovedClaim(executor: Executor, claim: { submissionId: string; personId: string; entityId: string | null; amount: number }, actorPersonId: string): Promise<ClaimPayment> {
  if (!(claim.amount > 0)) return { state: "not_payable" };
  const existing = await liveOrRelease(executor, claim.submissionId, actorPersonId);
  if (existing) return { state: "posted", ...existing, runStatus: existing.status };
  // A claim from somebody with no legal entity has nowhere to be paid; it waits for one.
  if (!claim.entityId) return { state: "awaiting_payroll" };

  const run = await findOpenRegularRun(claim.entityId, executor);
  if (!run) return { state: "awaiting_payroll" };

  await executor.insert(schema.expenseClaimPosting).values({ submissionId: claim.submissionId, runId: run.id, personId: claim.personId, amount: claim.amount, postedByPersonId: actorPersonId });
  await rewriteRunInput(executor, run.id, claim.personId, actorPersonId);
  return { state: "posted", runId: run.id, month: run.month, runStatus: run.status };
}

/** Where one claim stands. A read: it reports a cancelled run's claim as waiting but changes nothing. */
export async function claimPayment(submissionId: string, approved: boolean, executor: Executor = db()): Promise<ClaimPayment> {
  const [row] = await executor
    .select({ runId: schema.expenseClaimPosting.runId, month: schema.payrollRun.month, status: schema.payrollRun.status })
    .from(schema.expenseClaimPosting)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.expenseClaimPosting.runId))
    .where(eq(schema.expenseClaimPosting.submissionId, submissionId))
    .limit(1);
  if (row && row.status !== "cancelled") return { state: "posted", runId: row.runId, month: row.month, runStatus: row.status };
  return approved ? { state: "awaiting_payroll" } : { state: "not_payable" };
}

/** The same for a list of claims at once, for the tracking screen. */
export async function paymentsOf(submissionIds: readonly string[]): Promise<Map<string, { runId: string; month: string; runStatus: string }>> {
  if (submissionIds.length === 0) return new Map();
  const rows = await db()
    .select({ submissionId: schema.expenseClaimPosting.submissionId, runId: schema.expenseClaimPosting.runId, month: schema.payrollRun.month, status: schema.payrollRun.status })
    .from(schema.expenseClaimPosting)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.expenseClaimPosting.runId))
    .where(inArray(schema.expenseClaimPosting.submissionId, [...submissionIds]));
  return new Map(rows.filter((row) => row.status !== "cancelled").map((row) => [row.submissionId, { runId: row.runId, month: row.month, runStatus: row.status }]));
}

export type SweepResult = { posted: number; released: number; stillWaiting: number };

/**
 * Every approved claim that is not in a live run, offered to payroll again (FR-REQ-03). Idempotent:
 * a claim already posted is left alone, one whose run was cancelled is freed first, so a second
 * run of this changes nothing.
 *
 * A sweep rather than a hook on run creation, because payroll must not have to know that expense
 * claims exist — the dependency goes one way, and one way only.
 */
export async function sweepApprovedClaims(actorPersonId: string | null): Promise<SweepResult> {
  const approved = await db()
    .select({
      submissionId: schema.requestSubmission.id,
      personId: schema.approvalRequest.requesterPersonId,
      entityId: schema.approvalRequest.entityId,
      amount: schema.requestSubmission.amount,
    })
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .where(and(eq(schema.requestSubmission.typeCode, EXPENSE_CLAIM_CODE), eq(schema.approvalRequest.status, "approved")));

  const result: SweepResult = { posted: 0, released: 0, stillWaiting: 0 };
  for (const claim of approved) {
    const [before] = await db().select({ runId: schema.expenseClaimPosting.runId }).from(schema.expenseClaimPosting).where(eq(schema.expenseClaimPosting.submissionId, claim.submissionId)).limit(1);
    const payment = await db().transaction((tx) => postApprovedClaim(tx, { ...claim, amount: claim.amount ?? 0 }, actorPersonId ?? claim.personId));
    // Counted by where the claim *moved*, not by whether a row exists: a claim freed from a
    // cancelled run and put into the next one has been both released and posted.
    if (before && payment.state !== "posted") result.released += 1;
    else if (before && payment.state === "posted" && payment.runId !== before.runId) {
      result.released += 1;
      result.posted += 1;
    } else if (!before && payment.state === "posted") result.posted += 1;
    if (payment.state !== "posted") result.stillWaiting += 1;
  }
  return result;
}
