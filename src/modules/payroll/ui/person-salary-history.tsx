// The salary history on a person's record, beside their assignment history: every structure with
// its reason and what moved against the one before — a raise, a decrease, a new allowance.
// Compensation tier: the person themselves and C&B over their entity. Everyone else, the line
// manager included, gets nothing — not even the heading. Figures wait for a fresh step-up, as on
// the pay file.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("history")}</h2>
      <Link href={payFile} className="text-xs underline underline-offset-4">
        {t("openPayFile")}
      </Link>
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
      <span className={cn("whitespace-nowrap tabular-nums", value.direction === "up" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
        <span aria-hidden>{value.direction === "up" ? "▲" : "▼"}</span> <span className="sr-only">{t(`change.${value.direction}`)}</span>
        {sign}
        {formatVnd(Math.abs(value.amount))}
        {percent}
      </span>
    );
  };

  return (
    <section className="flex flex-col gap-3">
      {heading}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("period")}</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead className="text-right">{t("baseSalary")}</TableHead>
            <TableHead className="text-right">{t("total")}</TableHead>
            <TableHead>{t("changeColumn")}</TableHead>
            <TableHead>{t("decisionColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                {t("noStructure")}
              </TableCell>
            </TableRow>
          ) : (
            steps.map(({ structure, total, base, totalChange }) => (
              <TableRow key={structure.id}>
                <TableCell className="whitespace-nowrap">
                  {day(structure.validFrom)} → {structure.validTo ? day(structure.validTo) : t("open")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`reasons.${structure.reason}`)}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(structure.terms.baseSalary)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(total)}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5 text-xs">
                    {change(base)}
                    {/* The total moves on its own when only an allowance changed. */}
                    {totalChange && base && totalChange.amount !== base.amount ? (
                      <span className="text-muted-foreground">
                        {t("totalChange")}: {change(totalChange)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
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
    </section>
  );
}
