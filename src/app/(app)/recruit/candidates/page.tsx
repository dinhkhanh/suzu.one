import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager, readPage } from "@/components/ui/pager";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { canBrowseCandidates, listCandidatePage } from "@/modules/recruit/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("candidates");

/** Candidates per page (PERF-03). */
const PAGE_SIZE = 50;

// The candidate database (FR-REC-04). `recruit:manage` and nobody else — a hiring manager reaches
// the people applying for their job through the opening, not through here. The talent pool is a
// view of it: the people kept beyond their applications because they asked to be.
export default async function CandidatesPage({ searchParams }: PageProps<"/recruit/candidates">) {
  const user = await requireUser();
  if (!canBrowseCandidates(user.principal)) notFound();
  const query = await searchParams;
  const q = typeof query.q === "string" && query.q ? query.q : undefined;
  const inPool = query.pool === "1";
  const page = readPage(query.page);
  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const { rows, total } = await listCandidatePage(user.principal, { query: q, talentPool: inPool }, page, PAGE_SIZE);
  // The pages carry the search and the pool along.
  const pageHref = (to: number) => {
    const params = new URLSearchParams(Object.entries({ pool: inPool ? "1" : undefined, q, page: to > 1 ? String(to) : undefined }).filter((entry): entry is [string, string] => !!entry[1]));
    return params.size ? `/recruit/candidates?${params.toString()}` : "/recruit/candidates";
  };

  return (
    <Page>
      <PageHeader
        title={t("candidates")}
        description={t("confidential")}
        actions={
          <Link href="/recruit/candidates/new" className={buttonVariants()}>
            {t("newCandidate")}
          </Link>
        }
      />

      <nav className="tab-row" aria-label={t("candidates")}>
        <Link href="/recruit/candidates" aria-current={inPool ? undefined : "page"}>
          {t("pool.all")}
        </Link>
        <Link href="/recruit/candidates?pool=1" aria-current={inPool ? "page" : undefined}>
          {t("pool.title")}
        </Link>
      </nav>
      {inPool ? <p className="text-sm text-muted-foreground">{t("pool.description")}</p> : null}

      <form className="flex gap-2">
        {inPool ? <input type="hidden" name="pool" value="1" /> : null}
        <Input name="q" defaultValue={q ?? ""} placeholder={t("columns.candidate")} className="max-w-xs" />
        <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("columns.candidate")}
        </button>
      </form>

      <TableCard>
        <Table numberFrom={(page - 1) * PAGE_SIZE + 1}>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.candidate")}</TableHead>
              <TableHead kind="text">{t("columns.currentTitle")}</TableHead>
              <TableHead kind="select">{t("columns.source")}</TableHead>
              <TableHead kind="tags">{t("columns.tags")}</TableHead>
              <TableHead kind="date">{t("columns.createdAt")}</TableHead>
              <TableHead kind="number">{t("reports.applications")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{inPool ? t("pool.empty") : t("noCandidates")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-72">
                  <span className="flex items-center gap-2">
                    <RecordLink kind="candidate" id={row.id} className="truncate font-medium">
                      {row.fullName}
                    </RecordLink>
                    {row.anonymised ? <Badge variant="outline">{t("event.anonymised")}</Badge> : null}
                    {row.talentPool && !row.anonymised && !inPool ? <Badge variant="secondary">{t("pool.badge")}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-56 truncate">{row.currentTitle || "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`source.${row.source}`)}</Badge>
                </TableCell>
                <TableCell>
                  {row.tags.length ? (
                    <span className="flex flex-wrap gap-1">
                      {row.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium" })}</TableCell>
                <TableCell kind="number">{row.applications}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("newCandidate")} href="/recruit/candidates/new" />
      </TableCard>
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={pageHref} />
    </Page>
  );
}
