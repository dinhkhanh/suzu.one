import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { canSeeSimpleProfileReport } from "@/modules/payroll/policy";
import { listSimpleProfileExposure } from "@/modules/payroll/profiles";
import { SIMPLE_BASES } from "@/modules/payroll/enums";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("simpleProfileReport");

// FR-PAY-08 / risk R11: who is paid "salary only", on what basis and for how long — the owner's
// view of where statutory obligations may apply. Nobody is hidden from it.
export default async function SimpleProfileReportPage() {
  const user = await requireUser();
  if (!canSeeSimpleProfileReport(user.principal)) notFound();
  requireStepUp(user, "/payroll/profiles/simple");
  const [t, format, rows, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listSimpleProfileExposure(), listEntityOptions()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll/profiles" className="text-link hover:underline">
            ← {t("profiles.proposalsTitle")}
          </Link>
        }
        title={t("exposure.title")}
        description={t("exposure.description")}
      />
      <ul className="flex flex-wrap gap-2 text-sm">
        {SIMPLE_BASES.map((basis) => (
          <li key={basis}>
            <Badge variant="secondary">
              {t(`profiles.bases.${basis}`)} · <span className="font-mono tabular-nums">{rows.filter((row) => row.basis === basis).length}</span>
            </Badge>
          </li>
        ))}
      </ul>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("salaries.person")}</TableHead>
            <TableHead kind="org">{t("salaries.entity")}</TableHead>
            <TableHead kind="select">{t("profiles.basis")}</TableHead>
            <TableHead kind="select">{t("exposure.contract")}</TableHead>
            <TableHead kind="date">{t("exposure.since")}</TableHead>
            <TableHead kind="number">{t("exposure.months")}</TableHead>
            <TableHead kind="date">{t("profiles.reviewDate")}</TableHead>
            <TableHead kind="tags">{t("exposure.flags")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("exposure.empty")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/payroll/salaries/${row.personId}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
              </TableCell>
              <TableCell>
                <RecordLink kind="entity" id={row.entityId}>{entityCode.get(row.entityId)}</RecordLink>
              </TableCell>
              <TableCell>{t(`profiles.bases.${row.basis}`)}</TableCell>
              <TableCell>{row.contractType ? t(`exposure.contracts.${row.contractType}` as "exposure.contracts.probation") : "—"}</TableCell>
              <TableCell>{day(row.since)}</TableCell>
              <TableCell kind="number">{row.months}</TableCell>
              <TableCell>{row.reviewDate ? day(row.reviewDate) : "—"}</TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {row.flags.map((flag) => (
                    <Badge key={flag} variant="destructive">
                      {t(`exposure.flagLabels.${flag}`)}
                    </Badge>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="max-w-3xl text-xs text-muted-foreground">{t("exposure.legalNote")}</p>
    </Page>
  );
}
