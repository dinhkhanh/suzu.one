// A report's tile on the overview: a card that is one link, with the report's name and a chevron
// along the top, one figure in mono, a faint line under it, and — where the data gives a series —
// six small bars that say which way it is going. Server component; nothing here needs the browser.
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";

export function ReportTile({
  title,
  href,
  value,
  hint,
  series,
  tone,
  children,
}: {
  title: ReactNode;
  href: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Up to six figures, oldest first; drawn as bars against the largest. */ series?: readonly number[];
  tone?: "destructive" | "warning" | "success";
  children?: ReactNode;
}) {
  return (
    <Link href={href} className="press group/tile flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 text-sm transition-colors hover:bg-canvas">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-100 ease-(--ease-settle) group-hover/tile:translate-x-0.5" />
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className={cn("font-mono text-[1.625rem] leading-none font-medium tracking-[-0.02em] tabular-nums", tone === "destructive" && "text-destructive", tone === "warning" && "text-warning", tone === "success" && "text-success")}>
            {value}
          </span>
          {hint ? <span className="truncate text-xs text-faint">{hint}</span> : null}
        </span>
        {series && series.length > 1 ? <Sparkline values={series} /> : null}
      </span>
      {children}
    </Link>
  );
}

/** Six bars at most, the last one in full ink; the rest at a third. */
function Sparkline({ values }: { values: readonly number[] }) {
  const last = values.slice(-6);
  const max = Math.max(...last, 1);
  return (
    <span aria-hidden className="flex h-9 shrink-0 items-end gap-[3px]">
      {last.map((value, index) => (
        <span key={index} className={cn("w-2 rounded-[2px] bg-primary", index < last.length - 1 && "opacity-35")} style={{ height: `${Math.max(8, Math.round((value / max) * 100))}%` }} />
      ))}
    </span>
  );
}
