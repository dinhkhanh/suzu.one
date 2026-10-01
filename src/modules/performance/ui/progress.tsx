// Small display pieces without hooks: labels are passed in, so they work in server and client components alike.
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { cn } from "cn";
import type { Confidence, GoalStatus, MetricType, Milestone } from "../enums";

/** Basis points as a percentage with at most two decimals: 3125 → "31,25" through the reader's number format. */
export const bpToPercent = (bp: number): number => bp / 100;

/**
 * The design's progress bar: 6px, the accent for what is under way and the success tone once the
 * target is met, with the figure in faint mono beside it. `wide` stretches it to its container (a
 * card's column); otherwise it is a fixed 7rem for a row of a list.
 */
export function ProgressBar({ bp, label, wide = false, className }: { bp: number | null; /** "31,25 %" or the wording for "not measured yet". */ label: string; wide?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", wide ? "min-w-0 flex-1" : "shrink-0", className)}>
      <div className={cn("h-1.5 shrink-0 overflow-hidden rounded-full bg-muted", wide ? "min-w-0 flex-1" : "w-28")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bp === null ? undefined : Math.round(bp / 100)}>
        <div className={cn("h-full rounded-full transition-[width] duration-200 ease-(--ease-settle)", bp !== null && bp >= 10_000 ? "bg-success" : "bg-primary")} style={{ width: `${bp === null ? 0 : Math.min(100, bp / 100)}%` }} />
      </div>
      <span className="shrink-0 font-mono text-xs text-faint tabular-nums">{label}</span>
    </div>
  );
}

const CONFIDENCE_TONE: Record<Confidence, BadgeVariant> = {
  on_track: "success",
  at_risk: "warning",
  off_track: "destructive",
};

export function ConfidenceBadge({ confidence, label }: { confidence: Confidence | null; label: string }) {
  if (!confidence) return null;
  return (
    <Badge dot variant={CONFIDENCE_TONE[confidence]}>
      {label}
    </Badge>
  );
}

export function GoalStatusBadge({ status, label }: { status: GoalStatus; label: string }) {
  return (
    <Badge dot variant={statusTone(status)} className={status === "cancelled" ? "line-through" : undefined}>
      {label}
    </Badge>
  );
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
