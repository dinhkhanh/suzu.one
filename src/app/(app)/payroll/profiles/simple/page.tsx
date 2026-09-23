import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { canSeeSimpleProfileReport } from "@/modules/payroll/policy";
import { listSimpleProfileExposure } from "@/modules/payroll/profiles";
import { SIMPLE_BASES } from "@/modules/payroll/enums";
import { pageTitle } from "@/i18n/page-title";

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
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/payroll/profiles" className="text-sm text-muted-foreground hover:underline">
          ← {t("profiles.proposalsTitle")}
        </Link>
        <h1>{t("exposure.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("exposure.description")}</p>
      </header>
      <ul className="flex flex-wrap gap-2 text-sm">
        {SIMPLE_BASES.map((basis) => (
          <li key={basis} className="rounded-md border px-3 py-1">
            {t(`profiles.bases.${basis}`)}: <span className="font-medium tabular-nums">{rows.filter((row) => row.basis === basis).length}</span>
          </li>
        ))}
      </ul>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("salaries.person")}</TableHead>
            <TableHead>{t("salaries.entity")}</TableHead>
            <TableHead>{t("profiles.basis")}</TableHead>
            <TableHead>{t("exposure.contract")}</TableHead>
            <TableHead>{t("exposure.since")}</TableHead>
            <TableHead className="text-right">{t("exposure.months")}</TableHead>
            <TableHead>{t("profiles.reviewDate")}</TableHead>
            <TableHead>{t("exposure.flags")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/payroll/salaries/${row.personId}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
              </TableCell>
              <TableCell>{entityCode.get(row.entityId)}</TableCell>
              <TableCell>{t(`profiles.bases.${row.basis}`)}</TableCell>
              <TableCell>{row.contractType ? t(`exposure.contracts.${row.contractType}` as "exposure.contracts.probation") : "—"}</TableCell>
              <TableCell>{day(row.since)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.months}</TableCell>
              <TableCell>{row.reviewDate ? day(row.reviewDate) : "—"}</TableCell>
              <TableCell className="flex flex-wrap gap-1">
                {row.flags.map((flag) => (
                  <Badge key={flag} variant="destructive">
                    {t(`exposure.flagLabels.${flag}`)}
                  </Badge>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("exposure.empty")}</p> : null}
      <p className="max-w-3xl text-xs text-muted-foreground">{t("exposure.legalNote")}</p>
    </div>
  );
}
