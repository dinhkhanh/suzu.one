// Display pieces of the KPI screens. No hooks: labels and the number format are passed in, so
// they work in server and client components alike.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
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

/** Last month · this month · next month: two outline keys around the month in mono. */
export function MonthPicker({ month, href, labels }: { month: string; href: (month: string) => string; labels: { previous: string; next: string } }) {
  const key = buttonVariants({ variant: "outline", size: "icon-sm" });
  return (
    <nav className="flex items-center gap-1.5">
      <Link href={href(shiftMonth(month, -1))} className={key} aria-label={labels.previous}>
        <ChevronLeftIcon aria-hidden />
      </Link>
      <span className="min-w-[4.5rem] text-center font-mono text-sm font-medium tabular-nums">{monthLabel(month)}</span>
      <Link href={href(shiftMonth(month, 1))} className={key} aria-label={labels.next}>
        <ChevronRightIcon aria-hidden />
      </Link>
    </nav>
  );
}

export function ScoreState({ state, label }: { state: "closed" | "open"; label: string }) {
  return (
    <Badge dot variant={state === "closed" ? "success" : "outline"}>
      {label}
    </Badge>
  );
}

/** A score as a figure with its colour: under 70 % red, under 90 % amber, else green. */
export function ScoreFigure({ bp, text }: { bp: number | null; text: string }) {
  const colour = bp === null ? "text-muted-foreground" : bp < 7000 ? "text-destructive" : bp < 9000 ? "text-warning" : "text-success";
  return <span className={`font-mono font-medium tabular-nums ${colour}`}>{text}</span>;
}

/** The state of one KPI line this month: met, short of the target, or not scored yet. */
export function LineState({ bp, counted, labels }: { bp: number | null; counted: boolean; labels: { met: string; short: string; pending: string; excluded: string } }) {
  if (!counted) return <Badge variant="outline">{labels.excluded}</Badge>;
  if (bp === null) return <Badge dot variant="warning">{labels.pending}</Badge>;
  return (
    <Badge dot variant={bp >= 10_000 ? "success" : "warning"}>
      {bp >= 10_000 ? labels.met : labels.short}
    </Badge>
  );
}

/**
 * Six bars of a series, the last one in the accent: enough to see which way a figure is going
 * without reading it. Null values draw as the faintest bar. Decorative — the figures are beside it.
 */
export function Sparkline({ series, className }: { series: readonly (number | null)[]; className?: string }) {
  const shown = series.slice(-6);
  if (shown.length === 0) return null;
  const max = Math.max(1, ...shown.map((value) => value ?? 0));
  return (
    <span aria-hidden className={cn("inline-flex h-5 items-end gap-0.5", className)}>
      {shown.map((value, index) => (
        <span
          key={index}
          className={cn("w-2 rounded-[2px]", index === shown.length - 1 ? "bg-primary" : "bg-primary/30", value === null && "bg-muted")}
          style={{ height: `${value === null ? 15 : Math.max(15, Math.round((value / max) * 100))}%` }}
        />
      ))}
    </span>
  );
}

const flagsOf = (line: KpiTraceLine, t: Translate): string => line.flags.map((flag) => t(`kpi.flags.${flag}`)).join(" · ");

/** The whole working out of a month score: every line's target, actual, attainment, weight and share. */
export function TraceTable({ trace, labels }: { trace: KpiTrace; labels: KpiLabels }) {
  const { t, format } = labels;
  return (
    <TableCard>
      <Table numbered={false}>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("kpi.columns.kpi")}</TableHead>
            <TableHead kind="number">{t("kpi.columns.target")}</TableHead>
            <TableHead kind="number">{t("kpi.columns.actual")}</TableHead>
            <TableHead kind="percent">{t("kpi.columns.attainment")}</TableHead>
            <TableHead kind="number">{t("kpi.columns.weight")}</TableHead>
            <TableHead kind="percent">{t("kpi.columns.contribution")}</TableHead>
            <TableHead kind="status">{t("kpi.columns.state")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trace.lines.length === 0 ? <TableEmpty>{t("kpi.noLines")}</TableEmpty> : null}
          {trace.lines.map((line) => (
            <TableRow key={line.assignmentId} className={line.counted ? undefined : "text-muted-foreground"}>
              <TableCell className="min-w-56 whitespace-normal">
                <div className="font-medium">{line.kpiName}</div>
                <div className="text-xs text-faint">
                  {[line.kpiCode, t(`kpi.direction.${line.direction}`), line.frequency === "quarterly" ? periodLabel(line.periodKey) : null, flagsOf(line, t) || null, line.note ?? null].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell kind="number">{kpiValueText(format, line.unit, line.targetValue)}</TableCell>
              <TableCell kind="number">{line.notApplicable ? t("kpi.notApplicableShort") : kpiValueText(format, line.unit, line.actualValue)}</TableCell>
              <TableCell kind="percent">
                {bpText(format, line.finalBp)}
                {line.rawBp !== null && line.rawBp !== line.finalBp ? <div className="text-xs text-muted-foreground">{t("kpi.raw", { value: bpText(format, line.rawBp) })}</div> : null}
              </TableCell>
              <TableCell kind="number">
                {line.weight}
                {line.counted && trace.totalWeight > 0 ? <div className="text-xs text-muted-foreground">{bpText(format, Math.round((line.weight * 10000) / trace.totalWeight))}</div> : null}
              </TableCell>
              <TableCell kind="percent">{bpText(format, line.contributionBp)}</TableCell>
              <TableCell kind="status">
                <LineState bp={line.finalBp} counted={line.counted} labels={{ met: t("kpi.lineState.met"), short: t("kpi.lineState.short"), pending: t("kpi.lineState.pending"), excluded: t("kpi.lineState.excluded") }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {trace.lines.length > 0 ? (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>{t("kpi.formula")}</TableCell>
              <TableCell kind="number">{trace.totalWeight}</TableCell>
              <TableCell kind="percent">{bpText(format, trace.scoreBp)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      {trace.notes.length > 0 ? (
        <ul className="list-disc border-t px-4 py-2.5 pl-8 text-xs text-muted-foreground">
          {trace.notes.map((note) => (
            <li key={note}>{t(`kpi.notes.${note}`)}</li>
          ))}
        </ul>
      ) : null}
    </TableCard>
  );
}
