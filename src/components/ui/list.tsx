import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { LinkPending } from "@/components/shell/link-pending";
import { InsideLink } from "./record-link";

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
  numbered?: boolean;
}) {
  return (
    <ul
      data-slot="list"
      data-numbered={numbered ? "" : undefined}
      className={cn(
        "list-grid flex flex-col divide-y divide-border/70 overflow-hidden rounded-[14px] border border-border bg-background text-sm empty:hidden in-data-[slot=table-card]:rounded-none in-data-[slot=table-card]:border-0",
        className,
      )}
      {...props}
    />
  );
}

const ROW = "flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 px-4 py-2.5 md:min-h-12 md:px-3.5";

/**
 * One row. Given `href`, the whole row is the link (with the hover wash) and the names inside
 * it stay text (`InsideLink`); otherwise it holds whatever it is given, laid out in a row. A
 * linked row washes under the finger the moment it is pressed and stays washed until its page
 * has arrived, the way a native list holds the row it is opening.
 * `className` styles the row's content box.
 */
function ListItem({
  className,
  href,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "children"> & {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <li data-slot="list-item" className="flex items-stretch data-[state=selected]:bg-primary/5" {...props}>
      {href ? (
        <Link href={href} className={cn(ROW, "transition-colors duration-100 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none active:bg-muted has-[[data-link-pending]]:bg-muted", className)}>
          <InsideLink>{children}</InsideLink>
          <LinkPending />
        </Link>
      ) : (
        <div className={cn(ROW, className)}>{children}</div>
      )}
    </li>
  );
}

/** The empty state, as a row of the list. */
function ListEmpty({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="list-empty" className={cn("flex min-h-20 items-center justify-center px-4 py-5 text-center text-sm text-muted-foreground", className)} {...props} />;
}

export { List, ListItem, ListEmpty };
