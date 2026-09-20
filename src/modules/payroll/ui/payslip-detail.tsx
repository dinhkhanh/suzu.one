// One payslip, laid out so that a person can check it themselves (FR-PAY-32) and so that every
// figure can be traced back to its rule (FR-PAY-20). A server component: the figures never reach
// the browser as data, only as the text of the page.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PayLine, PersonPayResult } from "../engine/types";
import { formatVnd } from "./money";

type Props = {
  result: PersonPayResult;
  /** Component code → the name the entity's catalogue gives it. The codes themselves are not for reading. */
  componentNames: ReadonlyMap<string, string>;
  person: { fullName: string; employeeCode: string | null; positionName: string | null; departmentName: string | null };
  entity: { legalName: string; shortName: string; taxCode: string | null; address: string | null };
  month: string;
  runName?: string | null;
};

const byGroup = (lines: readonly PayLine[], kind: PayLine["kind"]) => lines.filter((line) => line.kind === kind && line.amount !== 0);

export async function PayslipDetail({ result, componentNames, person, entity, month, runName }: Props) {
  const [t, format] = await Promise.all([getTranslations("payroll.payslips"), getFormatter()]);
  const earnings = byGroup(result.lines, "earning");
  const deductions = byGroup(result.lines, "deduction");
  const employerCosts = byGroup(result.lines, "employer_cost");
  const percent = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
  const label = (line: PayLine) => componentNames.get(line.code) ?? line.code;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Who, where, which month ── */}
      <section className="rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{entity.legalName}</div>
            {entity.address ? <div className="text-xs text-muted-foreground">{entity.address}</div> : null}
            {entity.taxCode ? <div className="text-xs text-muted-foreground">{t("taxCode")}: {entity.taxCode}</div> : null}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">{t("titleFor", { month })}</div>
            {runName ? <div className="text-xs text-muted-foreground">{runName}</div> : null}
          </div>
        </div>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-muted-foreground">{t("person")}: </dt>
            <dd className="inline font-medium">{person.fullName}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("employeeCode")}: </dt>
            <dd className="inline font-mono">{person.employeeCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("position")}: </dt>
            <dd className="inline">{person.positionName ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("department")}: </dt>
            <dd className="inline">{person.departmentName ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("profile")}: </dt>
            <dd className="inline">{t(`profiles.${result.profile}` as "profiles.statutory")}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("paidDays")}: </dt>
            <dd className="inline tabular-nums">
              {(result.proration.paidDaysCenti / 100).toFixed(2)} / {result.proration.standardDays}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── What was earned ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("earnings")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line")}</TableHead>
              <TableHead className="text-right">{t("taxablePart")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {earnings.map((line) => (
              <TableRow key={`${line.code}-${line.rule}`}>
                <TableCell>
                  <span className="font-medium">{label(line)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{line.taxable === line.amount ? "—" : formatVnd(line.taxable)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(line.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">{t("grossEarnings")}</TableCell>
              <TableCell />
              <TableCell className="text-right font-semibold tabular-nums">{formatVnd(result.totals.grossEarnings)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* ── What was taken off ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("deductions")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deductions.map((line) => (
              <TableRow key={`${line.code}-${line.rule}`}>
                <TableCell>
                  <span className="font-medium">{label(line)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(line.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">{t("totalDeductions")}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatVnd(result.totals.totalDeductions)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* ── The net ── */}
      <section className="rounded-xl border p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">{t("net")}</span>
          <span className="text-2xl font-semibold tabular-nums">{formatVnd(result.totals.net)}</span>
        </div>
      </section>

      {/* ── How the insurance was worked out (FR-PAY-11) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("insurance.title")}</h2>
        {result.insurance.covered ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("insurance.fund")}</TableHead>
                <TableHead className="text-right">{t("insurance.base")}</TableHead>
                <TableHead className="text-right">{t("insurance.employee")}</TableHead>
                <TableHead className="text-right">{t("insurance.employer")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["bhxh", "bhyt", "bhtn"] as const).map((fund) => (
                <TableRow key={fund}>
                  <TableCell>{t(`insurance.funds.${fund}` as "insurance.funds.bhxh")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(fund === "bhtn" ? result.insurance.bhtnBase : result.insurance.bhxhBhytBase)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(result.insurance.employee[fund])}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatVnd(result.insurance.employer[fund])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{result.insurance.reason ? t(`insurance.reasons.${result.insurance.reason}` as "insurance.reasons.probation") : t("insurance.notCovered")}</p>
        )}
        {result.insurance.declaredBase !== result.insurance.bhxhBhytBase ? (
          <p className="text-xs text-muted-foreground">{t("insurance.capped", { declared: formatVnd(result.insurance.declaredBase), capped: formatVnd(result.insurance.bhxhBhytBase) })}</p>
        ) : null}
      </section>

      {/* ── How the tax was worked out (FR-PAY-13, 14) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("pit.title")}</h2>
        <p className="text-sm text-muted-foreground">{t(`pit.methods.${result.pit.method}` as "pit.methods.progressive")}</p>
        {result.pit.method === "none" ? null : (
          <>
            <dl className="grid gap-1 text-sm sm:grid-cols-2">
              {(
                [
                  ["taxableIncome", result.pit.taxableIncome],
                  ["exemptIncome", result.pit.exemptIncome],
                  ["insuranceDeduction", result.pit.insuranceDeduction],
                  ["personalDeduction", result.pit.personalDeduction],
                  ["dependentDeduction", result.pit.dependentDeduction],
                  ["otherDeductions", result.pit.otherDeductions],
                  ["assessableIncome", result.pit.assessableIncome],
                ] as const
              )
                .filter(([key, value]) => value !== 0 || key === "assessableIncome" || key === "taxableIncome")
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 border-b py-1">
                    <dt className="text-muted-foreground">
                      {t(`pit.${key}` as "pit.taxableIncome")}
                      {key === "dependentDeduction" && result.pit.dependents > 0 ? ` (${result.pit.dependents})` : ""}
                    </dt>
                    <dd className="tabular-nums">{formatVnd(value)}</dd>
                  </div>
                ))}
            </dl>
            {result.pit.brackets.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pit.bracket")}</TableHead>
                    <TableHead className="text-right">{t("pit.rate")}</TableHead>
                    <TableHead className="text-right">{t("pit.slice")}</TableHead>
                    <TableHead className="text-right">{t("pit.taxOnSlice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.pit.brackets
                    .filter((bracket) => bracket.amount > 0)
                    .map((bracket, index) => (
                      <TableRow key={index}>
                        <TableCell className="tabular-nums">{bracket.upTo === null ? t("pit.above") : `≤ ${formatVnd(bracket.upTo)}`}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(bracket.rateBp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatVnd(bracket.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatVnd(bracket.tax)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : null}
            {result.pit.priorTax !== 0 ? (
              <p className="text-xs text-muted-foreground">{t("pit.offCycle", { monthTax: formatVnd(result.pit.monthTax), priorTax: formatVnd(result.pit.priorTax), tax: formatVnd(result.pit.tax) })}</p>
            ) : null}
          </>
        )}
      </section>

      {/* ── What the month cost the company: shown because it is the person's own entitlement ── */}
      {employerCosts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("employerCosts")}</h2>
          <ul className="text-sm">
            {employerCosts.map((line) => (
              <li key={line.code} className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">{label(line)}</span>
                <span className="tabular-nums">{formatVnd(line.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.warnings.length > 0 ? (
        <section className="flex flex-wrap gap-2">
          {result.warnings.map((warning) => (
            <Badge key={warning} variant="outline">
              {t(`warnings.${warning}` as "warnings.negative_net")}
            </Badge>
          ))}
        </section>
      ) : null}

      {/* ── The explanation trace (FR-PAY-20): every stage, in order, with its rule ── */}
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">{t("trace")}</summary>
        <ol className="mt-3 flex flex-col gap-2 text-xs">
          {result.trace.map((step, index) => (
            <li key={index} className="border-b pb-2">
              <span className="font-medium">{step.stage}</span>
              <span className="ml-2 text-muted-foreground">{step.rule}</span>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {Object.entries(step.detail).map(([key, value]) => (
                  <span key={key} className="tabular-nums">
                    {key}: {value === null ? "—" : typeof value === "number" ? format.number(value) : String(value)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
