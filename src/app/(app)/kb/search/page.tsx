import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { kbViewerOf, listSpaces, searchKb } from "@/modules/kb/service";
import { KbSearchBox } from "@/modules/kb/ui/search-box";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("searchTheKnowledgeBase");

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
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/kb" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={t("search.title")}
      >
        <KbSearchBox query={query} spaceId={spaceId} className="mt-2" />
      </PageHeader>

      {query ? (
        <nav aria-label={t("search.filter")} className="tab-row">
          <Link href={href({ space: null })} aria-current={spaceId ? undefined : "page"}>
            {t("search.allSpaces")}
          </Link>
          {spaces
            .filter((space) => !space.archivedAt)
            .map((space) => (
              <Link key={space.id} href={href({ space: space.id })} aria-current={space.id === spaceId ? "page" : undefined}>
                {space.name}
              </Link>
            ))}
        </nav>
      ) : null}

      <Section title={query ? t("search.count", { count: result.total }) : undefined}>
        <List>
          {!query ? <ListEmpty>{t("search.hint")}</ListEmpty> : result.hits.length === 0 ? <ListEmpty>{t("search.none")}</ListEmpty> : null}
          {result.hits.map((hit) => (
            <ListItem key={hit.pageId} href={`/kb/pages/${hit.pageId}`} className="flex-col items-stretch gap-1 py-3">
              <span className="text-xs text-faint">
                {[hit.spaceName, ...hit.path].join(" › ")}
                {hit.publishedAt ? <span className="font-mono tabular-nums"> · {format.dateTime(hit.publishedAt, { dateStyle: "medium" })}</span> : null}
              </span>
              <span className="font-medium">{hit.title}</span>
              <span className="line-clamp-2 text-[0.8125rem] text-muted-foreground">{hit.snippet}</span>
            </ListItem>
          ))}
        </List>
      </Section>

      {result.total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between gap-2">
          {pageNo > 1 ? (
            <Link href={href({ page: pageNo - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ChevronLeftIcon aria-hidden data-icon="inline-start" />
              {t("search.previous")}
            </Link>
          ) : (
            <span />
          )}
          {pageNo * PAGE_SIZE < result.total ? (
            <Link href={href({ page: pageNo + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("search.next")}
              <ChevronRightIcon aria-hidden data-icon="inline-end" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </Page>
  );
}
