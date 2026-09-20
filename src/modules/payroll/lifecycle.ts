// The run lifecycle (FR-PAY-30, SRS D17): who carries a payroll run forward, in what order.
//
//   draft → calculated → proposed → approved → payment_prepared → paid → locked
//             C&B          HR lead    the CEO    the chief          the      C&B closes
//                          proposes   signs      accountant         money    the month
//                                                prepares payment   is out
//
// Four rules hold the whole thing together:
//   1. A step is only ever taken from the one status before it. No skipping, no going round.
//   2. Every step is a signature: who, when, and what they said, kept in `payroll_run_event`.
//   3. The CEO can send a run back to HR with a comment — the only way backwards, and only
//      while the money has not moved.
//   4. A locked run is evidence: a database trigger refuses to change it, and its period is
//      closed (DR-07). A later correction is a retro item in the next month, never an edit.
//
// No authorization inside — the actions check the permission over the run's entity first, exactly
// as `runs.ts` and `calculation.ts` do.
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { settlementOf } from "./payments";
import type { PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

export type RunStatus = PayrollRunRow["status"];
export type PayrollRunEventRow = typeof schema.payrollRunEvent.$inferSelect;

/** The step a person asks for, and the status it leads to. */
export type RunStep = "propose" | "approve" | "return" | "prepare_payment" | "mark_paid" | "lock";

type StepRule = {
  /** The statuses this step may be taken from. */
  from: readonly RunStatus[];
  to: RunStatus;
  /** Which payroll permission over the run's entity the step asks for (SRS D17). */
  permission: "payroll:propose" | "payroll:approve" | "payroll:pay";
  /** A comment is the point of the step, not a decoration. */
  commentRequired?: boolean;
};

export const RUN_STEPS: Record<RunStep, StepRule> = {
  // The HR lead puts the month forward. Only a calculated run can be proposed: figures first.
  propose: { from: ["calculated"], to: "proposed", permission: "payroll:propose" },
  // The CEO signs (SRS D17).
  approve: { from: ["proposed"], to: "approved", permission: "payroll:approve" },
  // …or sends it back with a reason, which HR must be able to act on — so it is required.
  // Allowed after signing too, as long as the chief accountant has not started paying.
  return: { from: ["proposed", "approved"], to: "calculated", permission: "payroll:approve", commentRequired: true },
  // The chief accountant prepares the transfer files and the cash sheet (week 5 fills them in).
  prepare_payment: { from: ["approved"], to: "payment_prepared", permission: "payroll:pay" },
  // The money has left: the bank batch went through and the cash was handed over. Refused until
  // both are settled (FR-PAY-39) — the check is inside `stepRun`.
  mark_paid: { from: ["payment_prepared"], to: "paid", permission: "payroll:pay" },
  // C&B closes the month. Deliberately not the accountant who paid it: two people close a period.
  lock: { from: ["paid"], to: "locked", permission: "payroll:propose" },
};

/** The step that leads to each status — what a screen offers next. */
export const NEXT_STEP: Partial<Record<RunStatus, RunStep>> = { calculated: "propose", proposed: "approve", approved: "prepare_payment", payment_prepared: "mark_paid", paid: "lock" };

/** Where a status sits in the lifecycle; `cancelled` is nowhere. */
const ORDER: Record<RunStatus, number> = { draft: 0, calculated: 1, proposed: 2, approved: 3, payment_prepared: 4, paid: 5, locked: 6, cancelled: -1 };

/** Has this run got at least as far as `status`? (Ops asks this to close its payroll calendar.) */
export const hasReached = (run: Pick<PayrollRunRow, "status">, status: RunStatus): boolean => ORDER[run.status] >= 0 && ORDER[run.status] >= ORDER[status];

/** A locked run is never touched again — not its figures, not its inputs, not its status. */
export const isLocked = (run: Pick<PayrollRunRow, "status">): boolean => run.status === "locked";

/** Which steps could be taken on this run right now, whoever the viewer is. */
export function availableSteps(run: Pick<PayrollRunRow, "status" | "headcount">): RunStep[] {
  return (Object.keys(RUN_STEPS) as RunStep[]).filter((step) => RUN_STEPS[step].from.includes(run.status) && !(step === "propose" && run.headcount === 0));
}

// ── Taking a step ───────────────────────────────────────────────────────────────────────────

/** The columns each step signs. A return unsigns what it sends back past.  */
function signature(step: RunStep, actorPersonId: string | null, now: Date): Partial<typeof schema.payrollRun.$inferInsert> {
  switch (step) {
    case "propose":
      return { proposedAt: now, proposedByPersonId: actorPersonId };
    case "approve":
      return { approvedAt: now, approvedByPersonId: actorPersonId };
    case "return":
      // Back with HR: nobody has proposed it and nobody has signed it any more.
      return { proposedAt: null, proposedByPersonId: null, approvedAt: null, approvedByPersonId: null };
    case "prepare_payment":
      return { paymentPreparedAt: now, paymentPreparedByPersonId: actorPersonId };
    case "mark_paid":
      return { paidAt: now, paidByPersonId: actorPersonId };
    case "lock":
      return { lockedAt: now, lockedByPersonId: actorPersonId };
  }
}

export type StepResult = { before: PayrollRunRow; run: PayrollRunRow; event: PayrollRunEventRow };

/**
 * Carries a run one step forward (or, for a return, back to HR). Refuses anything the lifecycle
 * does not allow from where the run stands — including a second attempt at a step already taken,
 * because the run is re-read and locked inside the transaction.
 */
export async function stepRun(runId: string, step: RunStep, actor: { personId: string | null }, input: { comment?: string | null } = {}, executor: Executor = db()): Promise<StepResult> {
  const rule = RUN_STEPS[step];
  const comment = input.comment?.trim() || null;
  if (rule.commentRequired && !comment) throw new ActionError("comment_required");

  const work = async (tx: Tx): Promise<StepResult> => {
    const [before] = await tx.select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1).for("update");
    if (!before) throw new ActionError("run_not_found");
    if (before.status === "cancelled") throw new ActionError("run_cancelled");
    if (!rule.from.includes(before.status)) throw new ActionError("run_step_not_allowed", { status: before.status, step });
    // Nothing is proposed with nobody in it: an empty run is a mistake, not a month.
    if (step === "propose" && before.headcount === 0) throw new ActionError("run_is_empty");
    // "The run is 'Paid' only when the bank batch and the cash sheet are both settled" (FR-PAY-39).
    // Asked of `payments.ts` here rather than in the action, so no path can skip it.
    if (step === "mark_paid") {
      const settlement = await settlementOf(before, tx);
      if (!settlement.settled) throw new ActionError("run_not_settled", { blockers: settlement.blockers });
    }
    // A calculation still in flight would overwrite what is being proposed.
    if (step === "propose" && (before.calcState === "queued" || before.calcState === "running")) throw new ActionError("run_calculating");

    const now = new Date();
    const [run] = await tx
      .update(schema.payrollRun)
      .set({ status: rule.to, ...signature(step, actor.personId, now), updatedAt: now })
      .where(and(eq(schema.payrollRun.id, runId), eq(schema.payrollRun.status, before.status)))
      .returning();
    if (!run) throw new ActionError("run_step_not_allowed", { status: before.status, step });

    const [event] = await tx.insert(schema.payrollRunEvent).values({ runId, fromStatus: before.status, toStatus: rule.to, actorPersonId: actor.personId, comment }).returning();
    return { before, run, event };
  };

  return "transaction" in executor ? executor.transaction(work) : work(executor as Tx);
}

