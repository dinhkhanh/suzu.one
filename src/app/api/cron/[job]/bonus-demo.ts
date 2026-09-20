// The demo year-end bonus run, **development only** (FR-PAY-21 end to end on the seeded company).
//
// Like the payroll demo job beside it, this uses the real use-cases throughout — nothing here
// writes a bonus line by hand — so what the demo shows is what the system does:
//
//   create the run over every entity with settled 2026 results
//     → simulate the whole group's cost
//     → the owner adjusts one person's amount, with a reason
//     → HR proposes, the CEO signs (which freezes the KPI months behind every line)
//     → it is paid out through one off-cycle payroll run per entity, and that run is calculated
//
// After it, `/payroll/bonus` shows the run, and `/payroll/bonus/<run>/<person>` explains any one
// person's đồng back to their KPI months, their OKR figure and their review score.
//
// It refuses to run anywhere but a development server: it approves and pays money.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isDevelopmentEnvironment } from "@/lib/env";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { createBonusRun, getBonusCost, listBonusLines, overrideBonusLine, payBonusRun, simulateBonusRun, stepBonusRun } from "@/modules/payroll/bonus";
import { calculateRun } from "@/modules/payroll/runs";

const YEAR = 2026;
const PAYROLL_MONTH = "2027-01";
/** Why the owner moves somebody's amount — the half of FR-PAY-21 that is not arithmetic. */
const ADJUSTMENT = { reason: "Giữ chân nhân sự chủ chốt của mảng video trước mùa cao điểm 2027.", extraVnd: 5_000_000 };

export const bonusDemoRunJob: JobDefinition = {
  name: "bonus-demo-run",
  run: async () => {
    if (!isDevelopmentEnvironment()) throw new Error("bonus-demo-run is a development-only job");

    const [actorPersonId] = await listOwnerPersonIds();
    if (!actorPersonId) return { skipped: "no owner" };

    // Only entities whose 2026 results are settled: a bonus is computed from a figure somebody signed.
    const settled = await db()
      .selectDistinct({ entityId: schema.performanceResult.entityId })
      .from(schema.performanceResult)
      .where(and(eq(schema.performanceResult.year, YEAR), inArray(schema.performanceResult.status, ["locked", "published"])));
    const entityIds = settled.map((row) => row.entityId).filter((id): id is string => id !== null);
    if (entityIds.length === 0) return { skipped: "no settled performance results — run `pnpm db:seed:demo` first" };

    const existing = await db().select().from(schema.bonusRun).where(eq(schema.bonusRun.year, YEAR));
    const live = existing.find((run) => run.status !== "cancelled");
    if (live?.status === "paid") return { bonusRun: live.id, status: "paid", note: "already seeded" };

    const run = live ?? (await createBonusRun({ year: YEAR, name: `Thưởng cuối năm ${YEAR}`, entityIds, payrollMonth: PAYROLL_MONTH, note: "Dữ liệu demo." }, actorPersonId));

    // ── Simulate the whole group, then let the owner move one line ──
    if (run.status === "draft" || run.status === "simulated") {
      await simulateBonusRun(run.id, actorPersonId);
      const lines = await listBonusLines(run.id);
      // The best-paid eligible line that has not been adjusted yet: a visible, explainable override.
      const target = lines.filter((line) => line.trace.eligible && line.trace.finalAmountVnd > 0 && !line.trace.override).sort((a, b) => b.trace.computedAmountVnd - a.trace.computedAmountVnd)[0];
      if (target) {
        await overrideBonusLine({ runId: run.id, personId: target.row.personId, amountVnd: target.trace.computedAmountVnd + ADJUSTMENT.extraVnd, reason: ADJUSTMENT.reason }, actorPersonId);
      }
      await stepBonusRun(run.id, "propose", actorPersonId);
      await stepBonusRun(run.id, "approve", actorPersonId, { comment: "Đã duyệt (dữ liệu demo)." });
    } else if (run.status === "proposed") {
      await stepBonusRun(run.id, "approve", actorPersonId, { comment: "Đã duyệt (dữ liệu demo)." });
    }

    // ── Pay it: one off-cycle payroll run per entity, then calculate each one ──
    const payment = await payBonusRun(run.id, actorPersonId);
    for (const created of payment.payrollRuns) await calculateRun(created.payrollRunId);

    const cost = await getBonusCost(run.id);
    const frozen = await db().select({ id: schema.kpiScoreUse.id }).from(schema.kpiScoreUse).where(eq(schema.kpiScoreUse.consumerId, run.id));
    return {
      bonusRun: run.id,
      entities: entityIds.length,
      // Counts and ids only — a job's result goes into the job log, which is not compensation tier.
      headcount: cost.totals.headcount,
      eligible: cost.totals.eligible,
      overridden: cost.totals.overridden,
      kpiScoresFrozen: frozen.length,
      payrollRuns: payment.payrollRuns.map((created) => ({ entityId: created.entityId, payrollRunId: created.payrollRunId, headcount: created.headcount })),
    };
  },
};
