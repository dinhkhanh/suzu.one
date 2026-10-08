import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { costReport, costTrend, insuranceSummary, payrollRegister, pitSummary, reportOptions, seesNamedReports, unionReport } from "@/modules/payroll/reports";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ExportReportButton, ReportFilters } from "@/modules/payroll/ui/report-forms";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { PayrollTabs } from "@/modules/payroll/ui/payroll-tabs";

export const generateMetadata = pageTitle("payrollReports");

/**
 * The payroll reports (FR-PAY-34). Two levels of sight, as everywhere else in this module:
 * `payroll:read` over an entity sees the cost, union and trend figures; only C&B and the owner
 * see the reports that name people — the register and the insurance and PIT summaries.
 */
export default async function PayrollReportsPage({ searchParams }: PageProps<"/payroll/reports">) {
  const user = await requireUser();
  const [options, params, t] = await Promise.all([reportOptions(user.principal), searchParams, getTranslations("payroll.reports")]);
  if (options.entities.length === 0) notFound();
  requireStepUp(user, "/payroll/reports");

  const asString = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const entityId = options.entities.find((entity) => entity.id === asString(params.entityId))?.id ?? options.entities[0].id;
  const month = options.months.find((value) => value === asString(params.month)) ?? options.months[0] ?? "";
  const named = seesNamedReports(user.principal);
  // The trend covers the last two years: enough to see the shape, without reading every run ever made.
  const now = new Date();
  const trendFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1)).toISOString().slice(0, 7);

  const [register, insurance, pit, cost, union, trend] = await Promise.all([
    named && month ? payrollRegister(user.principal, entityId, month) : null,
    named && month ? insuranceSummary(user.principal, entityId, month) : null,
    named && month ? pitSummary(user.principal, entityId, month) : null,
    month ? costReport(user.principal, { entityId, month }) : null,
    month ? unionReport(user.principal, { entityId, month }) : null,
    costTrend(user.principal, { entityId, fromMonth: trendFrom }),
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
      <PayrollTabs active="reports" principal={user.principal} />

      <ReportFilters entities={options.entities} months={options.months} entityId={entityId} month={month} />
      {options.months.length === 0 ? <Alert variant="neutral">{t("noRuns")}</Alert> : null}

      {/* ── The register: the one report that names people and their pay (C&B only) ── */}
      {register ? (
        <TableCard>
          <TableCardHeader title={t("register.title")} count={register.lines.length} actions={<ExportReportButton report="register" entityId={entityId} month={month} />} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("person")}</TableHead>
                <TableHead kind="org">{t("register.department")}</TableHead>
                <TableHead kind="money">{t("register.gross")}</TableHead>
                <TableHead kind="money">{t("register.insurance")}</TableHead>
                <TableHead kind="money">{t("register.pit")}</TableHead>
                <TableHead kind="money">{t("register.net")}</TableHead>
                <TableHead kind="money">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {register.lines.map((line) => (
                <TableRow key={line.personId}>
                  <TableCell>
                    <RecordLink kind="person" id={line.personId}>
                      {line.fullName}
                    </RecordLink>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{line.employeeCode}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.departmentName ? (
                      <RecordLink kind="unit" id={line.departmentId}>
                        {line.departmentName}
                      </RecordLink>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell kind="money">{formatVnd(line.gross)}</TableCell>
                  <TableCell kind="money">{formatVnd(line.employeeInsurance)}</TableCell>
                  <TableCell kind="money">{formatVnd(line.pit)}</TableCell>
                  <TableCell kind="money" className="font-medium">
                    {formatVnd(line.net)}
                  </TableCell>
                  <TableCell kind="money" className="text-muted-foreground">
                    {formatVnd(line.employerCost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell />
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(register.totals.grossEarnings)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(register.totals.employeeInsurance)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(register.totals.pit)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(register.totals.net)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(register.totals.employerCost)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableCard>
      ) : null}

      {/* ── Cost by department (everyone with payroll:read) ── */}
      {cost && cost.byDepartment.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("cost.title")} actions={<ExportReportButton report="cost" entityId={entityId} month={month} />} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="org">{t("cost.department")}</TableHead>
                <TableHead kind="number">{t("cost.headcount")}</TableHead>
                <TableHead kind="money">{t("register.gross")}</TableHead>
                <TableHead kind="money">{t("cost.employerInsurance")}</TableHead>
                <TableHead kind="money">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cost.byDepartment.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell kind="number">{row.headcount}</TableCell>
                  <TableCell kind="money">{formatVnd(row.gross)}</TableCell>
                  <TableCell kind="money">{formatVnd(row.employerInsurance)}</TableCell>
                  <TableCell kind="money">{formatVnd(row.employerCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell kind="number" className="font-semibold">
                  {cost.total.headcount}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(cost.total.gross)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(cost.total.employerInsurance)}
                </TableCell>
                <TableCell kind="money" className="font-semibold">
                  {formatVnd(cost.total.employerCost)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableCard>
      ) : null}

      {/* The three summaries below are held against what is filed, so they read signed runs only:
          a month that is calculated but not yet approved has a register and none of them. */}
      {register && !pit ? <Alert variant="neutral">{t("signedOnly")}</Alert> : null}

      {/* ── Insurance: the figures the BHXH monthly notice is checked against ── */}
      {insurance ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("insurance.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("insurance.totals", { employee: formatVnd(insurance.totals.employee), employer: formatVnd(insurance.totals.employer), total: formatVnd(insurance.totals.grandTotal) })}
                {insurance.notCovered > 0 ? ` · ${t("insurance.notCovered", { count: insurance.notCovered })}` : ""}
              </p>
            </div>
            <ExportReportButton report="insurance" entityId={entityId} month={month} />
          </div>
        </section>
      ) : null}

      {/* ── PIT: the working paper behind the monthly declaration ── */}
      {pit ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("pit.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("pit.totals", { taxable: formatVnd(pit.totals.taxableIncome), tax: formatVnd(pit.totals.tax) })}
                {pit.missingTaxCodes > 0 ? ` · ${t("pit.missingTaxCodes", { count: pit.missingTaxCodes })}` : ""}
              </p>
              <p className="mt-1 flex flex-wrap gap-2">
                {pit.byMethod.map((row) => (
                  <Badge key={row.method} variant="outline">
                    {row.method}: {row.people}
                  </Badge>
                ))}
              </p>
            </div>
            <ExportReportButton report="pit" entityId={entityId} month={month} />
          </div>
        </section>
      ) : null}

      {/* ── Union (FR-PAY-12) ── */}
      {union && union.total.total > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("union.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("union.totals", { members: union.total.members, dues: formatVnd(union.total.dues), fund: formatVnd(union.total.fund) })}</p>
            </div>
            <ExportReportButton report="union" entityId={entityId} month={month} />
          </div>
        </section>
      ) : null}

      {/* ── The trend (FR-PAY-34: headcount cost trend) ── */}
      {trend.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("trend.title")} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{t("month")}</TableHead>
                <TableHead kind="number">{t("cost.headcount")}</TableHead>
                <TableHead kind="money">{t("register.gross")}</TableHead>
                <TableHead kind="money">{t("register.net")}</TableHead>
                <TableHead kind="money">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.map((point) => (
                <TableRow key={point.month}>
                  <TableCell className="tabular-nums">{point.month}</TableCell>
                  <TableCell kind="number">{point.headcount}</TableCell>
                  <TableCell kind="money">{formatVnd(point.gross)}</TableCell>
                  <TableCell kind="money">{formatVnd(point.net)}</TableCell>
                  <TableCell kind="money">{formatVnd(point.employerCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </Page>
  );
}
