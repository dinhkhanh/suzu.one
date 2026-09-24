// Display pieces of the KPI screens. No hooks: labels and the number format are passed in, so
// they work in server and client components alike.
import Link from "next/link";
import { isMonthKey, shiftMonth } from "@/lib/month-grid";
import type { KpiTrace, KpiTraceLine } from "../engine/kpi-score";
import type { KpiUnit } from "../enums";
import { metricText } from "./progress";

type NumberFormat = { number(value: number, options?: { maximumFractionDigits?: number }): string };
type Translate = (key: string, values?: Record<string, string | number>) => string;
export type KpiLabels = { t: Translate; format: NumberFormat };

/** The month a KPI screen opens on: the one just ended — that is the one being entered and closed. */
export const readMonth = (value: unknown, today: string): string => (isMonthKey(value) ? value : shiftMonth(today.slice(0, 7), -1));
export const monthLabel = (month: string): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
export const periodLabel = (periodKey: string): string => (periodKey.includes("Q") ? `${periodKey.slice(5)}/${periodKey.slice(0, 4)}` : monthLabel(periodKey));

export const kpiValueText = (format: NumberFormat, unit: KpiUnit, value: number | null): string => (value === null ? "—" : metricText(format, unit, value));
export const bpText = (format: NumberFormat, bp: number | null): string => (bp === null ? "—" : `${format.number(bp / 100, { maximumFractionDigits: 2 })} %`);

export function MonthPicker({ month, href, labels }: { month: string; href: (month: string) => string; labels: { previous: string; next: string } }) {
  const link = "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted";
  return (
    <nav className="flex items-center gap-1">
      <Link href={href(shiftMonth(month, -1))} className={link} aria-label={labels.previous}>
        ←
      </Link>
      <span className="rounded-md bg-muted px-2 py-1 text-sm font-medium tabular-nums">{monthLabel(month)}</span>
      <Link href={href(shiftMonth(month, 1))} className={link} aria-label={labels.next}>
        →
      </Link>
    </nav>
  );
}

const pill = "inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap";

export function ScoreState({ state, label }: { state: "closed" | "open"; label: string }) {
  return <span className={`${pill} ${state === "closed" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border border-dashed text-muted-foreground"}`}>{label}</span>;
}

/** A score as a figure with its colour: under 70 % red, under 90 % amber, else green. */
export function ScoreFigure({ bp, text }: { bp: number | null; text: string }) {
  const colour = bp === null ? "text-muted-foreground" : bp < 7000 ? "text-destructive" : bp < 9000 ? "text-warning" : "text-success";
  return <span className={`font-medium tabular-nums ${colour}`}>{text}</span>;
}

const flagsOf = (line: KpiTraceLine, t: Translate): string => line.flags.map((flag) => t(`kpi.flags.${flag}`)).join(" · ");

/** The whole working out of a month score: every line's target, actual, attainment, weight and share. */
export function TraceTable({ trace, labels }: { trace: KpiTrace; labels: KpiLabels }) {
  const { t, format } = labels;
  if (trace.lines.length === 0) return <p className="text-sm text-muted-foreground">{t("kpi.noLines")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="p-2 font-medium">{t("kpi.columns.kpi")}</th>
            <th className="p-2 text-right font-medium">{t("kpi.columns.target")}</th>
            <th className="p-2 text-right font-medium">{t("kpi.columns.actual")}</th>
            <th className="p-2 text-right font-medium">{t("kpi.columns.attainment")}</th>
            <th className="p-2 text-right font-medium">{t("kpi.columns.weight")}</th>
            <th className="p-2 text-right font-medium">{t("kpi.columns.contribution")}</th>
          </tr>
        </thead>
        <tbody>
          {trace.lines.map((line) => (
            <tr key={line.assignmentId} className={`border-b last:border-0 ${line.counted ? "" : "text-muted-foreground"}`}>
              <td className="p-2">
                <div>{line.kpiName}</div>
                <div className="text-xs text-muted-foreground">
                  {[line.kpiCode, t(`kpi.direction.${line.direction}`), line.frequency === "quarterly" ? periodLabel(line.periodKey) : null, flagsOf(line, t) || null, line.note ?? null].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="p-2 text-right tabular-nums">{kpiValueText(format, line.unit, line.targetValue)}</td>
              <td className="p-2 text-right tabular-nums">{line.notApplicable ? t("kpi.notApplicableShort") : kpiValueText(format, line.unit, line.actualValue)}</td>
              <td className="p-2 text-right tabular-nums">
                {bpText(format, line.finalBp)}
                {line.rawBp !== null && line.rawBp !== line.finalBp ? <div className="text-xs text-muted-foreground">{t("kpi.raw", { value: bpText(format, line.rawBp) })}</div> : null}
              </td>
              <td className="p-2 text-right tabular-nums">
                {line.weight}
                {line.counted && trace.totalWeight > 0 ? <div className="text-xs text-muted-foreground">{bpText(format, Math.round((line.weight * 10000) / trace.totalWeight))}</div> : null}
              </td>
              <td className="p-2 text-right tabular-nums">{bpText(format, line.contributionBp)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="p-2" colSpan={4}>
              {t("kpi.formula")}
            </td>
            <td className="p-2 text-right tabular-nums">{trace.totalWeight}</td>
            <td className="p-2 text-right tabular-nums">{bpText(format, trace.scoreBp)}</td>
          </tr>
        </tfoot>
      </table>
      {trace.notes.length > 0 ? (
        <ul className="list-disc border-t px-6 py-2 text-xs text-muted-foreground">
          {trace.notes.map((note) => (
            <li key={note}>{t(`kpi.notes.${note}`)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
