import { useTranslations } from "next-intl"
import { cn } from "cn"
import { Page } from "@/components/ui/page"
import { Skeleton } from "@/components/ui/skeleton"

// What a page looks like while its data is on the way: the bones of `Page` — the title, a row of
// tiles where the page has figures, and a sheet of rows — in the muted tint, nothing more. The
// route's `loading.tsx` shows it the moment a link is tapped (the shell around it stays), and the
// page streams in over it. No words but the one a screen reader announces.

/** The placeholder a `loading.tsx` renders. `tiles`: the page opens with figures (a dashboard). */
function PageSkeleton({ width = "default", tiles = false, rows = 6 }: { width?: "narrow" | "default" | "wide" | "full"; tiles?: boolean; rows?: number }) {
  const t = useTranslations("controls")
  return (
    <Page width={width} role="status" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {tiles ? <TileSkeletons /> : null}
      <RowsSkeleton rows={rows} />
    </Page>
  )
}

/** A row of tile placeholders, packed as `TileGrid` packs tiles. */
function TileSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-[4.75rem] rounded-xl" />
      ))}
    </div>
  )
}

/** A sheet of row placeholders: the shape of a `TableCard` or a `List`. */
function RowsSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col overflow-hidden rounded-[14px] border border-border bg-background", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
        </div>
      ))}
    </div>
  )
}

/** The fallback of a `<Suspense>` around one section of a page that streams in after the rest. */
function SectionSkeleton({ tiles = false, rows = 3 }: { tiles?: boolean; rows?: number }) {
  const t = useTranslations("controls")
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2.5">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton aria-hidden className="h-3 w-28" />
      {tiles ? <TileSkeletons /> : <RowsSkeleton rows={rows} />}
    </div>
  )
}

export { PageSkeleton, RowsSkeleton, SectionSkeleton, TileSkeletons }
