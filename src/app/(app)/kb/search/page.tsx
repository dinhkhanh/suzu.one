import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { kbViewerOf, listSpaces, searchKb } from "@/modules/kb/service";
import { KbSearchBox } from "@/modules/kb/ui/search-box";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Search the knowledge base" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;

export default async function KbSearchPage(props: PageProps<"/kb/search">) {
  const user = await requireUser();
  const params = await props.searchParams;
  const query = (typeof params.q === "string" ? params.q : "").slice(0, 200);
  const spaceId = typeof params.space === "string" && UUID.test(params.space) ? params.space : null;
  const pageNo = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const viewer = kbViewerOf(user);
  const t = await getTranslations("kb");
  const format = await getFormatter();
  const [spaces, result] = await Promise.all([listSpaces(viewer), searchKb(viewer, { query, spaceId, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE })]);
  const href = (over: { space?: string | null; page?: number }) => {
    const search = new URLSearchParams({ q: query });
    const space = over.space === undefined ? spaceId : over.space;
    if (space) search.set("space", space);
    if (over.page && over.page > 1) search.set("page", String(over.page));
    return `/kb/search?${search}`;
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <Link href="/kb" className="hover:underline">
            {t("title")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("search.title")}</h1>
        <KbSearchBox query={query} spaceId={spaceId} />
        {query ? (
          <nav aria-label={t("search.filter")} className="flex flex-wrap gap-2 text-sm">
            <Link href={href({ space: null })} className={spaceId ? "text-muted-foreground hover:underline" : "font-medium underline underline-offset-4"}>
              {t("search.allSpaces")}
            </Link>
            {spaces
              .filter((space) => !space.archivedAt)
              .map((space) => (
                <Link key={space.id} href={href({ space: space.id })} className={space.id === spaceId ? "font-medium underline underline-offset-4" : "text-muted-foreground hover:underline"}>
                  {space.name}
                </Link>
              ))}
          </nav>
        ) : null}
      </header>

      {query ? <p className="text-sm text-muted-foreground">{t("search.count", { count: result.total })}</p> : <p className="text-sm text-muted-foreground">{t("search.hint")}</p>}
      <ol className="flex flex-col gap-5">
        {result.hits.map((hit) => (
          <li key={hit.pageId} className="flex flex-col gap-1">
            <Link href={`/kb/pages/${hit.pageId}`} className="text-base font-medium hover:underline">
              {hit.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {[hit.spaceName, ...hit.path].join(" / ")}
              {hit.publishedAt ? ` · ${format.dateTime(hit.publishedAt, { dateStyle: "medium" })}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">{hit.snippet}</p>
          </li>
        ))}
      </ol>
      {result.total > PAGE_SIZE ? (
        <nav className="flex items-center gap-4 text-sm">
          {pageNo > 1 ? (
            <Link href={href({ page: pageNo - 1 })} className="hover:underline">
              ← {t("search.previous")}
            </Link>
          ) : null}
          {pageNo * PAGE_SIZE < result.total ? (
            <Link href={href({ page: pageNo + 1 })} className="hover:underline">
              {t("search.next")} →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
