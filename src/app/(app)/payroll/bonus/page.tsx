import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listBonusRuns, openBonusTotals } from "@/modules/payroll/service";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach, payrollReadReach } from "@/modules/payroll/policy";
import { NewBonusRunForm } from "@/modules/payroll/ui/bonus-forms";
import { formatVnd } from "@/modules/payroll/ui/money";
import { PayrollTabs } from "@/modules/payroll/ui/payroll-tabs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("yearEndBonus");

/**
 * The year-end bonus register (FR-PAY-21). One run per year across the whole group; the totals
 * are money, so only a payroll reader over **every** entity in a run sees its figure.
 */
export default async function BonusRunsPage() {
  const user = await requireUser();
  const reach = payrollReadReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/bonus");

  const [t, tPayroll, format, runs, entities] = await Promise.all([getTranslations("payroll.bonus"), getTranslations("payroll"), getFormatter(), listBonusRuns(), listEntityOptions(reach)]);
  const manages = compensationReach(user.principal);
  const canCreate = manages.all || manages.entityIds.length > 0;
  const mayRead = (entityIds: string[]) => reach.all || entityIds.every((entityId) => reach.entityIds.includes(entityId));
  const year = Number(todayInVietnam().slice(0, 4));

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={tPayroll("title")}
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/payroll/bonus/scheme" className={buttonVariants({ variant: "outline" })}>
            {t("scheme.link")}
          </Link>
        }
      />
      <PayrollTabs active="bonus" principal={user.principal} />

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("new.name")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
              <TableHead kind="date">{t("new.year")}</TableHead>
              <TableHead kind="date">{t("new.payrollMonth")}</TableHead>
              <TableHead kind="number">{t("columns.people")}</TableHead>
              <TableHead kind="date">{t("columns.approvedOn")}</TableHead>
              <TableHead kind="money">{t("cost.total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {runs.map((run) => {
              const readable = mayRead(run.entityIds);
              const totals = readable ? openBonusTotals(run) : null;
              return (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    {readable ? (
                      <Link href={`/payroll/bonus/${run.id}`} className="hover:underline">
                        {run.name}
                      </Link>
                    ) : (
                      run.name
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[0.8125rem] tabular-nums">{run.year}</TableCell>
                  <TableCell className="font-mono text-[0.8125rem] tabular-nums">{run.payrollMonth}</TableCell>
                  <TableCell kind="number">{t("headcount", { count: run.headcount, eligible: run.eligibleCount })}</TableCell>
                  <TableCell className="text-muted-foreground">{run.approvedAt ? format.dateTime(run.approvedAt, { dateStyle: "medium" }) : "—"}</TableCell>
                  <TableCell kind="money">{totals ? formatVnd(totals.totalVnd) : <span className="text-faint">{t("hidden")}</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {canCreate ? (
          <TableAddRow label={t("new.title")} open={runs.length === 0}>
            <NewBonusRunForm entities={entities} year={year} payrollMonth={`${year + 1}-01`} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
