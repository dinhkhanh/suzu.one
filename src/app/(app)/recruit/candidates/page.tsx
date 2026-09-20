import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/modules/platform/auth/session";
import { canBrowseCandidates, listCandidates } from "@/modules/recruit/service";

export const metadata: Metadata = { title: "Candidates" };

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
          <h1 className="text-2xl font-semibold tracking-tight">{t("candidates")}</h1>
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

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link href={`/recruit/candidates/${row.id}`} className="text-sm font-medium hover:underline">
                  {row.fullName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {[row.currentTitle, t(`source.${row.source}`), row.tags.join(", ")].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{format.dateTime(row.createdAt, { dateStyle: "medium" })}</span>
              {row.anonymised ? <Badge variant="outline">{t("event.anonymised")}</Badge> : null}
              <Badge variant="secondary">{row.applications}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
