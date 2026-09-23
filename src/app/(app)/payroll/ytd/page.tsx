import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <StatutoryFilters entities={entities} entityId={entityId} year={year} month={`${year}-01`} />

      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("person")}</TableHead>
              <TableHead className="text-right">{t("months")}</TableHead>
              <TableHead className="text-right">{t("taxableIncome")}</TableHead>
              <TableHead className="text-right">{t("insurance")}</TableHead>
              <TableHead className="text-right">{t("taxWithheld")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ row, figures }) => (
              <TableRow key={row.id}>
                <TableCell>
                  {factOf.get(row.personId)?.fullName ?? "—"}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{factOf.get(row.personId)?.employeeCode}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.months}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(figures.taxableIncome)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(figures.insuranceDeduction)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(figures.taxWithheld)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("empty", { year })}</p>
      )}

      <section className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("importHint", { year })}</p>
        <ImportWizard title={t("wizard")} template={{ fileName: `ytd-${year}.csv`, csv: ytdTemplate() }} stageAction={stageYtdImportAction} commitAction={commitYtdImportAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="year" value={year} />
        </ImportWizard>
      </section>
    </div>
  );
}
