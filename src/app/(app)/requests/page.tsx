import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageRequestTypes, canSettleExpenseClaims } from "@/modules/requests/policy";
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
  // The other kinds of request live with the modules that own them; this page is the way in.
  const elsewhere = [
    { href: "/leave/new", label: t("elsewhere.leave") },
    { href: "/attendance/requests/new", label: t("elsewhere.attendance") },
    { href: "/approvals", label: t("elsewhere.approvals") },
    ...(canSettleExpenseClaims(user.principal) ? [{ href: "/requests/claims", label: t("elsewhere.claims") }] : []),
  ];
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

      <nav aria-label={t("elsewhere.title")} className="flex flex-wrap gap-2">
        {elsewhere.map((link) => (
          <Link key={link.href} href={link.href} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {link.label}
          </Link>
        ))}
      </nav>

      <TableCard>
        <TableCardHeader title={t("mine")} count={mine.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.request")}</TableHead>
              <TableHead kind="text">{t("expense.columns.summary")}</TableHead>
              <TableHead kind="date">{t("expense.columns.filed")}</TableHead>
              <TableHead kind="status">{t("expense.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.length === 0 ? <TableEmpty>{t("mineEmpty")}</TableEmpty> : null}
            {mine.map((row) => (
              <TableRow key={row.requestId}>
                <TableCell className="max-w-72">
                  <Link href={`/approvals/request/${row.requestId}`} className="block truncate font-medium hover:underline">
                    {locale === "en" ? row.nameEn : row.nameVi}
                  </Link>
                  {row.parentRequestId ? (
                    <Link href={`/approvals/request/${row.parentRequestId}`} className="block truncate text-xs text-link hover:underline">
                      ↳ {t("followUps.under", { name: (locale === "en" ? row.parentNameEn : row.parentNameVi) ?? "" })}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-80 truncate text-muted-foreground">{row.summary || "—"}</TableCell>
                <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{tApprovals(`status.${row.status}` as "status.pending")}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("new")} href="/requests/new" />
      </TableCard>

      {manages ? (
        <TableCard>
          <TableCardHeader
            title={t("tracking.title")}
            description={t("tracking.description")}
            actions={
              <Link href="/admin/request-types" className="text-sm underline-offset-4 hover:underline">
                {t("tracking.manage")}
              </Link>
            }
          />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("tracking.columns.type")}</TableHead>
                <TableHead kind="number">{t("tracking.columns.open")}</TableHead>
                <TableHead kind="number">{t("tracking.columns.decided")}</TableHead>
                <TableHead kind="time">{t("tracking.columns.median")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="font-medium">{locale === "en" ? row.nameEn : row.nameVi}</TableCell>
                  <TableCell kind="number">{row.open}</TableCell>
                  <TableCell kind="number">{row.decided}</TableCell>
                  <TableCell kind="time" className="text-muted-foreground">{row.medianHours === null ? t("tracking.noMedian") : t("tracking.median", { hours: row.medianHours })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
