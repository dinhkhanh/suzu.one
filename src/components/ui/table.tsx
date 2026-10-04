import * as React from "react"
import {
  AtSignIcon,
  BanknoteIcon,
  BarcodeIcon,
  Building2Icon,
  CalendarIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  ClockIcon,
  HashIcon,
  LayoutGridIcon,
  Link2Icon,
  MapPinIcon,
  PaperclipIcon,
  PercentIcon,
  PhoneIcon,
  PlusIcon,
  SquareCheckIcon,
  TagsIcon,
  TextAlignStartIcon,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { cn } from "cn"

// The reference grid: a framed sheet with a gutter of row numbers down the left, a paper-tinted
// header row of typed columns (an icon saying what the column holds before its name), hairlines
// between rows and none between columns, 44px rows, a paper wash under the row the pointer is on,
// and an "+ Add …" row closing the sheet.
//
//   <TableCard>                          the white sheet; optional
//     <TableCardHeader title icon …/>    its title row; optional
//     <Table>                            framed on its own, frameless inside a card
//       <TableHeader><TableRow><TableHead kind="text">…
//       <TableBody>…<TableEmpty>…        the empty state is a row, so the headers still show
//     </Table>
//     <TableAddRow href|children>…       a link to the create page, or a form it unfolds
//   </TableCard>
//
// The gutter is drawn by CSS (a counter on each row's ::before), so every table gets it without
// a cell of its own; `numbered={false}` drops it from a table that is not a list of records
// (a key–value sheet, a matrix, a calendar), and `numberFrom` carries the count across pages.

/** What a column holds: picks the header's icon, and for the numeric kinds the alignment. */
type ColumnKind =
  | "text"
  | "id"
  | "select"
  | "status"
  | "tags"
  | "person"
  | "org"
  | "date"
  | "time"
  | "number"
  | "money"
  | "percent"
  | "link"
  | "email"
  | "phone"
  | "file"
  | "check"
  | "place"
  | "actions"

const KIND_ICON: Partial<Record<ColumnKind, LucideIcon>> = {
  text: TextAlignStartIcon,
  id: BarcodeIcon,
  select: LayoutGridIcon,
  status: CircleDotIcon,
  tags: TagsIcon,
  person: CircleUserRoundIcon,
  org: Building2Icon,
  date: CalendarIcon,
  time: ClockIcon,
  number: HashIcon,
  money: BanknoteIcon,
  percent: PercentIcon,
  link: Link2Icon,
  email: AtSignIcon,
  phone: PhoneIcon,
  file: PaperclipIcon,
  check: SquareCheckIcon,
  place: MapPinIcon,
}

const NUMERIC: ReadonlySet<ColumnKind> = new Set(["number", "money", "percent", "time"])

/** The classes a cell of the given kind carries, so a header and its cells line up. */
function kindCell(kind: ColumnKind | undefined) {
  if (!kind) return undefined
  if (NUMERIC.has(kind)) return "text-right font-mono text-[0.8125rem] tabular-nums"
  if (kind === "id") return "font-mono text-xs text-muted-foreground"
  if (kind === "link" || kind === "email")
    return "[&_a]:text-foreground/80 [&_a]:underline [&_a]:decoration-foreground/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground"
  if (kind === "actions") return "w-px text-right"
  return undefined
}

// A frame of its own, unless a TableCard already draws one.
const FRAME =
  "rounded-[14px] border border-border bg-background in-data-[slot=table-card]:rounded-none in-data-[slot=table-card]:border-0"

function Table({
  className,
  numbered = true,
  numberFrom = 1,
  containerClassName,
  style,
  ...props
}: React.ComponentProps<"table"> & {
  /** Classes for the scrolling frame around the table (its visibility, height, margins). */
  containerClassName?: string
  /** Draw the gutter of row numbers (default). Off for key–value sheets, matrices and calendars. */
  numbered?: boolean
  /** The number of the first row, for a table that is one page of many. */
  numberFrom?: number
}) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", FRAME, containerClassName)}
    >
      <table
        data-slot="table"
        data-numbered={numbered ? "" : undefined}
        style={
          numbered && numberFrom !== 1
            ? ({ "--table-row-start": numberFrom - 1, ...style } as React.CSSProperties)
            : style
        }
        className={cn("table-grid w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-canvas [&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-canvas font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-canvas has-aria-expanded:bg-canvas data-[state=selected]:bg-primary/6",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  kind,
  icon,
  children,
  ...props
}: React.ComponentProps<"th"> & {
  /** What the column holds: draws its icon and aligns numbers right. */
  kind?: ColumnKind
  /** An icon of the caller's own, in place of the kind's. */
  icon?: React.ReactNode
}) {
  const Icon = kind ? KIND_ICON[kind] : undefined
  const glyph = icon ?? (Icon ? <Icon /> : null)
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground",
        kind && NUMERIC.has(kind) && "text-right",
        kind === "actions" && "w-px",
        className
      )}
      {...props}
    >
      {glyph ? (
        <span className="inline-flex items-center gap-1.5 align-middle [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-faint">
          {glyph}
          {children}
        </span>
      ) : (
        children
      )}
    </th>
  )
}

