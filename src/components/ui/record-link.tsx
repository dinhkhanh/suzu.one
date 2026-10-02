"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "cn"
import { recordHref, type RecordKind } from "@/lib/record-routes"

// Every name of a record — a person, a project, a client, a task — is a way to that record:
//
//   <RecordLink kind="person" id={row.managerId}>{row.managerName}</RecordLink>
//
// Quiet by design: the name keeps the ink and the weight of the text around it and underlines
// under the pointer, so a table of names does not turn blue. It falls back to plain text, with the
// same classes, when there is nowhere to go: no id, a kind this viewer cannot open (the layout
// says which, see `linkableKinds` in shell/nav.ts), or a row that is already a link (`InsideLink`)
// — an <a> inside an <a> is not HTML. So a caller never branches: a page that knows the viewer may
// not open this one record passes `id={null}`. Cosmetic, as the navigation is: the page behind
// the link checks access itself.

const OpenKinds = React.createContext<ReadonlySet<RecordKind> | null>(null)
const Inside = React.createContext(false)

/** Says which kinds of record this viewer can open at all. Outside it, nothing links. */
function RecordLinkProvider({ kinds, children }: { kinds: readonly RecordKind[]; children: React.ReactNode }) {
  const open = React.useMemo(() => new Set(kinds), [kinds])
  return <OpenKinds.Provider value={open}>{children}</OpenKinds.Provider>
}

/** Wraps the content of anything that is a link as a whole, so the names inside stay text. */
function InsideLink({ children }: { children: React.ReactNode }) {
  return <Inside.Provider value={true}>{children}</Inside.Provider>
}

function RecordLink({
  kind,
  id,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href" | "id"> & {
  kind: RecordKind
  /** The record's id; without one the name is plain text. */
  id: string | null | undefined
}) {
  const open = React.useContext(OpenKinds)
  const inside = React.useContext(Inside)
  if (children === null || children === undefined || children === false || children === "") return null
  if (!id || inside || !open?.has(kind)) return className ? <span className={className}>{children}</span> : <>{children}</>
  return (
    // Not fetched ahead: a table shows fifty of these.
    <Link
      data-slot="record-link"
      href={recordHref(kind, id)}
      prefetch={false}
      className={cn("rounded-xs underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </Link>
  )
}

export { RecordLink, RecordLinkProvider, InsideLink }
