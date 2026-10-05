import * as React from "react"
import Link from "next/link"
import { cn } from "cn"
import { LinkPending } from "@/components/shell/link-pending"

// The bones of every page: a header with the title, a line under it and the actions on the
// right (stacked on a phone, in a row on a desk); sections headed by the small uppercase caption;
// and the page's own column width. Pages compose these instead of writing their own flex soup,
// so every screen opens the same way.

/** The page's column. `width` is its reading width; `wide` pages (grids, boards) take the room. */
function Page({
  className,
  width = "default",
  ...props
}: React.ComponentProps<"div"> & { width?: "narrow" | "default" | "wide" | "full" }) {
  return (
    <div
      data-slot="page"
      className={cn(
        "flex w-full flex-col gap-6 md:gap-8",
        width === "narrow" && "mx-auto max-w-2xl",
        width === "default" && "max-w-5xl",
        width === "wide" && "max-w-7xl",
        className
      )}
      {...props}
    />
  )
}

/**
 * The top of a page: an optional line above the title (a date, a crumb), the title, a description,
 * and the actions. On a phone the actions drop under the text and stretch; on a desk they sit at the
 * right end of the title line.
 */
function PageHeader({
  className,
  eyebrow,
  title,
  description,
  actions,
  aside,
  children,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** A figure beside the title (a payslip's net pay, a run's total): right-aligned on a desk, under the text on a phone. */
  aside?: React.ReactNode
}) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <p className="text-[0.8125rem] font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {aside || actions ? (
        <div className="flex shrink-0 flex-col gap-3 md:items-end">
          {aside ? <div data-slot="page-aside">{aside}</div> : null}
          {actions ? (
            <div data-slot="page-actions" className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}

/** A section of a page: the uppercase caption, something at its right end, and the body. */
function Section({
  className,
  title,
  count,
  action,
  description,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode
  /** A figure beside the caption, in mono. */
  count?: React.ReactNode
  /** A link or a small button at the right end of the caption line. */
  action?: React.ReactNode
  /** One faint line under the caption. */
  description?: React.ReactNode
}) {
  return (
    <section data-slot="section" className={cn("flex flex-col gap-2.5", className)} {...props}>
      {title || action ? (
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          {title ? (
            <h2 className="section-label flex items-baseline gap-1.5">
              {title}
              {count !== undefined && count !== null ? <span className="font-mono text-[0.6875rem] font-medium text-faint normal-case tabular-nums">{count}</span> : null}
            </h2>
          ) : <span />}
          {action ? <div className="flex shrink-0 items-center gap-2 text-[0.8125rem] font-medium [&>a]:text-link">{action}</div> : null}
        </div>
      ) : null}
      {description ? <p className="-mt-1 px-0.5 text-[0.8125rem] text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

/** A key figure: the value in mono over its name, with an optional line under it. */
function Tile({
  className,
  label,
  value,
  hint,
  tone,
  href,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  /** Colours the figure when it says something: warning for "look here", destructive for "wrong". */
  tone?: "warning" | "destructive" | "success"
  href?: string
}) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className={cn("tile-value", tone === "warning" && "text-warning", tone === "destructive" && "text-destructive", tone === "success" && "text-success")}>{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </>
  )
  if (href) {
    return (
      <Link href={href} className={cn("tile press hover:bg-canvas has-[[data-link-pending]]:bg-canvas", className)}>
        {body}
        <LinkPending />
      </Link>
    )
  }
  return (
    <div data-slot="tile" className={cn("tile", className)} {...props}>
      {body}
    </div>
  )
}

/** A row of tiles that packs as many across as fit. */
function TileGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="tile-grid" className={cn("grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:gap-3", className)} {...props} />
}

export { Page, PageHeader, Section, Tile, TileGrid }
