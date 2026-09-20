// Display pieces of the final yearly result (FR-PRF-09). No hooks: labels and the number format
// come in as props, so the same pieces work in a server and a client component.
//
// The trace table is the phase's exit criterion made visible: every row says what a component
// scored, what it weighed, what it weighed once the missing ones dropped out, and what it
// therefore contributed — and the contributions add up to the score printed underneath.
import type { ResultBand } from "../enums";
import type { ResultTrace } from "../engine/result";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type NumberFormat = { number(value: number, options?: { maximumFractionDigits?: number }): string };
type Labels = { t: Translate; format: NumberFormat };

const pill = "inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap";

export const percentText = (format: NumberFormat, bp: number | null | undefined): string => (bp === null || bp === undefined ? "—" : `${format.number(bp / 100, { maximumFractionDigits: 2 })} %`);

/** The band a result landed in. `labelEn` is used when the reader's language is English. */
export const bandLabel = (band: ResultBand | null | undefined, locale: string): string => (band ? (locale.startsWith("en") && band.labelEn ? band.labelEn : band.label) : "—");

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "published"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "locked"
        ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
        : "border border-dashed text-muted-foreground";
  return <span className={`${pill} ${tone}`}>{label}</span>;
}

export function BandBadge({ band, label }: { band: string | null; label: string }) {
  if (!band) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`${pill} bg-muted text-foreground`}>{label}</span>;
}

/**
 * The whole derivation of one result. This is what makes a band — and the bonus amount built on
 * it — explainable: the three components with their weights and contributions, the OKR mix behind
 * the OKR line, the owner's override if there was one, and the provenance underneath.
 */
export function ResultTraceTable({ trace, labels, locale, provenance }: { trace: ResultTrace; labels: Labels; locale: string; provenance?: { months: number; goals: number; weightingFrom: string | null } }) {
  const { t, format } = labels;
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b text-left">
            <th className="py-1 font-normal">{t("trace.component")}</th>
            <th className="py-1 text-right font-normal">{t("trace.score")}</th>
            <th className="py-1 text-right font-normal">{t("trace.weight")}</th>
            <th className="py-1 text-right font-normal">{t("trace.normalised")}</th>
            <th className="py-1 text-right font-normal">{t("trace.contribution")}</th>
          </tr>
        </thead>
        <tbody>
          {trace.components.map((line) => (
            <tr key={line.key} className="border-b last:border-b-0">
              <td className="py-1">
                {t(`trace.components.${line.key}`)}
                {line.flags.includes("missing") ? <span className="block text-xs text-amber-700 dark:text-amber-300">{t("trace.missing")}</span> : null}
              </td>
              <td className="py-1 text-right tabular-nums">{percentText(format, line.scoreBp)}</td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">{percentText(format, line.weightBp)}</td>
              <td className="py-1 text-right tabular-nums">{percentText(format, line.normalisedWeightBp)}</td>
              <td className="py-1 text-right tabular-nums">{percentText(format, line.contributionBp)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {trace.okr.lines.some((line) => line.normalisedWeightBp > 0) ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("trace.okrMix")}</summary>
          <ul className="flex flex-col gap-0.5 pt-2">
            {trace.okr.lines
              .filter((line) => line.weightBp > 0)
              .map((line) => (
                <li key={line.level} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{t(`trace.level.${line.level}`)}</span>
                  <span className="tabular-nums">
                    {percentText(format, line.progressBp)} × {percentText(format, line.normalisedWeightBp)} = {percentText(format, line.contributionBp)}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-col gap-0.5 text-sm">
        {trace.renormalised ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("trace.renormalised")}</p> : null}
        {trace.computedScoreBp === null ? (
          <p className="text-muted-foreground">{t("trace.nothing")}</p>
        ) : (
          <p className="tabular-nums">{t("trace.computed", { value: percentText(format, trace.computedScoreBp) })}</p>
        )}
        {trace.override ? (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("override.was", { value: percentText(format, trace.computedScoreBp) })} — {trace.override.reason}
          </p>
        ) : null}
        <p className="font-medium tabular-nums">
          {t("trace.finalLine", { value: percentText(format, trace.finalScoreBp), band: bandLabel(trace.finalBand, locale), multiplier: percentText(format, trace.multiplierBp) })}
        </p>
        {provenance ? (
          <p className="text-xs text-muted-foreground">
            {t("trace.provenance", { months: provenance.months, goals: provenance.goals })}
            {provenance.weightingFrom ? ` · ${t("trace.weightingVersion", { date: provenance.weightingFrom })}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
