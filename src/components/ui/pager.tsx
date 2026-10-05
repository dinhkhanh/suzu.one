import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How many pages `total` rows make at `pageSize` a page; at least one, so an empty list is page 1 of 1. */
export const pageCountOf = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

/** The page a `?page=` parameter names: a whole number from 1, anything else is the first. */
export function readPage(value: unknown): number {
  const page = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/**
 * Previous / next under a paginated table (the table numbers its rows with `numberFrom`). A server
 * component: `href` builds each page's link, carrying the list's filters along. Nothing shows when
 * everything fits on one page.
 */
export async function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pageCount = pageCountOf(total, pageSize);
  if (pageCount <= 1) return null;
  const t = await getTranslations("controls.pager");
  return (
    <nav aria-label={t("label")} className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{t("page", { page, pageCount, total })}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(Math.min(page, pageCount) - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("previous")}
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("next")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
