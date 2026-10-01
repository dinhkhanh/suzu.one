import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { dependantRows, finalizationRows, insuranceChanges, pitPeriodRows } from "@/modules/payroll/statutory-exports";
import { formatVnd } from "@/modules/payroll/ui/money";
import { StatutoryExportButton, StatutoryFilters } from "@/modules/payroll/ui/statutory-forms";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";

export const generateMetadata = pageTitle("statutoryData");

/**
 * The data behind the statutory filings (FR-PAY-35). C&B and the owner only: every file here
 * names people and carries their tax code, insurance number and national ID.
 *
 * The page shows what each filing would contain before it is taken out, because a declaration is
 * checked once and filed once. **Every layout is unverified against the official template** — the
 * banner says so, and so does each downloaded file's caveat list.
 */
export default async function StatutoryExportsPage({ searchParams }: PageProps<"/payroll/statutory">) {
  const user = await requireUser();
  const [entities, params, t] = await Promise.all([listEntityOptions(compensationReach(user.principal)), searchParams, getTranslations("payroll.statutory")]);
  if (entities.length === 0) notFound();
  requireStepUp(user, "/payroll/statutory");

  const asString = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const entityId = entities.find((entity) => entity.id === asString(params.entityId))?.id ?? entities[0].id;
  const today = new Date();
  const year = /^\d{4}$/.test(asString(params.year) ?? "") ? (asString(params.year) as string) : String(today.getFullYear());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asString(params.month) ?? "") ? (asString(params.month) as string) : `${year}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [insurance, pit, finalization, dependants] = await Promise.all([
    insuranceChanges(user.principal, entityId, month),
    pitPeriodRows(user.principal, entityId, month),
    finalizationRows(user.principal, entityId, Number(year)),
    dependantRows(user.principal, entityId, month),
  ]);

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

      <Alert variant="warning">{t("unverifiedBanner")}</Alert>

      <StatutoryFilters entities={entities} entityId={entityId} year={year} month={month} />

      {/* ── Insurance increase / decrease, form D02-LT ── */}
      <TableCard>
        <TableCardHeader
          title={t("d02lt.title")}
          description={insurance ? t("d02lt.summary", { count: insurance.rows.length, month }) : undefined}
          actions={insurance && insurance.rows.length > 0 ? <StatutoryExportButton kind="d02lt" entityId={entityId} period={month} label={t("download")} /> : undefined}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("person")}</TableHead>
              <TableHead kind="select">{t("d02lt.change")}</TableHead>
              <TableHead kind="money">{t("d02lt.previousBase")}</TableHead>
              <TableHead kind="money">{t("d02lt.newBase")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!insurance || insurance.rows.length === 0 ? <TableEmpty>{t("noData")}</TableEmpty> : null}
            {(insurance?.rows ?? []).map((row) => (
              <TableRow key={`${row.employeeCode}-${row.reason}`}>
                <TableCell>
                  {row.fullName}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                </TableCell>
                <TableCell>{t(`d02lt.reasons.${row.reason}`)}</TableCell>
                <TableCell kind="money">{formatVnd(row.previousBase)}</TableCell>
                <TableCell kind="money">{formatVnd(row.newBase)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── Monthly / quarterly PIT declaration, form 05/KK-TNCN ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">{t("pitMonthly.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {pit ? t("pitMonthly.summary", { count: pit.rows.length, tax: formatVnd(pit.rows.reduce((total, row) => total + row.tax, 0)) }) : t("noData")}
            </p>
          </div>
          {pit ? (
            <div className="flex flex-wrap gap-2">
              <StatutoryExportButton kind="pit_monthly" entityId={entityId} period={month} label={t("pitMonthly.download")} />
              <StatutoryExportButton kind="pit_monthly_detail" entityId={entityId} period={month} label={t("pitMonthly.downloadDetail")} />
              <StatutoryExportButton kind="pit_monthly" entityId={entityId} period={`${year}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`} label={t("pitMonthly.downloadQuarter")} />
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Annual finalization, 05/QTT-TNCN with its two appendices ── */}
      <TableCard>
        <TableCardHeader
          title={t("finalization.title", { year })}
          description={
            finalization
              ? t("finalization.summary", {
                  count: finalization.rows.length,
                  withheld: formatVnd(finalization.rows.reduce((total, row) => total + row.taxWithheld, 0)),
                  imported: finalization.rows.filter((row) => row.hasImportedPeriod).length,
                })
              : undefined
          }
          actions={
            finalization ? (
              <>
                <StatutoryExportButton kind="pit_finalization" entityId={entityId} period={year} label={t("finalization.download")} />
                <StatutoryExportButton kind="pit_finalization_appendix1" entityId={entityId} period={year} label={t("finalization.appendix1")} />
                <StatutoryExportButton kind="pit_finalization_appendix2" entityId={entityId} period={year} label={t("finalization.appendix2")} />
              </>
            ) : undefined
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("person")}</TableHead>
              <TableHead kind="money">{t("finalization.taxableIncome")}</TableHead>
              <TableHead kind="money">{t("finalization.withheld")}</TableHead>
              <TableHead kind="money">{t("finalization.due")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!finalization || finalization.rows.length === 0 ? <TableEmpty>{t("noData")}</TableEmpty> : null}
            {(finalization?.rows ?? []).map((row) => (
              <TableRow key={row.personId}>
                <TableCell>
                  {row.fullName}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                  {row.hasImportedPeriod ? <span className="ml-2 text-xs text-muted-foreground">{t("finalization.importedMark")}</span> : null}
                </TableCell>
                <TableCell kind="money">{formatVnd(row.taxableIncome)}</TableCell>
                <TableCell kind="money">{formatVnd(row.taxWithheld)}</TableCell>
                <TableCell kind="money">{formatVnd(row.taxDue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── Dependants register, form 07/ĐK-NPT-TNCN ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">{t("dependants.title")}</h2>
            <p className="text-sm text-muted-foreground">{dependants ? t("dependants.summary", { count: dependants.rows.length }) : t("noData")}</p>
          </div>
          {dependants && dependants.rows.length > 0 ? <StatutoryExportButton kind="dependants" entityId={entityId} period={month} label={t("download")} /> : null}
        </div>
      </section>
    </Page>
  );
}
