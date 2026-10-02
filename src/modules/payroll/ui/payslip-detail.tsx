// One payslip, laid out so that a person can check it themselves (FR-PAY-32) and so that every
// figure can be traced back to its rule (FR-PAY-20). A server component: the figures never reach
// the browser as data, only as the text of the page. The page above it shows the net.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import type { PayLine, PersonPayResult } from "../engine/types";
import { formatVnd } from "./money";

type Props = {
  result: PersonPayResult;
  /** Component code → the name the entity's catalogue gives it. The codes themselves are not for reading. */
  componentNames: ReadonlyMap<string, string>;
  person: { id?: string | null; fullName: string; employeeCode: string | null; positionName: string | null; departmentName: string | null };
  entity: { legalName: string; shortName: string; taxCode: string | null; address: string | null };
  month: string;
  runName?: string | null;
};

const byGroup = (lines: readonly PayLine[], kind: PayLine["kind"]) => lines.filter((line) => line.kind === kind && line.amount !== 0);

/** A key–value sheet: the label in grey, the value at the right in mono when it is a figure. */
function Sheet({ rows }: { rows: { label: string; value: React.ReactNode; mono?: boolean }[] }) {
  return (
    <Table numbered={false}>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label} className="hover:bg-transparent">
            <TableCell className="text-muted-foreground">{row.label}</TableCell>
            <TableCell className={row.mono ? "text-right font-mono text-[0.8125rem] tabular-nums" : "text-right"}>{row.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export async function PayslipDetail({ result, componentNames, person, entity }: Props) {
  const [t, format] = await Promise.all([getTranslations("payroll.payslips"), getFormatter()]);
  const earnings = byGroup(result.lines, "earning");
  const deductions = byGroup(result.lines, "deduction");
  const employerCosts = byGroup(result.lines, "employer_cost");
  const percent = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
  const label = (line: PayLine) => componentNames.get(line.code) ?? line.code;

  return (
    <>
      {/* ── Who, where ── */}
      <Section title={t("person")}>
        <Sheet
          rows={[
            { label: t("person"), value: <RecordLink kind="person" id={person.id} className="font-medium">{person.fullName}</RecordLink> },
            { label: t("employeeCode"), value: person.employeeCode ?? "—", mono: true },
            { label: t("position"), value: person.positionName ?? "—" },
            { label: t("department"), value: person.departmentName ?? "—" },
            { label: t("profile"), value: <Badge variant="secondary">{t(`profiles.${result.profile}` as "profiles.statutory")}</Badge> },
            { label: t("paidDays"), value: `${(result.proration.paidDaysCenti / 100).toFixed(2)} / ${result.proration.standardDays}`, mono: true },
            { label: entity.legalName, value: [entity.taxCode ? `${t("taxCode")} ${entity.taxCode}` : null, entity.address].filter(Boolean).join(" · ") || "—" },
          ]}
        />
      </Section>

      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        {/* ── What was earned ── */}
        <Section title={t("earnings")}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("line")}</TableHead>
                <TableHead kind="money">{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.map((line) => (
                <TableRow key={`${line.code}-${line.rule}`}>
                  <TableCell className="whitespace-normal">
                    {label(line)}
                    {line.taxable !== line.amount ? <span className="block text-xs text-faint">{t("taxablePart")}: {formatVnd(line.taxable)}</span> : null}
                  </TableCell>
                  <TableCell kind="money">{formatVnd(line.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("grossEarnings")}</TableCell>
                <TableCell kind="money" className="font-semibold">{formatVnd(result.totals.grossEarnings)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Section>

        {/* ── What was taken off ── */}
        <Section title={t("deductions")}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("line")}</TableHead>
                <TableHead kind="money">{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deductions.length === 0 ? <TableEmpty>—</TableEmpty> : null}
              {deductions.map((line) => (
                <TableRow key={`${line.code}-${line.rule}`}>
                  <TableCell className="whitespace-normal">{label(line)}</TableCell>
                  <TableCell kind="money">{formatVnd(line.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("totalDeductions")}</TableCell>
                <TableCell kind="money" className="font-semibold">{formatVnd(result.totals.totalDeductions)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Section>
      </div>

      {/* ── How the insurance was worked out (FR-PAY-11) ── */}
      <Section title={t("insurance.title")}>
        <TableCard>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("insurance.fund")}</TableHead>
                <TableHead kind="money">{t("insurance.base")}</TableHead>
                <TableHead kind="money">{t("insurance.employee")}</TableHead>
                <TableHead kind="money">{t("insurance.employer")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.insurance.covered ? (
                (["bhxh", "bhyt", "bhtn"] as const).map((fund) => (
                  <TableRow key={fund}>
                    <TableCell>{t(`insurance.funds.${fund}` as "insurance.funds.bhxh")}</TableCell>
                    <TableCell kind="money" className="text-muted-foreground">{formatVnd(fund === "bhtn" ? result.insurance.bhtnBase : result.insurance.bhxhBhytBase)}</TableCell>
                    <TableCell kind="money">{formatVnd(result.insurance.employee[fund])}</TableCell>
                    <TableCell kind="money" className="text-muted-foreground">{formatVnd(result.insurance.employer[fund])}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty>{result.insurance.reason ? t(`insurance.reasons.${result.insurance.reason}` as "insurance.reasons.probation") : t("insurance.notCovered")}</TableEmpty>
              )}
            </TableBody>
          </Table>
          {result.insurance.declaredBase !== result.insurance.bhxhBhytBase ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t("insurance.capped", { declared: formatVnd(result.insurance.declaredBase), capped: formatVnd(result.insurance.bhxhBhytBase) })}</p> : null}
        </TableCard>
      </Section>

      {/* ── How the tax was worked out (FR-PAY-13, 14) ── */}
      <Section title={t("pit.title")}>
        <p className="text-sm text-muted-foreground">{t(`pit.methods.${result.pit.method}` as "pit.methods.progressive")}</p>
        {result.pit.method === "none" ? null : (
          <>
            <Sheet
              rows={(
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
                .map(([key, value]) => ({ label: `${t(`pit.${key}` as "pit.taxableIncome")}${key === "dependentDeduction" && result.pit.dependents > 0 ? ` (${result.pit.dependents})` : ""}`, value: formatVnd(value), mono: true }))}
            />
            {result.pit.brackets.length > 0 ? (
              <Table numbered={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="money">{t("pit.bracket")}</TableHead>
                    <TableHead kind="percent">{t("pit.rate")}</TableHead>
                    <TableHead kind="money">{t("pit.slice")}</TableHead>
                    <TableHead kind="money">{t("pit.taxOnSlice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.pit.brackets
                    .filter((bracket) => bracket.amount > 0)
                    .map((bracket, index) => (
                      <TableRow key={index}>
                        <TableCell kind="money" className="text-muted-foreground">{bracket.upTo === null ? t("pit.above") : `≤ ${formatVnd(bracket.upTo)}`}</TableCell>
                        <TableCell kind="percent">{percent(bracket.rateBp)}</TableCell>
                        <TableCell kind="money">{formatVnd(bracket.amount)}</TableCell>
                        <TableCell kind="money">{formatVnd(bracket.tax)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : null}
            {result.pit.priorTax !== 0 ? <p className="text-xs text-muted-foreground">{t("pit.offCycle", { monthTax: formatVnd(result.pit.monthTax), priorTax: formatVnd(result.pit.priorTax), tax: formatVnd(result.pit.tax) })}</p> : null}
          </>
        )}
      </Section>

      {/* ── What the month cost the company: shown because it is the person's own entitlement ── */}
      {employerCosts.length > 0 ? (
        <Section title={t("employerCosts")}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("line")}</TableHead>
                <TableHead kind="money">{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employerCosts.map((line) => (
                <TableRow key={line.code}>
                  <TableCell className="text-muted-foreground">{label(line)}</TableCell>
                  <TableCell kind="money">{formatVnd(line.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {result.warnings.map((warning) => (
            <Badge key={warning} dot variant="warning">
              {t(`warnings.${warning}` as "warnings.negative_net")}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* ── The explanation trace (FR-PAY-20): every stage, in order, with its rule ── */}
      <Collapsible>
        <CollapsibleTrigger className="press flex h-9 items-center text-sm font-medium text-link hover:underline">{t("trace")}</CollapsibleTrigger>
        <CollapsibleContent>
          <Table numbered={false} containerClassName="mt-2">
            <TableBody>
              {result.trace.map((step, index) => (
                <TableRow key={index}>
                  <TableCell className="align-top text-xs font-medium">{step.stage}</TableCell>
                  <TableCell className="align-top text-xs whitespace-normal text-muted-foreground">
                    <span className="block">{step.rule}</span>
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono tabular-nums">
                      {Object.entries(step.detail).map(([key, value]) => (
                        <span key={key}>
                          {key}: {value === null ? "—" : typeof value === "number" ? format.number(value) : String(value)}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
