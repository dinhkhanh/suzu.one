import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPayrollNames } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { listEntityOptions } from "@/modules/payroll/options";
import { commitYtdImportAction, stageYtdImportAction } from "@/modules/payroll/parallel-actions";
import { canManageCompensation, compensationReach } from "@/modules/payroll/policy";
import { formatVnd } from "@/modules/payroll/ui/money";
import { StatutoryFilters } from "@/modules/payroll/ui/statutory-forms";
import { listYtd } from "@/modules/payroll/ytd";
import { ytdTemplate } from "@/modules/payroll/ytd-import";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("yearToDateImport");

/**
 * Year-to-date figures for months the system did not run (FR-PAY-35). C&B and the owner only.
 * They are added to the runs when the annual finalization is built, so a year that began in the
 * old spreadsheet still finalizes as one year.
 */
export default async function YtdPage({ searchParams }: PageProps<"/payroll/ytd">) {
  const user = await requireUser();
  const [entities, params, t] = await Promise.all([listEntityOptions(compensationReach(user.principal)), searchParams, getTranslations("payroll.ytd")]);
  if (entities.length === 0) notFound();
  requireStepUp(user, "/payroll/ytd");

  const asString = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const entityId = entities.find((entity) => entity.id === asString(params.entityId))?.id ?? entities[0].id;
  if (!canManageCompensation(user.principal, { entityId })) notFound();
  const year = /^\d{4}$/.test(asString(params.year) ?? "") ? (asString(params.year) as string) : String(new Date().getFullYear());

  const rows = await listYtd(entityId, Number(year));
  // Only names beside the figures: nothing about the people is decrypted.
  const facts = await listPayrollNames(rows.map((row) => row.row.personId));
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      <StatutoryFilters entities={entities} entityId={entityId} year={year} month={`${year}-01`} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("person")}</TableHead>
            <TableHead kind="number">{t("months")}</TableHead>
            <TableHead kind="money">{t("taxableIncome")}</TableHead>
            <TableHead kind="money">{t("insurance")}</TableHead>
            <TableHead kind="money">{t("taxWithheld")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("empty", { year })}</TableEmpty> : null}
          {rows.map(({ row, figures }) => (
            <TableRow key={row.id}>
              <TableCell>
                <RecordLink kind="person" id={row.personId}>
                  {factOf.get(row.personId)?.fullName ?? "—"}
                </RecordLink>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{factOf.get(row.personId)?.employeeCode}</span>
              </TableCell>
              <TableCell kind="number">{row.months}</TableCell>
              <TableCell kind="money">{formatVnd(figures.taxableIncome)}</TableCell>
              <TableCell kind="money">{formatVnd(figures.insuranceDeduction)}</TableCell>
              <TableCell kind="money">{formatVnd(figures.taxWithheld)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <section className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("importHint", { year })}</p>
        <ImportWizard title={t("wizard")} template={{ fileName: `ytd-${year}.csv`, csv: ytdTemplate() }} stageAction={stageYtdImportAction} commitAction={commitYtdImportAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="year" value={year} />
        </ImportWizard>
      </section>
    </Page>
  );
}
