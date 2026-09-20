// Calculating a run as durable background work (ADR-09, FR-PAY-30).
//
// A payroll calculation must not depend on the browser tab that asked for it. So the request only
// **queues** the run; a worker claims it, calculates it, and writes its progress to the run row as
// it goes. Two things follow:
//
//   * Never twice at once. Claiming is one conditional UPDATE: the worker that writes its token
//     owns the run, everyone else is told it is already running. A claim that stops beating for
//     `STALE_AFTER_MINUTES` (its server died) is taken over by the next worker.
//   * Resumable. Results are stored in one transaction at the end, so a run is either fully
//     calculated or not at all — never half a payroll. A calculation that died leaves the run
//     queued with a stale claim, and the `payroll-calculate` job finishes it without anyone
//     asking. Re-calculating from the start is safe: `calculateRun` replaces what it finds.
//
// The action calls `calculateNow`, which queues *and* works the run in the same request, so C&B
// sees figures straight away for the entities this company actually has. The job is the safety net.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { calculateRun } from "./runs";
import type { PayrollRunRow } from "./run-storage";

// A claim that has not been refreshed for this long belonged to a server that is gone.
const STALE_AFTER_MINUTES = 10;
// How often progress reaches the database: often enough to watch, seldom enough not to be the work.
const PROGRESS_EVERY_MS = 500;

export type CalcProgress = { state: PayrollRunRow["calcState"]; done: number; total: number; error: string | null; startedAt: Date | null };

export const progressOf = (run: PayrollRunRow): CalcProgress => ({ state: run.calcState, done: run.calcDone, total: run.calcTotal, error: run.calcError, startedAt: run.calcStartedAt });

/** Is a calculation of this run under way (or waiting for a worker)? */
export const isCalculating = (run: PayrollRunRow): boolean => run.calcState === "queued" || run.calcState === "running";

/**
 * Asks for the run to be calculated. Returns without calculating anything: the work is claimed by
 * `workOneRun`, here or in the job. Refuses a run that is past editing — a proposed month is
 * evidence, and a new calculation would quietly replace what the HR lead put forward.
 */
export async function queueRunCalculation(runId: string): Promise<void> {
  const [run] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1);
  if (!run) throw new ActionError("run_not_found");
  if (run.status !== "draft" && run.status !== "calculated") throw new ActionError("run_not_editable");
  if (isCalculating(run)) throw new ActionError("run_calculating");
  await db().update(schema.payrollRun).set({ calcState: "queued", calcDone: 0, calcTotal: 0, calcError: null, calcClaim: null, updatedAt: new Date() }).where(eq(schema.payrollRun.id, runId));
}

/**
 * Takes the run on if nobody else holds it. One conditional UPDATE, so two workers racing for the
 * same run cannot both win: whoever's token is in the row afterwards does the work.
 */
async function claim(runId: string, token: string, now: Date): Promise<PayrollRunRow | null> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000);
  const [claimed] = await db()
    .update(schema.payrollRun)
    .set({ calcState: "running", calcClaim: token, calcStartedAt: now, calcHeartbeatAt: now, calcDone: 0, calcError: null, updatedAt: now })
    .where(
      and(
        eq(schema.payrollRun.id, runId),
        inArray(schema.payrollRun.status, ["draft", "calculated"]),
        or(eq(schema.payrollRun.calcState, "queued"), and(eq(schema.payrollRun.calcState, "running"), lt(schema.payrollRun.calcHeartbeatAt, staleBefore))),
      ),
    )
    .returning();
  return claimed ?? null;
}

/** Writes progress, and gives up the work if the claim was taken away in the meantime. */
async function beat(runId: string, token: string, done: number, total: number): Promise<void> {
  const [still] = await db()
    .update(schema.payrollRun)
    .set({ calcDone: done, calcTotal: total, calcHeartbeatAt: new Date() })
    .where(and(eq(schema.payrollRun.id, runId), eq(schema.payrollRun.calcClaim, token)))
    .returning({ id: schema.payrollRun.id });
  if (!still) throw new ActionError("run_claim_lost");
}

