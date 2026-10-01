// A share as a short bar beside its figure, for a table column of rates: a muted track, a fill in
// the accent (or a tone when the rate says something), and the number in mono after it.
import type { ReactNode } from "react";
import { cn } from "cn";

export function RateBar({ rate, label, tone, className }: { /** 0–1; null draws no bar. */ rate: number | null; label: ReactNode; tone?: "destructive" | "warning" | "success"; className?: string }) {
  const width = rate === null ? 0 : Math.max(0, Math.min(1, rate)) * 100;
  return (
    <span className={cn("inline-flex items-center justify-end gap-2", className)}>
      {rate !== null ? (
        <span aria-hidden className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full bg-primary", tone === "destructive" && "bg-destructive", tone === "warning" && "bg-warning", tone === "success" && "bg-success")} style={{ width: `${width}%` }} />
        </span>
      ) : null}
      <span className="font-mono text-[0.8125rem] tabular-nums">{label}</span>
    </span>
  );
}