export async function listRunEvents(runId: string, executor: Executor = db()): Promise<PayrollRunEventRow[]> {
  return executor.select().from(schema.payrollRunEvent).where(eq(schema.payrollRunEvent.runId, runId)).orderBy(schema.payrollRunEvent.createdAt);
}

// ── Period locking (DR-07) ──────────────────────────────────────────────────────────────────

/**
 * Is this entity's payroll month closed? A locked regular run closes it: no new run of any kind
 * may be made for it and nothing in it may be changed. A difference found later is carried into
 * the next month as a retro item (FR-PAY-17), which is what `deriveRetroItems` is for.
 */
export async function isPayrollPeriodLocked(entityId: string, month: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor
    .select({ id: schema.payrollRun.id })
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, month), eq(schema.payrollRun.kind, "regular"), eq(schema.payrollRun.status, "locked")))
    .limit(1);
  return !!row;
}

/** Throws when the period is closed. Called before anything that would add to a month. */
export async function assertPeriodOpen(entityId: string, month: string, executor: Executor = db()): Promise<void> {
  if (await isPayrollPeriodLocked(entityId, month, executor)) throw new ActionError("payroll_period_locked", { entityId, month });
}

// ── What other modules ask (through service.ts) ─────────────────────────────────────────────

export type RunMilestone = { entityId: string; month: string; status: RunStatus; proposedAt: Date | null; approvedAt: Date | null; paidAt: Date | null; lockedAt: Date | null; payslipsPublishedAt: Date | null };

/**
 * How far each entity's regular run has got, for the months asked about. This is what the ops
 * tracker reads to close its monthly payroll calendar (FR-OPS-10) — the same pulled, idempotent
 * shape as `isPeriodLocked` in attendance. It carries dates and statuses, never a figure.
 */
export async function listRunMilestones(filter: { entityIds?: readonly string[]; months?: readonly string[] } = {}, executor: Executor = db()): Promise<RunMilestone[]> {
  if (filter.entityIds?.length === 0 || filter.months?.length === 0) return [];
  const rows = await executor
    .select({
      entityId: schema.payrollRun.entityId,
      month: schema.payrollRun.month,
      status: schema.payrollRun.status,
      proposedAt: schema.payrollRun.proposedAt,
      approvedAt: schema.payrollRun.approvedAt,
      paidAt: schema.payrollRun.paidAt,
      lockedAt: schema.payrollRun.lockedAt,
      payslipsPublishedAt: schema.payrollRun.payslipsPublishedAt,
    })
    .from(schema.payrollRun)
    .where(
      and(
        eq(schema.payrollRun.kind, "regular"),
        ne(schema.payrollRun.status, "cancelled"),
        filter.entityIds ? inArray(schema.payrollRun.entityId, [...filter.entityIds]) : undefined,
        filter.months ? inArray(schema.payrollRun.month, [...filter.months]) : undefined,
      ),
    );
  return rows;
}

/** One entity-month, for the caller that only cares about one. */
export async function getRunMilestone(entityId: string, month: string, executor: Executor = db()): Promise<RunMilestone | null> {
  const [row] = await listRunMilestones({ entityIds: [entityId], months: [month] }, executor);
  return row ?? null;
}
