import { cn } from "@/lib/utils";

// The thin bar every project figure is read on: a 6px track in the wash, the filled part in the
// accent (or a tone when the figure says something), never more than full. `Meter` is the bar
// with its name on the left and the figure in mono on the right — the three rows of a project's
// progress card, a cell of the portfolio.

type Tone = "default" | "success" | "warning" | "destructive";

const FILL: Record<Tone, string> = { default: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" };

export function ProgressBar({ percent, tone = "default", className, label }: { percent: number | null; tone?: Tone; className?: string; label?: string }) {
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role={label ? "progressbar" : undefined} aria-label={label} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined} aria-valuenow={label ? value : undefined}>
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-(--ease-settle)", FILL[tone])} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Meter({ label, figure, percent, tone, hint }: { label: React.ReactNode; figure: React.ReactNode; percent: number | null; tone?: Tone; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-[0.8125rem] font-medium tabular-nums">{figure}</span>
      </div>
      <ProgressBar percent={percent} tone={tone} />
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

/** A percent as a tone: fine under 90, a warning up to full, wrong over it. */
export const burnTone = (percent: number | null): Tone => (percent === null ? "default" : percent > 100 ? "destructive" : percent > 90 ? "warning" : "success");
