import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { listMySubmissions, requestTypeStats } from "@/modules/requests/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requests");

// What I have asked for, and — for whoever administers the types — how each type is doing
// (FR-REQ-04). A row opens the request itself, where its history and its answers are.
export default async function RequestsPage() {
  const user = await requireUser();
  const t = await getTranslations("requests");
  const tApprovals = await getTranslations("approvals");
  const locale = await getLocale();
  const format = await getFormatter();
  const manages = canManageRequestTypes(user.principal);
  const [mine, stats] = await Promise.all([listMySubmissions(user.person.id), manages ? requestTypeStats() : Promise.resolve([])]);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/requests/new" className={buttonVariants({ size: "sm" })}>
          {t("new")}
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("mine")}</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mineEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {mine.map((row) => (
              <li key={row.requestId} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/approvals/request/${row.requestId}`} className="text-sm font-medium hover:underline">
                    {locale === "en" ? row.nameEn : row.nameVi}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.summary}</p>
                  <p className="text-xs text-muted-foreground">{format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <Badge variant={row.status === "pending" ? "secondary" : "outline"}>{tApprovals(`status.${row.status}` as "status.pending")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manages ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("tracking.title")}</h2>
            <Link href="/admin/request-types" className="text-sm underline-offset-4 hover:underline">
              {t("tracking.manage")}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{t("tracking.description")}</p>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {stats.map((row) => (
              <li key={row.code} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1 basis-56 font-medium">{locale === "en" ? row.nameEn : row.nameVi}</span>
                <span className="text-muted-foreground">{t("tracking.open", { count: row.open })}</span>
                <span className="text-muted-foreground">{t("tracking.decided", { count: row.decided })}</span>
                <span className="text-muted-foreground">{row.medianHours === null ? t("tracking.noMedian") : t("tracking.median", { hours: row.medianHours })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
