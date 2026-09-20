import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { getFinalResult, getKpiResults } from "@/modules/performance/service";
import { canAdjustBonusLine, getBonusLine, getBonusRun, isBonusRunOpen } from "@/modules/payroll/service";
import { canViewBonusOf } from "@/modules/payroll/policy";
import { OverrideLineForm } from "@/modules/payroll/ui/bonus-forms";
import { BonusTraceView } from "@/modules/payroll/ui/bonus-trace";

export const metadata: Metadata = { title: "Bonus explanation" };

/**
 * **The phase's exit criterion on screen**: one person's year-end bonus explained from their KPI
 * months and OKR figure, through the review and the weighting, to the band, the multipliers and
 * the amount — plus any owner override with its reason.
 *
 * Compensation tier: the person themself, or C&B over their entity. A line manager who reads
 * their report's review and band every day sees nothing here, and gets the same 404 as a stranger.
 */
export default async function BonusExplanationPage({ params }: PageProps<"/payroll/bonus/[runId]/[personId]">) {
  const user = await requireUser();
  const { runId, personId } = await params;
  const run = await getBonusRun(runId);
  const line = run ? await getBonusLine(runId, personId) : null;
  if (!run || !line) notFound();
  if (!canViewBonusOf(user.principal, { personId, entityId: line.row.entityId })) notFound();
  requireStepUp(user, `/payroll/bonus/${runId}/${personId}`);

  const [t, result, kpi] = await Promise.all([getTranslations("payroll.bonus"), line.row.resultId ? getFinalResult(personId, run.year) : null, getKpiResults({ personId, year: run.year })]);
  // Only the months this line was actually computed from — the ones approval froze.
  const usedMonths = kpi.months.filter((month) => line.row.kpiScoreIds.includes(month.scoreId));
  const mayAdjust = canAdjustBonusLine(user.principal) && isBonusRunOpen(run);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href={`/payroll/bonus/${runId}`} className="text-sm text-muted-foreground hover:underline">
          ← {run.name}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          {line.personName}
          <Badge variant="outline">{run.year}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{t("trace.description")}</p>
      </header>

      <BonusTraceView trace={line.trace} result={result?.trace ?? null} kpiMonths={usedMonths} />

      {mayAdjust ? <OverrideLineForm runId={runId} personId={personId} currentAmount={line.trace.override?.amountVnd ?? null} currentReason={line.row.overrideReason} /> : null}

      {line.row.payrollRunId ? (
        <p className="text-sm text-muted-foreground">
          {t("trace.paidThrough")}{" "}
          <Link href={`/payroll/runs/${line.row.payrollRunId}`} className="underline">
            {t("trace.offCycleRun")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