function TableCell({
  className,
  kind,
  ...props
}: React.ComponentProps<"td"> & {
  /** The column's kind, for its alignment and type style; matches the header's. */
  kind?: ColumnKind
}) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-11 px-3 py-2 align-middle whitespace-nowrap",
        kindCell(kind),
        className
      )}
      {...props}
    />
  )
}

/** The empty state, as a row of the grid: the headers stay, so the sheet still says what it lists. */
function TableEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <tr data-slot="table-empty" className="border-t">
      <td
        colSpan={1000}
        className={cn(
          "h-20 px-3 py-4 text-center text-sm whitespace-normal text-muted-foreground",
          className
        )}
        {...props}
      >
        {/* A wide table scrolls sideways on a phone; the sentence stays in the part on screen. */}
        <span className="sticky left-3 inline-block max-w-[calc(100vw-3rem)]">{children}</span>
      </td>
    </tr>
  )
}

/** A band naming the group of rows under it (a stage, a category). Not counted in the gutter. */
function TableGroupRow({
  className,
  children,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <tr data-slot="table-group-row" data-unnumbered="" className="border-b bg-canvas">
      <td
        colSpan={1000}
        className={cn(
          "h-8 px-3 text-xs font-semibold whitespace-nowrap text-foreground/80",
          className
        )}
        {...props}
      >
        {children}
      </td>
    </tr>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/** The white sheet a grid sits on, with room for a title row above and an add row below. */
function TableCard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="table-card"
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-background",
        className
      )}
      {...props}
    />
  )
}

/** The sheet's title row: an icon, the name, a count in grey, and actions on the right. */
function TableCardHeader({
  className,
  title,
  icon,
  count,
  description,
  actions,
  children,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode
  icon?: React.ReactNode
  count?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      data-slot="table-card-header"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3",
        className
      )}
      {...props}
    >
      {/* The title keeps 14rem before the actions may sit beside it; past that they wrap below. */}
      <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-2.5">
        {icon ? (
          <span className="flex shrink-0 text-muted-foreground [&_svg]:size-[1.125rem]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="flex items-baseline gap-2 text-[0.9375rem] font-semibold tracking-[-0.01em]">
            <span className="truncate">{title}</span>
            {count !== undefined && count !== null ? (
              <span className="font-mono text-xs font-normal text-faint tabular-nums">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
      {children}
    </header>
  )
}

const ADD_ROW =
  "flex h-11 w-full cursor-pointer items-center gap-2 border-t px-3 text-[0.8125rem] font-medium text-link transition-colors select-none hover:bg-canvas active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset [&_svg]:size-3.5"

/**
 * The "+ Add …" row that closes a sheet. Given `href`, it is a link to the create page; given
 * children (the create form), it unfolds them under the sheet — `open` to start unfolded.
 * Place it after the Table, inside the TableCard. A form that closes the row once it has saved
 * takes the `ref` (the <details> element); `bodyClassName` replaces the panel's padding for a form
 * that brings its own.
 */
function TableAddRow({
  className,
  bodyClassName,
  label,
  href,
  open,
  ref,
  children,
}: {
  className?: string
  bodyClassName?: string
  ref?: React.Ref<HTMLDetailsElement>
  /** What the row says after the plus: "Add account", "New meeting". */
  label: React.ReactNode
  href?: string
  open?: boolean
  children?: React.ReactNode
}) {
  // Indented past the gutter, so the plus sits under the first column as in the reference.
  const indent = "pl-[calc(var(--table-gutter)+0.75rem)]"
  if (href)
    return (
      <Link data-slot="table-add-row" href={href} className={cn(ADD_ROW, indent, className)}>
        <PlusIcon aria-hidden />
        {label}
      </Link>
    )
  return (
    <details ref={ref} data-slot="table-add-row" open={open} className={cn("group/add", className)}>
      <summary
        className={cn(
          ADD_ROW,
          indent,
          "list-none group-open/add:text-foreground [&::-webkit-details-marker]:hidden"
        )}
      >
        <PlusIcon aria-hidden className="transition-transform duration-200 ease-(--ease-settle) group-open/add:rotate-45" />
        {label}
      </summary>
      <div className={cn("border-t bg-canvas p-4", bodyClassName)}>{children}</div>
    </details>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableEmpty,
  TableGroupRow,
  TableCaption,
  TableCard,
  TableCardHeader,
  TableAddRow,
  type ColumnKind,
}
