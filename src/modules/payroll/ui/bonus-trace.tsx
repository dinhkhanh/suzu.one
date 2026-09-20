// "Why is my year-end bonus this amount?" — the phase's exit criterion on screen (FR-PAY-21).
//
// The chain reads downwards: the KPI months and their stored scores → the OKR figure → the review
// score → the weighting that combined them into a band → the service factor → the multipliers →
// the base month salary → the amount, and any owner override with its reason. Every figure here
// comes out of the stored `BonusTrace` and the `ResultTrace` inside the performance result, so
// what is shown is what was computed, not a re-derivation.
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { ResultTrace } from "@/modules/performance/service";
import type { BonusTrace } from "../engine/bonus";
import { formatVnd } from "./money";

const percent = (bp: number | null): string => (bp === null ? "—" : `${(bp / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} %`);
const factor = (bp: number | null): string => (bp === null ? "—" : `× ${(bp / 10_000).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);

function Row({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline gap-2">
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        <span className="font-medium tabular-nums">{value}</span>
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
      <h2 className="pb-1 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

export async function BonusTraceView({ trace, result, kpiMonths }: { trace: BonusTrace; result: ResultTrace | null; kpiMonths: { month: string; scoreBp: number | null; scoreId: string }[] }) {
  const t = await getTranslations("payroll.bonus.trace");

  return (
    <div className="flex flex-col gap-4">
      {/* 1. The stored KPI month scores the year's figure was rolled up from. */}
      <Section title={t("kpi")}>
        {kpiMonths.length === 0 ? (
          <p className="text-muted-foreground">{t("noKpi")}</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {kpiMonths.map((month) => (
                <li key={month.scoreId} className="flex items-baseline justify-between gap-2 border-b py-1">
                  <span className="text-muted-foreground tabular-nums">{month.month}</span>
                  <span className="tabular-nums">{percent(month.scoreBp)}</span>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">{t("kpiFrozen", { count: kpiMonths.length })}</p>
          </>
        )}
        <Row label={t("kpiYear")} value={percent(trace.performance.kpiScoreBp)} />
      </Section>

      {/* 2 & 3. The OKR figure and the review score that went in beside it. */}
      <Section title={t("components")}>
        <Row label={t("okr")} value={percent(trace.performance.okrScoreBp)} hint={result ? t("weight", { weight: percent(result.components.find((line) => line.key === "okr")?.normalisedWeightBp ?? null) }) : null} />
        <Row label={t("review")} value={percent(trace.performance.reviewScoreBp)} hint={result ? t("weight", { weight: percent(result.components.find((line) => line.key === "review")?.normalisedWeightBp ?? null) }) : null} />
        <Row label={t("kpiComponent")} value={percent(trace.performance.kpiScoreBp)} hint={result ? t("weight", { weight: percent(result.components.find((line) => line.key === "kpi")?.normalisedWeightBp ?? null) }) : null} />
        {result?.renormalised ? <p className="pt-2 text-xs text-muted-foreground">{t("renormalised")}</p> : null}
      </Section>

      {/* 4. What the weighting made of them, and the band that published the multiplier. */}
      <Section title={t("result")}>
        <Row label={t("computedScore")} value={percent(result?.computedScoreBp ?? trace.performance.finalScoreBp)} />
        {result?.override ? (
          <>
            <Row label={t("resultOverride")} value={percent(result.override.scoreBp)} />
            <p className="py-1 text-xs text-muted-foreground">{t("resultOverrideReason", { reason: result.override.reason })}</p>
          </>
        ) : null}
        <Row label={t("finalScore")} value={percent(trace.performance.finalScoreBp)} />
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <span className="text-muted-foreground">{t("band")}</span>
          <span className="flex items-center gap-2">
            <Badge variant="secondary">{trace.performance.bandLabel ?? "—"}</Badge>
            <span className="font-medium tabular-nums">{factor(trace.performance.multiplierBp)}</span>
          </span>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">{t(`source.${trace.performance.source}`)}</p>
      </Section>

      {/* 5. The rest of the formula: service time, the unit's year, the cap, the rounding. */}
      <Section title={t("formula")}>
        <Row label={t("base")} value={formatVnd(trace.base.amountVnd)} hint={trace.base.componentCode} />
        <Row label={t("service")} value={factor(trace.service.factorBp)} hint={t("serviceHint", { months: trace.service.months, band: trace.service.label || "—" })} />
        <Row label={t("performanceFactor")} value={factor(trace.performance.multiplierBp)} hint={trace.performance.bandLabel ?? "—"} />
        <Row label={t("unitOkr")} value={factor(trace.unitOkr.multiplierBp)} hint={trace.unitOkr.level === "none" ? t("unitOkrNone") : t("unitOkrHint", { level: trace.unitOkr.level, progress: percent(trace.unitOkr.progressBp), band: trace.unitOkr.label ?? "—" })} />
        <Row label={t("combined")} value={factor(trace.combinedMultiplierBp)} />
        {trace.cap.applied ? <Row label={t("cap")} value={factor(trace.cap.multiplierBp)} hint={t("capHint", { cap: factor(trace.cap.capMultiplierBp) })} /> : null}
        {trace.rounding.beforeVnd !== trace.rounding.afterVnd ? <Row label={t("rounding")} value={formatVnd(trace.rounding.afterVnd)} hint={t("roundingHint", { before: formatVnd(trace.rounding.beforeVnd), unit: formatVnd(trace.rounding.unitVnd) })} /> : null}
      </Section>

      {/* 6. The arithmetic, step by step, exactly as the engine did it. */}
      <Section title={t("steps")}>
        <ol className="flex flex-col">
          {trace.steps.map((step, index) => (
            <li key={`${step.key}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b py-1.5 last:border-b-0">
              <span className="text-muted-foreground">{step.expression}</span>
              <span className="font-medium tabular-nums">{formatVnd(step.valueVnd)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* 7. What is actually paid, and the owner's reason if it is not what the formula said. */}
      <Section title={t("amount")}>
        <Row label={t("computedAmount")} value={formatVnd(trace.computedAmountVnd)} />
        {trace.override ? (
          <>
            <Row label={t("overrideAmount")} value={formatVnd(trace.override.amountVnd)} />
            <p className="py-1 text-xs text-muted-foreground">{t("overrideReason", { reason: trace.override.reason })}</p>
          </>
        ) : null}
        {!trace.eligible ? <p className="py-1 text-xs text-muted-foreground">{t(`exclusion.${trace.exclusion ?? "no_result"}`)}</p> : null}
        <div className="flex items-baseline justify-between gap-4 pt-2 text-base">
          <span className="font-medium">{t("finalAmount")}</span>
          <span className="font-semibold tabular-nums">{formatVnd(trace.finalAmountVnd)}</span>
        </div>
      </Section>
    </div>
  );
}
