import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

// The segmented control: white keys on a washed track, the chosen one lifted. For the two-to-four
// way switches a page offers (Tasks · Projects · Reports; Mine · To approve). Links when the
// choice is a page, buttons when it is state. The row of tabs under a title is `.tab-row`.

type Option<T extends string> = { value: T; label: React.ReactNode; count?: React.ReactNode; href?: string };

function Segmented<T extends string>({
  className,
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  stretch = false,
  size = "default",
}: {
  className?: string;
  options: Option<T>[];
  value: T;
  onChange?: (value: T) => void;
  "aria-label"?: string;
  /** Fill the width, each key as wide as the next (the phone's switch). */
  stretch?: boolean;
  /** `sm` is the 28px toggle inside a card or a toolbar. */
  size?: "default" | "sm";
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("segmented", size === "sm" && "p-0.5", stretch && "flex w-full", className)}>
      {options.map((option) => {
        const on = option.value === value;
        const content = (
          <>
            {option.label}
            {option.count !== undefined && option.count !== null ? <span className={cn("font-mono text-[0.6875rem] tabular-nums", on ? "text-muted-foreground" : "text-faint")}>{option.count}</span> : null}
          </>
        );
        const classes = cn(
          "press flex items-center justify-center gap-1.5 rounded-[7px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-[0.8125rem] md:h-8",
          stretch && "flex-1",
          on ? "pill-on" : "pill-off",
        );
        if (option.href)
          return (
            <Link key={option.value} role="tab" aria-selected={on} aria-current={on ? "page" : undefined} href={option.href} className={classes}>
              {content}
            </Link>
          );
        return (
          <button key={option.value} type="button" role="tab" aria-selected={on} className={classes} onClick={() => onChange?.(option.value)}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
