import * as React from "react"
import Link from "next/link"
import { cn } from "cn"

// The grid's look for what is not a table: a feed, a thread, rows that each hold a small form,
// a tree. Same frame, same hairlines, same roomy rows and hover wash as <Table>, so a page that
// mixes the two reads as one sheet. Anything with columns — a name, a status, a date, a person —
// is a <Table>, not a List. Frameless inside a TableCard, which can close it with a TableAddRow.

function List({
  className,
  numbered = false,
  ...props
}: React.ComponentProps<"ul"> & {
  /** Draw the grid's gutter of row numbers. Off by default: a feed is not a register. */
  numbered?: boolean
}) {
  return (
    <ul
      data-slot="list"
      data-numbered={numbered ? "" : undefined}
      className={cn(
        "list-grid flex flex-col divide-y overflow-hidden rounded-xl border border-border bg-background text-sm empty:hidden in-data-[slot=table-card]:rounded-none in-data-[slot=table-card]:border-0",
        className
      )}
      {...props}
    />
  )
}

const ROW = "flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2.5"

/**
 * One row. Given `href`, the whole row is the link (with the hover wash); otherwise it holds
 * whatever it is given, laid out in a row. `className` styles the row's content box.
 */
function ListItem({
  className,
  href,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "children"> & {
  href?: string
  children?: React.ReactNode
}) {
  return (
    <li data-slot="list-item" className="flex items-stretch data-[state=selected]:bg-primary/5" {...props}>
      {href ? (
        <Link
          href={href}
          className={cn(
            ROW,
            "transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
            className
          )}
        >
          {children}
        </Link>
      ) : (
        <div className={cn(ROW, className)}>{children}</div>
      )}
    </li>
  )
}

/** The empty state, as a row of the list. */
function ListEmpty({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="list-empty"
      className={cn(
        "flex min-h-16 items-center justify-center px-3 py-4 text-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { List, ListItem, ListEmpty }
