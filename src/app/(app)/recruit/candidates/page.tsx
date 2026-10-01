import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { canBrowseCandidates, listCandidates } from "@/modules/recruit/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("candidates");

// The candidate database (FR-REC-04). `recruit:manage` and nobody else — a hiring manager reaches
// the people applying for their job through the opening, not through here.
export default async function CandidatesPage({ searchParams }: PageProps<"/recruit/candidates">) {
  const user = await requireUser();
  if (!canBrowseCandidates(user.principal)) notFound();
  const { q } = await searchParams;
  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const rows = await listCandidates(user.principal, { query: typeof q === "string" ? q : undefined });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("candidates")}</h1>
          <p className="text-sm text-muted-foreground">{t("confidential")}</p>
        </div>
        <Link href="/recruit/candidates/new" className={buttonVariants({ size: "sm" })}>
          {t("newCandidate")}
        </Link>
      </header>

      <form className="flex gap-2">
        <Input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder={t("columns.candidate")} className="max-w-xs" />
        <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("columns.candidate")}
        </button>
      </form>

      <TableCard>
        <Table>
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
            {rows.length === 0 ? <TableEmpty>{t("noCandidates")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-72">
                  <span className="flex items-center gap-2">
                    <Link href={`/recruit/candidates/${row.id}`} className="truncate font-medium hover:underline">
                      {row.fullName}
                    </Link>
                    {row.anonymised ? <Badge variant="outline">{t("event.anonymised")}</Badge> : null}
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
    </div>
  );
}
