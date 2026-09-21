// Expense claims (FR-REQ-03): filing one, reading one, and reporting on them.
//
// A claim is a request on the builder — the same form, flow, inbox, SLA clock and deep links as a
// purchase request — with a list of lines beside it. Everything generic is `service.ts`'s; this
// file owns only what is specific: the lines, their total, and the receipts.
//
// The *effect* of approving one lives in `expense-posting.ts`, which `service.ts` calls inside the
// approval's own transaction, so a claim is never approved without being offered to payroll.
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type ExpenseLine, expenseProblems, expenseTotal, receiptFileIds, totalsByCategory } from "./engine/expense";
import type { FormValues } from "./engine/form";
import { type ClaimPayment, claimPayment, EXPENSE_CLAIM_CODE, paymentsOf } from "./expense-posting";
import { fileRequest, type GenericRequestView, getGenericRequest, refileRequest } from "./service";

type Executor = Tx | ReturnType<typeof db>;
export type ExpenseClaimLineRow = typeof schema.expenseClaimLine.$inferSelect;

export { EXPENSE_CLAIM_CODE } from "./expense-posting";

const toLine = (row: ExpenseClaimLineRow): ExpenseLine => ({ lineDate: row.lineDate, category: row.category, description: row.description, amount: row.amount, receiptFileId: row.receiptFileId, projectTag: row.projectTag });

/** Checks the lines and says what the claim comes to. Throws the first problem, as the form does. */
function checked(lines: readonly ExpenseLine[], today = todayInVietnam()): { lines: ExpenseLine[]; total: number } {
  const problems = expenseProblems(lines, { today });
  if (problems.length > 0) throw new ActionError(`expense_${problems[0].problem}`, problems);
  return { lines: lines.map((line) => ({ ...line, description: line.description.trim(), projectTag: line.projectTag?.trim() || null })), total: expenseTotal(lines) };
}

async function writeLines(tx: Tx, submissionId: string, lines: readonly ExpenseLine[]): Promise<void> {
  await tx.delete(schema.expenseClaimLine).where(eq(schema.expenseClaimLine.submissionId, submissionId));
  await tx.insert(schema.expenseClaimLine).values(lines.map((line, index) => ({ submissionId, ...line, sortOrder: index })));
}

export type FileClaimInput = { values: FormValues; lines: readonly ExpenseLine[] };

/**
 * Files a claim. The figure the approvers see and the figure payroll pays are the lines added up —
 * never something typed, so the two can never disagree.
 */
export async function fileExpenseClaim(
  input: FileClaimInput,
  requester: { personId: string; entityId: string | null; unitPath: readonly string[]; managerId: string | null },
  formatMoney: (amount: number) => string,
): Promise<{ requestId: string; submissionId: string; outcome: string }> {
  const { lines, total } = checked(input.lines);
  return fileRequest({ code: EXPENSE_CLAIM_CODE, values: input.values }, requester, formatMoney, {
    amount: total,
    // The receipts ride in the submission's attachment list too, so the file-opening action that
    // already guards a request's attachments guards them as well — one rule, not two.
    extraFileIds: receiptFileIds(lines),
    conditionData: { amount: total, lines: lines.length },
    afterInsert: (tx, submissionId) => writeLines(tx, submissionId, lines),
  });
}

/** After "return for changes": the lines are corrected and the claim goes round again. */
export async function refileExpenseClaim(requestId: string, actorPersonId: string, input: FileClaimInput, formatMoney: (amount: number) => string): Promise<{ requestId: string }> {
  const { lines, total } = checked(input.lines);
  return refileRequest(requestId, actorPersonId, input.values, formatMoney, {
    amount: total,
    extraFileIds: receiptFileIds(lines),
    conditionData: { amount: total, lines: lines.length },
    afterInsert: (tx, submissionId) => writeLines(tx, submissionId, lines),
  });
}

