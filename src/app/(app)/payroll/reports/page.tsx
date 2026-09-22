import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { costReport, costTrend, insuranceSummary, payrollRegister, pitSummary, reportOptions, seesNamedReports, unionReport } from "@/modules/payroll/reports";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ExportReportButton, ReportFilters } from "@/modules/payroll/ui/report-forms";

export const metadata: Metadata = { title: "Payroll reports" };

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
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <ReportFilters entities={options.entities} months={options.months} entityId={entityId} month={month} />
      {options.months.length === 0 ? <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("noRuns")}</p> : null}

      {/* ── The register: the one report that names people and their pay (C&B only) ── */}
      {register ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{t("register.title")}</h2>
            <ExportReportButton report="register" entityId={entityId} month={month} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("person")}</TableHead>
                <TableHead>{t("register.department")}</TableHead>
                <TableHead className="text-right">{t("register.gross")}</TableHead>
                <TableHead className="text-right">{t("register.insurance")}</TableHead>
                <TableHead className="text-right">{t("register.pit")}</TableHead>
                <TableHead className="text-right">{t("register.net")}</TableHead>
                <TableHead className="text-right">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {register.lines.map((line) => (
                <TableRow key={line.personId}>
                  <TableCell>
                    {line.fullName}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{line.employeeCode}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{line.departmentName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(line.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(line.employeeInsurance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(line.pit)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatVnd(line.net)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatVnd(line.employerCost)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">{t("total")}</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(register.totals.grossEarnings)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(register.totals.employeeInsurance)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(register.totals.pit)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(register.totals.net)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(register.totals.employerCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>
      ) : null}

      {/* ── Cost by department (everyone with payroll:read) ── */}
      {cost && cost.byDepartment.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{t("cost.title")}</h2>
            <ExportReportButton report="cost" entityId={entityId} month={month} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cost.department")}</TableHead>
                <TableHead className="text-right">{t("cost.headcount")}</TableHead>
                <TableHead className="text-right">{t("register.gross")}</TableHead>
                <TableHead className="text-right">{t("cost.employerInsurance")}</TableHead>
                <TableHead className="text-right">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cost.byDepartment.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.headcount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.employerInsurance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.employerCost)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">{t("total")}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{cost.total.headcount}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(cost.total.gross)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(cost.total.employerInsurance)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatVnd(cost.total.employerCost)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>
      ) : null}

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
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("trend.title")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("month")}</TableHead>
                <TableHead className="text-right">{t("cost.headcount")}</TableHead>
                <TableHead className="text-right">{t("register.gross")}</TableHead>
                <TableHead className="text-right">{t("register.net")}</TableHead>
                <TableHead className="text-right">{t("register.employerCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.map((point) => (
                <TableRow key={point.month}>
                  <TableCell className="tabular-nums">{point.month}</TableCell>
                  <TableCell className="text-right tabular-nums">{point.headcount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(point.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(point.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(point.employerCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
