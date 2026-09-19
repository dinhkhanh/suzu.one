// Small display pieces without hooks: labels are passed in, so they work in server and client components alike.
import type { Confidence, GoalStatus, MetricType, Milestone } from "../enums";

/** Basis points as a percentage with at most two decimals: 3125 → "31,25" through the reader's number format. */
export const bpToPercent = (bp: number): number => bp / 100;

export function ProgressBar({ bp, label }: { bp: number | null; /** "31,25 %" or the wording for "not measured yet". */ label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bp === null ? undefined : Math.round(bp / 100)}>
        <div className={`h-full rounded-full ${bp !== null && bp >= 10_000 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${bp === null ? 0 : bp / 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </div>
  );
}

const CONFIDENCE_CLASSES: Record<Confidence, string> = {
  on_track: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  at_risk: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  off_track: "bg-destructive/10 text-destructive",
};
const pill = "inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap";

export function ConfidenceBadge({ confidence, label }: { confidence: Confidence | null; label: string }) {
  if (!confidence) return null;
  return <span className={`${pill} ${CONFIDENCE_CLASSES[confidence]}`}>{label}</span>;
}

const STATUS_CLASSES: Record<GoalStatus, string> = {
  draft: "border border-dashed text-muted-foreground",
  active: "border text-foreground",
  closed: "bg-muted text-foreground",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function GoalStatusBadge({ status, label }: { status: GoalStatus; label: string }) {
  return <span className={`${pill} ${STATUS_CLASSES[status]}`}>{label}</span>;
}

/** A key result's value the way people say it: "12,5", "85 %", "1.500.000 ₫", "2/4". */
/** What next-intl's formatter offers, as far as this needs it. */
type NumberFormat = { number(value: number, options?: { maximumFractionDigits?: number }): string };

export function metricText(format: NumberFormat, metricType: MetricType, value: number, milestones?: Milestone[] | null): string {
  if (metricType === "milestone") return `${(milestones ?? []).filter((milestone) => milestone.done).length}/${(milestones ?? []).length}`;
  if (metricType === "currency") return `${format.number(value)} ₫`;
  const text = format.number(value / 100, { maximumFractionDigits: 2 });
  return metricType === "percent" ? `${text} %` : text;
}
