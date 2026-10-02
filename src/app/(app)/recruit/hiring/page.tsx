import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { canRunRecruitment, headcountPlan, listHiringRequests } from "@/modules/recruit/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("hiringRequests");

// The asks: mine, the ones I will manage, and — for a recruiter — everything in scope. The
// headcount block below is FR-CHR-17 in the small: approved heads against the ones advertised.
export default async function HiringRequestsPage() {
  const user = await requireUser();
  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const [rows, plan] = await Promise.all([listHiringRequests(user.principal), canRunRecruitment(user.principal) ? headcountPlan(user.principal) : Promise.resolve([])]);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("hiring")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/recruit/hiring/new" className={buttonVariants({ size: "sm" })}>
          {t("newHiring")}
        </Link>
      </header>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.title")}</TableHead>
              <TableHead kind="number">{t("columns.headcount")}</TableHead>
              <TableHead kind="org">{t("columns.entity")}</TableHead>
              <TableHead kind="org">{t("columns.department")}</TableHead>
              <TableHead kind="person">{t("columns.requester")}</TableHead>
              <TableHead kind="date">{t("columns.createdAt")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("noHiring")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-72 truncate">
                  <RecordLink kind="hiringRequest" id={row.id} className="font-medium">
                    {row.positionTitle}
                  </RecordLink>
                </TableCell>
                <TableCell kind="number">{row.headcount}</TableCell>
                <TableCell>{row.entityName ? <RecordLink kind="entity" id={row.entityId}>{row.entityName}</RecordLink> : "—"}</TableCell>
                <TableCell>{row.departmentName ? <RecordLink kind="unit" id={row.departmentId}>{row.departmentName}</RecordLink> : "—"}</TableCell>
                <TableCell>{row.requesterName ? <RecordLink kind="person" id={row.requesterPersonId}>{row.requesterName}</RecordLink> : "—"}</TableCell>
                <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium" })}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{t(`hiringStatus.${row.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("newHiring")} href="/recruit/hiring/new" />
      </TableCard>

      {plan.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("headcount")} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="org">{t("columns.entity")}</TableHead>
                <TableHead kind="org">{t("columns.department")}</TableHead>
                <TableHead kind="number">{t("columns.approved")}</TableHead>
                <TableHead kind="number">{t("columns.open")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.map((row) => (
                <TableRow key={`${row.entityId}-${row.departmentId}`}>
                  <TableCell>{row.entityName ? <RecordLink kind="entity" id={row.entityId}>{row.entityName}</RecordLink> : "—"}</TableCell>
                  <TableCell>{row.departmentName ? <RecordLink kind="unit" id={row.departmentId}>{row.departmentName}</RecordLink> : "—"}</TableCell>
                  <TableCell kind="number">{row.approvedHeads}</TableCell>
                  <TableCell kind="number">{row.openHeads}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
