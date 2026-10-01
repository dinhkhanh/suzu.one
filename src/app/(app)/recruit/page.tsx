import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { canBrowseCandidates, canManagePipelines, canRunRecruitment, listOpenings, recruitModuleOpen } from "@/modules/recruit/service";
import { canReadRecruitReports } from "@/modules/recruit/policy";
import { notFound } from "next/navigation";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("recruitment");

// The openings the reader may see: everything in their recruitment scope, plus the ones they are
// on the hiring team of. A department head hiring one editor sees exactly one row here.
export default async function RecruitPage() {
  const user = await requireUser();
  // The list is scoped by itself, so it can be read alongside the navigation check.
  const [open, t, format, openings] = await Promise.all([recruitModuleOpen(user.principal, user.person.id), getTranslations("recruit"), getFormatter(), listOpenings(user.principal)]);
  if (!open) notFound();
  const runs = canRunRecruitment(user.principal);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
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
          {/* The offer desk. The list carries no figure at all; one offer's page decides that. */}
          {runs ? (
            <Link href="/recruit/offers" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("offer.title")}
            </Link>
          ) : null}
          {/* The funnel, time to hire and source effectiveness (FR-REC-11). Counted only over the
              openings this reader could open one at a time, so the entry follows `report:read`. */}
          {canReadRecruitReports(user.principal) ? (
            <Link href="/recruit/reports" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("reports.title")}
            </Link>
          ) : null}
          {runs ? (
            <Link href="/recruit/referrals" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("referral.title")}
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

      <TableCard>
        <TableCardHeader title={t("openings")} count={openings.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.title")}</TableHead>
              <TableHead kind="id">{t("columns.code")}</TableHead>
              <TableHead kind="org">{t("columns.entity")}</TableHead>
              <TableHead kind="org">{t("columns.department")}</TableHead>
              <TableHead kind="number">{t("columns.headcount")}</TableHead>
              <TableHead kind="number">{t("columns.applications")}</TableHead>
              <TableHead kind="number">{t("columns.hired")}</TableHead>
              <TableHead kind="date">{t("columns.published")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openings.length === 0 ? <TableEmpty>{t("noOpenings")}</TableEmpty> : null}
            {openings.map((opening) => (
              <TableRow key={opening.id}>
                <TableCell className="max-w-80 truncate">
                  <Link href={`/recruit/${opening.id}`} className="font-medium hover:underline">
                    {opening.title}
                  </Link>
                </TableCell>
                <TableCell kind="id">{opening.code}</TableCell>
                <TableCell>{opening.entityName ?? "—"}</TableCell>
                <TableCell>{opening.departmentName ?? "—"}</TableCell>
                <TableCell kind="number">{opening.headcount}</TableCell>
                <TableCell kind="number">{opening.activeApplications}</TableCell>
                <TableCell kind="number">{opening.hiredCount}</TableCell>
                <TableCell>{opening.publishedAt ? format.dateTime(opening.publishedAt, { dateStyle: "medium" }) : "—"}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(opening.status)}>{t(`status.${opening.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {runs ? <TableAddRow label={t("newOpening")} href="/recruit/openings/new" /> : null}
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
