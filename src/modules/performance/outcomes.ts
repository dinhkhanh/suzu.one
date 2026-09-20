// What a published review leads to (FR-PRF-06, S): a promotion, a salary adjustment, a
// development plan or a performance improvement plan.
//
// The rule that shapes this file: **performance never becomes a second way to set a salary.** A
// salary adjustment is proposed through payroll's own `submitSalaryChange` (SRS D17), so it is
// encrypted, approved and applied exactly like every other change; this row keeps the request's
// id and nothing about money at all. The other three raise a task for HR, which is where the work
// actually gets done.
//
// No authorization inside; `outcome-actions.ts` checks first.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { IsoDate } from "@/lib/dates";
import { submitSalaryChange } from "@/modules/payroll/service";
import { createTask } from "@/modules/platform/tasks-engine/service";
import { OUTCOME_TYPES, type OutcomeType } from "./enums";
import { findResultById } from "./final-results";

type Executor = Tx | ReturnType<typeof db>;
export type ReviewOutcomeRow = typeof schema.reviewOutcome.$inferSelect;

export const OUTCOME_CONTEXT = "review_outcome";

export async function listOutcomes(filter: { personId?: string; year?: number; status?: string }, executor: Executor = db()): Promise<{ row: ReviewOutcomeRow; personName: string }[]> {
  const rows = await executor
    .select({ row: schema.reviewOutcome, personName: schema.person.fullName })
    .from(schema.reviewOutcome)
    .innerJoin(schema.person, eq(schema.person.id, schema.reviewOutcome.personId))
    .where(and(filter.personId ? eq(schema.reviewOutcome.personId, filter.personId) : undefined, filter.year ? eq(schema.reviewOutcome.year, filter.year) : undefined, filter.status ? eq(schema.reviewOutcome.status, filter.status) : undefined))
    .orderBy(desc(schema.reviewOutcome.createdAt));
  return rows;
}

export async function findOutcome(outcomeId: string, executor: Executor = db()): Promise<ReviewOutcomeRow | null> {
  const [row] = await executor.select().from(schema.reviewOutcome).where(eq(schema.reviewOutcome.id, outcomeId)).limit(1);
  return row ?? null;
}

export type OutcomeInput = {
  resultId: string;
  type: OutcomeType;
  note: string | null;
  /** Only for a salary adjustment: what payroll is asked to consider, and from when. */
  salary?: { baseSalary: number; insuranceSalary: number; validFrom: IsoDate } | null;
};

/**
 * Raise an outcome off a settled result. The result must exist and be locked or published: a
 * promotion argued from a draft figure is an argument, not a proposal.
 */
export async function raiseOutcome(input: OutcomeInput, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<ReviewOutcomeRow> {
  if (!OUTCOME_TYPES.includes(input.type)) throw new ActionError("outcome_type_unknown");
  const result = await findResultById(input.resultId, executor);
  if (!result) throw new ActionError("result_not_found");
  if (result.status === "draft") throw new ActionError("result_not_locked");

  if (input.type === "salary_adjustment") {
    if (!input.salary) throw new ActionError("salary_terms_required");
    // Payroll's own use-case — it opens its own transaction and does the encrypting, the approval
    // flow and the application. Nothing comes back but the request's id.
    const { request } = await submitSalaryChange(actorPersonId, {
      personId: result.personId,
      validFrom: input.salary.validFrom,
      reason: "adjustment",
      terms: { baseSalary: input.salary.baseSalary, insuranceSalary: input.salary.insuranceSalary, allowances: [] },
      note: `Kết quả đánh giá ${result.year}${input.note ? ` — ${input.note}` : ""}`,
    });
    const [created] = await executor
      .insert(schema.reviewOutcome)
      .values({ personId: result.personId, entityId: result.entityId, year: result.year, resultId: result.id, participantId: result.participantId, type: input.type, note: input.note, raisedByPersonId: actorPersonId, salaryRequestId: request.id })
      .returning();
    return created;
  }

  return executor.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.reviewOutcome)
      .values({ personId: result.personId, entityId: result.entityId, year: result.year, resultId: result.id, participantId: result.participantId, type: input.type, note: input.note, raisedByPersonId: actorPersonId })
      .returning();

    const task = await createTask(
      tx,
      {
        kind: OUTCOME_CONTEXT,
        title: `Đề xuất sau đánh giá ${result.year}: ${input.type}`,
        description: input.note,
        subjectPersonId: result.personId,
        entityId: result.entityId,
        linkUrl: `/performance/results?year=${result.year}`,
        context: { type: OUTCOME_CONTEXT, id: created.id },
      },
      actorPersonId,
      { notify: true },
    );
    const [linked] = await tx.update(schema.reviewOutcome).set({ taskId: task.id, updatedAt: new Date() }).where(eq(schema.reviewOutcome.id, created.id)).returning();
    return linked;
  });
}

export async function decideOutcome(outcomeId: string, decision: "accept" | "reject", actorPersonId: string, executor: Executor = db()): Promise<{ before: ReviewOutcomeRow; after: ReviewOutcomeRow }> {
  const before = await findOutcome(outcomeId, executor);
  if (!before) throw new ActionError("outcome_not_found");
  if (before.status !== "proposed") throw new ActionError("outcome_decided");
  const [after] = await executor
    .update(schema.reviewOutcome)
    .set({ status: decision === "accept" ? "accepted" : "rejected", decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.reviewOutcome.id, outcomeId))
    .returning();
  return { before, after };
}
