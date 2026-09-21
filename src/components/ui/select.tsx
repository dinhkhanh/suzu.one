import * as React from "react"
import { cn } from "cn"

// A native <select>, styled to sit next to Input. Native on purpose: it works in GET filter forms
// without JavaScript and gets the platform picker on phones.
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 rounded-[0.625rem] border border-input bg-background px-2.5 py-1 text-base font-medium shadow-[0_1px_1px_oklch(0_0_0/3%)] transition-colors outline-none focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 md:text-sm dark:bg-input/20",
        className
      )}
      {...props}
    />
  )
}

export { Select }
