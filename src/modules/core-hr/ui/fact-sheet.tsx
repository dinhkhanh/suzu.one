import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The key–value sheet of a person's details: a label in grey beside its value, one fact to a
// row on a phone and two across on a desk, on the design's white card. Server component.

export function FactSheet({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card className={cn("py-0", className)}>
      <dl className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] gap-x-4 px-4 py-1 md:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(7rem,9rem)_minmax(0,1fr)] md:gap-x-6 [&>div:last-child>*]:border-0 md:[&>div:nth-last-child(-n+2)>*]:border-0">
        {children}
      </dl>
    </Card>
  );
}

/** One fact: the label, then the value or an em dash. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="contents">
      <dt className="border-b border-border/70 py-2.5 text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 border-b border-border/70 py-2.5 text-sm break-words", empty && "text-faint")}>{empty ? "—" : children}</dd>
    </div>
  );
}