export type WorkOutcome = { runId: string; outcome: "calculated" | "busy" | "failed"; headcount?: number; error?: string };

/**
 * Claims one run and calculates it to the end. Failures are recorded on the run and returned, not
 * thrown: a background worker carrying several runs must not stop at the first bad one.
 */
export async function workOneRun(runId: string, now: Date = new Date()): Promise<WorkOutcome> {
  const token = randomUUID();
  const claimed = await claim(runId, token, now);
  if (!claimed) return { runId, outcome: "busy" };

  let lastWrite = 0;
  try {
    const { run } = await calculateRun(runId, {
      onProgress: async (done, total) => {
        // The first and the last person always land; the ones between only now and then.
        if (done === total || done === 1 || Date.now() - lastWrite >= PROGRESS_EVERY_MS) {
          lastWrite = Date.now();
          await beat(runId, token, done, total);
        }
      },
    });
    await db().update(schema.payrollRun).set({ calcState: "done", calcDone: run.headcount, calcTotal: run.headcount, calcClaim: null, calcHeartbeatAt: new Date() }).where(eq(schema.payrollRun.id, runId));
    return { runId, outcome: "calculated", headcount: run.headcount };
  } catch (error) {
    // `run_claim_lost` means another worker is on it; leave that worker's state alone.
    if (error instanceof ActionError && error.message === "run_claim_lost") return { runId, outcome: "busy" };
    const message = error instanceof Error ? error.message : String(error);
    // The reason a run would not calculate — "timesheet_not_locked", a person with no pay profile.
    // Codes and ids only; nothing about anyone's pay (FR-ACL-04).
    await db()
      .update(schema.payrollRun)
      .set({ calcState: "failed", calcError: message.slice(0, 300), calcClaim: null, calcHeartbeatAt: new Date() })
      .where(and(eq(schema.payrollRun.id, runId), eq(schema.payrollRun.calcClaim, token)));
    return { runId, outcome: "failed", error: message };
  }
}

/**
 * Queue a run and work it in the same request. What the "Calculate" button calls: the person who
 * pressed it waits for their own month, and a month too big to finish in one request is picked up
 * by the job. Re-throws the reason a run would not calculate, so the form can say what is wrong.
 */
export async function calculateNow(runId: string): Promise<WorkOutcome> {
  await queueRunCalculation(runId);
  const outcome = await workOneRun(runId);
  if (outcome.outcome === "failed") throw new ActionError(outcome.error ?? "run_calculation_failed");
  return outcome;
}

/** Runs waiting for a worker: queued, or claimed by a server that stopped answering. */
async function pending(now: Date): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000);
  const rows = await db()
    .select({ id: schema.payrollRun.id })
    .from(schema.payrollRun)
    .where(
      and(
        inArray(schema.payrollRun.status, ["draft", "calculated"]),
        or(eq(schema.payrollRun.calcState, "queued"), and(eq(schema.payrollRun.calcState, "running"), lt(schema.payrollRun.calcHeartbeatAt, staleBefore))),
      ),
    )
    .orderBy(sql`${schema.payrollRun.calcStartedAt} NULLS FIRST`)
    .limit(20);
  return rows.map((row) => row.id);
}

/**
 * Finishes what was left unfinished (ADR-09). Idempotent: with nothing waiting it does nothing,
 * and a run another worker already holds is left to them.
 */
export const payrollCalculateJob: JobDefinition = {
  name: "payroll-calculate",
  run: async () => {
    const outcomes: WorkOutcome[] = [];
    for (const runId of await pending(new Date())) outcomes.push(await workOneRun(runId));
    return {
      calculated: outcomes.filter((outcome) => outcome.outcome === "calculated").length,
      busy: outcomes.filter((outcome) => outcome.outcome === "busy").length,
      failed: outcomes.filter((outcome) => outcome.outcome === "failed").length,
    };
  },
};
