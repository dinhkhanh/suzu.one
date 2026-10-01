// The salary history on a person's record, beside their assignment history: every structure with
// its reason and what moved against the one before — a raise, a decrease, a new allowance.
// Compensation tier: the person themselves and C&B over their entity. Everyone else, the line
// manager included, gets nothing — not even the heading. Figures wait for a fresh step-up, as on
// the pay file.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Principal } from "@/modules/platform/rbac/policy";
import { type SalaryDelta, salarySteps } from "../engine/salary-history";
import { getSalaryFile } from "../salaries";
import { formatVnd } from "./money";

export async function PersonSalaryHistory({ viewer, personId, stepUpFresh }: { viewer: { personId: string; principal: Principal }; personId: string; stepUpFresh: boolean }) {
  const file = await getSalaryFile(viewer, personId);
  if (!file) return null;
  const [t, format] = await Promise.all([getTranslations("payroll.salaries"), getFormatter()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const payFile = `/payroll/salaries/${personId}`;

  const payFileLink = (
    <Link href={payFile} className="text-xs underline underline-offset-4">
      {t("openPayFile")}
    </Link>
  );
  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("history")}</h2>
      {payFileLink}
    </div>
  );

  if (!stepUpFresh) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <p className="text-sm text-muted-foreground">
          {t("historyStepUp")}{" "}
          <Link href={`/step-up?next=${encodeURIComponent(`/people/${personId}`)}`} className="underline underline-offset-4">
            {t("historyStepUpLink")}
          </Link>
        </p>
      </section>
    );
  }

  const steps = salarySteps(file.structures);
  const change = (value: SalaryDelta | null) => {
    if (!value) return <span className="text-muted-foreground">—</span>;
    if (value.direction === "same") return <span className="text-muted-foreground">{t("change.same")}</span>;
    const sign = value.direction === "up" ? "+" : "−";
    const percent = value.bp === null ? "" : ` (${sign}${format.number(Math.abs(value.bp) / 100, { maximumFractionDigits: 1 })}%)`;
    return (
      <span className={cn("whitespace-nowrap tabular-nums", value.direction === "up" ? "text-success" : "text-destructive")}>
        <span aria-hidden>{value.direction === "up" ? "▲" : "▼"}</span> <span className="sr-only">{t(`change.${value.direction}`)}</span>
        {sign}
        {formatVnd(Math.abs(value.amount))}
        {percent}
      </span>
    );
  };

  return (
    <TableCard>
      <TableCardHeader title={t("history")} count={steps.length || null} actions={payFileLink} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="date">{t("period")}</TableHead>
            <TableHead kind="select">{t("reason")}</TableHead>
            <TableHead kind="money">{t("baseSalary")}</TableHead>
            <TableHead kind="money">{t("total")}</TableHead>
            <TableHead kind="money">{t("changeColumn")}</TableHead>
            <TableHead kind="link">{t("decisionColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.length === 0 ? (
            <TableEmpty>{t("noStructure")}</TableEmpty>
          ) : (
            steps.map(({ structure, total, base, totalChange }) => (
              <TableRow key={structure.id}>
                <TableCell>
                  {day(structure.validFrom)} → {structure.validTo ? day(structure.validTo) : t("open")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`reasons.${structure.reason}`)}</Badge>
                </TableCell>
                <TableCell kind="money">{formatVnd(structure.terms.baseSalary)}</TableCell>
                <TableCell kind="money">{formatVnd(total)}</TableCell>
                <TableCell kind="money">
                  <div className="flex flex-col items-end gap-0.5 text-xs">
                    {change(base)}
                    {/* The total moves on its own when only an allowance changed. */}
                    {totalChange && base && totalChange.amount !== base.amount ? (
                      <span className="text-muted-foreground">
                        {t("totalChange")}: {change(totalChange)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell kind="link">
                  {structure.decisionNumber ? (
                    <Link href={`/payroll/salaries/decisions/${structure.id}`} className="text-xs whitespace-nowrap hover:underline">
                      {structure.decisionNumber}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  );
}
