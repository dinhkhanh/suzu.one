// Demo payroll runs, **development only** (FR-PAY-30 end to end on the seeded company).
//
// The run lifecycle lives behind services that cannot be loaded by `tsx` (`server-only`), so the
// demo seed asks the running dev server to do this, exactly as the ops tracker's back-fill does.
// It uses the real use-cases throughout — nothing here writes a run by hand — so what the demo
// shows is what the system actually does: August 2026 calculated, proposed, signed, paid and
// locked with payslips out, and September left as a draft.
//
// It refuses to run anywhere but a development server: it locks timesheet periods and marks pay
// as disbursed, which is not something a production database should ever be told by a job.
//
// It lives beside the cron route rather than inside the payroll module on purpose. Composing two
// modules — locking attendance's period, then running payroll's lifecycle — is a composition-root
// job; payroll itself must never reach into attendance's internals, and the module boundary lint
// is right to refuse it there.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isDevelopmentEnvironment } from "@/lib/env";
import { getLockedTimesheets, lockPeriod } from "@/modules/attendance/months";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { NEXT_STEP, type RunStep, stepRun } from "@/modules/payroll/lifecycle";
import { confirmCashReceipt, generateBankFile, listPayables, openCashSheet, planPayment, recordCashDisbursement } from "@/modules/payroll/payments";
import { publishPayslips } from "@/modules/payroll/payslips";
import { calculateRun, createRegularRun, listRuns } from "@/modules/payroll/runs";

const PAID_MONTH = "2026-08";
const DRAFT_MONTH = "2026-09";

/** The steps a finished month goes through, in order. Payslips go out once the CEO has signed. */
const TO_LOCKED: RunStep[] = ["propose", "approve", "prepare_payment", "mark_paid", "lock"];

async function ensureLocked(entityId: string, month: string, actorPersonId: string): Promise<boolean> {
  if (await getLockedTimesheets(entityId, month)) return true;
  try {
    // The demo's September is deliberately messy, so August is locked with an override where the
    // seeded anomalies would block it — the same thing HR does on the timesheet screen.
    await lockPeriod(entityId, month, actorPersonId, { overrideReason: "Dữ liệu demo: chốt để chạy bảng lương mẫu." });
    return true;
  } catch {
    return false;
  }
}

async function settle(runId: string, actorPersonId: string): Promise<void> {
  const [run] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId)).limit(1);
  if (!run) return;
  const payables = await listPayables(run);
  const plan = planPayment(payables);

  // One batch per bank the entity actually pays through, then the cash sheet for the Simple profile.
  for (const bank of plan.banks) {
    await generateBankFile({ runId, bank: bank.key, valueDate: `${run.month}-05`, payingAccount: { accountNumber: "0071000123456", accountName: "CONG TY SUZU", branch: null } }, actorPersonId);
  }
  if (plan.cash.length > 0) {
    await openCashSheet(runId, actorPersonId);
    for (const person of plan.cash) {
      await recordCashDisbursement({ runId, personId: person.personId, disbursedOn: `${run.month}-05`, note: null }, actorPersonId);
      // The person confirms in the app that they took the money (FR-PAY-39).
      await confirmCashReceipt(runId, person.personId);
    }
  }
}

export const payrollDemoRunsJob: JobDefinition = {
  name: "payroll-demo-runs",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("payroll-demo-runs is a development-only job");

    const [actorPersonId] = await listOwnerPersonIds();
    if (!actorPersonId) return { skipped: "no owner" };
    const entities = await db().select({ id: schema.entity.id, code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.isActive, true));

    const done: Record<string, unknown>[] = [];
    for (const entity of entities) {
      const outcome: Record<string, unknown> = { entity: entity.code };

      // ── August: the whole lifecycle, on a locked timesheet ──
      if (await ensureLocked(entity.id, PAID_MONTH, actorPersonId)) {
        const existing = (await listRuns({ entityIds: [entity.id], month: PAID_MONTH })).find((run) => run.kind === "regular" && run.status !== "cancelled");
        const run = existing ?? (await createRegularRun({ entityId: entity.id, month: PAID_MONTH, note: "Bảng lương tháng 8/2026 (dữ liệu demo)." }, actorPersonId));
        if (run.status === "draft") await calculateRun(run.id);

        for (const step of TO_LOCKED) {
          const [current] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, run.id)).limit(1);
          if (!current || NEXT_STEP[current.status] !== step) continue;
          // Payment cannot be marked until the batches and the cash sheet are settled (FR-PAY-39).
          if (step === "mark_paid") await settle(run.id, actorPersonId);
          await stepRun(run.id, step, { personId: actorPersonId }, { comment: step === "approve" ? "Đã duyệt (dữ liệu demo)." : null });
          // Payslips go to ESS as soon as the run is approved, never before.
          if (step === "approve") await publishPayslips(run.id, actorPersonId);
        }
        const [after] = await db().select({ status: schema.payrollRun.status }).from(schema.payrollRun).where(eq(schema.payrollRun.id, run.id)).limit(1);
        outcome.august = after?.status ?? "unknown";
      } else {
        outcome.august = "timesheet_not_lockable";
      }

      // ── September: a draft, because its timesheet is still open ──
      const draft = (await listRuns({ entityIds: [entity.id], month: DRAFT_MONTH })).find((run) => run.kind === "regular" && run.status !== "cancelled");
      if (!draft) {
        await createRegularRun({ entityId: entity.id, month: DRAFT_MONTH, note: "Bảng lương tháng 9/2026 — bảng công chưa chốt." }, actorPersonId);
        outcome.september = "draft";
      } else {
        outcome.september = draft.status;
      }

      done.push(outcome);
    }

    const payslips = await db().select({ id: schema.payslip.id }).from(schema.payslip).where(and(eq(schema.payslip.month, PAID_MONTH)));
    return { entities: done, payslips: payslips.length };
  },
};
