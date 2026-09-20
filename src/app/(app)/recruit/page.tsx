import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { canBrowseCandidates, canManagePipelines, canRunRecruitment, listOpenings, recruitModuleOpen } from "@/modules/recruit/service";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Recruitment" };

// The openings the reader may see: everything in their recruitment scope, plus the ones they are
// on the hiring team of. A department head hiring one editor sees exactly one row here.
export default async function RecruitPage() {
  const user = await requireUser();
  if (!(await recruitModuleOpen(user.principal, user.person.id))) notFound();

  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const openings = await listOpenings(user.principal);
  const runs = canRunRecruitment(user.principal);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href="/recruit/hiring" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("hiring")}
          </Link>
          {canBrowseCandidates(user.principal) ? (
            <Link href="/recruit/candidates" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("candidates")}
            </Link>
          ) : null}
          {/* The wordings are the group's, so the entry shows for a group-wide grant only. */}
          {canManagePipelines(user.principal) ? (
            <Link href="/recruit/emails" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("email.title")}
            </Link>
          ) : null}
          {runs ? (
            <Link href="/recruit/openings/new" className={buttonVariants({ size: "sm" })}>
              {t("newOpening")}
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("openings")}</h2>
        {openings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noOpenings")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {openings.map((opening) => (
              <li key={opening.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/recruit/${opening.id}`} className="text-sm font-medium hover:underline">
                    {opening.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {opening.code}
                    {opening.entityName ? ` · ${opening.entityName}` : ""}
                    {opening.departmentName ? ` · ${opening.departmentName}` : ""}
                    {` · ${t("columns.headcount")}: ${opening.headcount}`}
                  </p>
                  {opening.publishedAt ? <p className="text-xs text-muted-foreground">{format.dateTime(opening.publishedAt, { dateStyle: "medium" })}</p> : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("columns.applications")}: {opening.activeApplications}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("columns.hired")}: {opening.hiredCount}
                </span>
                <Badge variant={opening.status === "open" ? "default" : "outline"}>{t(`status.${opening.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