export async function listClaimLines(submissionId: string, executor: Executor = db()): Promise<ExpenseClaimLineRow[]> {
  return executor.select().from(schema.expenseClaimLine).where(eq(schema.expenseClaimLine.submissionId, submissionId)).orderBy(asc(schema.expenseClaimLine.sortOrder));
}

export type ExpenseClaimView = GenericRequestView & {
  lines: ExpenseClaimLineRow[];
  total: number;
  byCategory: { category: string; amount: number }[];
  payment: ClaimPayment;
};

/** One claim, for whoever the approval engine lets in. `null` = not a claim, or none of their business. */
export async function getExpenseClaim(viewer: { personId: string; principal: import("@/modules/platform/rbac/policy").Principal }, requestId: string): Promise<ExpenseClaimView | null> {
  const view = await getGenericRequest(viewer, requestId);
  if (!view || view.submission.typeCode !== EXPENSE_CLAIM_CODE) return null;
  const lines = await listClaimLines(view.submission.id);
  const asLines = lines.map(toLine);
  return {
    ...view,
    lines,
    total: expenseTotal(asLines),
    byCategory: totalsByCategory(asLines),
    payment: await claimPayment(view.submission.id, view.request.status === "approved"),
  };
}

export type ClaimListRow = {
  requestId: string;
  submissionId: string;
  requesterName: string;
  status: string;
  summary: string;
  total: number;
  createdAt: Date;
  decidedAt: Date | null;
  payment: { runId: string; month: string; runStatus: string } | null;
};

/**
 * The claims finance works through — who is owed what, and where each one has got to.
 *
 * `reach` is the caller's `entityReach(principal, "payroll:pay")`: an accountant who pays one
 * entity sees that entity's claims and no others, as a WHERE clause rather than a filter applied
 * after the fact.
 */
export async function listExpenseClaims(filter: { personId?: string; status?: string; reach?: { all: true } | { all: false; entityIds: string[] } } = {}, limit = 200): Promise<ClaimListRow[]> {
  if (filter.reach && !filter.reach.all && filter.reach.entityIds.length === 0) return [];
  const rows = await db()
    .select({
      requestId: schema.approvalRequest.id,
      submissionId: schema.requestSubmission.id,
      requesterName: schema.person.fullName,
      status: schema.approvalRequest.status,
      summary: schema.approvalRequest.summary,
      total: schema.requestSubmission.amount,
      createdAt: schema.approvalRequest.createdAt,
      decidedAt: schema.approvalRequest.decidedAt,
    })
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalRequest.requesterPersonId))
    .where(
      and(
        eq(schema.requestSubmission.typeCode, EXPENSE_CLAIM_CODE),
        filter.personId ? eq(schema.approvalRequest.requesterPersonId, filter.personId) : undefined,
        filter.status ? eq(schema.approvalRequest.status, filter.status as "approved") : undefined,
        filter.reach && !filter.reach.all ? inArray(schema.approvalRequest.entityId, filter.reach.entityIds) : undefined,
      ),
    )
    .orderBy(desc(schema.approvalRequest.createdAt))
    .limit(limit);

  const claims = rows.filter((row) => row.total !== null);
  const payments = await paymentsOf(claims.map((row) => row.submissionId));
  return claims.map((row) => ({ ...row, total: row.total ?? 0, payment: payments.get(row.submissionId) ?? null }));
}

/** The receipts of one claim, so the vault's owner look-up can let an approver open them. */
export async function receiptsOfClaims(submissionIds: readonly string[]): Promise<Map<string, string[]>> {
  if (submissionIds.length === 0) return new Map();
  const rows = await db().select({ submissionId: schema.expenseClaimLine.submissionId, receiptFileId: schema.expenseClaimLine.receiptFileId }).from(schema.expenseClaimLine).where(inArray(schema.expenseClaimLine.submissionId, [...submissionIds]));
  const byClaim = new Map<string, string[]>();
  for (const row of rows) if (row.receiptFileId) byClaim.set(row.submissionId, [...(byClaim.get(row.submissionId) ?? []), row.receiptFileId]);
  return byClaim;
}
