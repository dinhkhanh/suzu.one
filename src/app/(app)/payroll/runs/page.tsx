import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/date-picker";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { statusTone } from "@/components/ui/tone";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach, payrollReadReach } from "@/modules/payroll/policy";
import { listRunsForViewer } from "@/modules/payroll/run-views";
import { formatVnd } from "@/modules/payroll/ui/money";
import { PayrollTabs } from "@/modules/payroll/ui/payroll-tabs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollRuns");

/** The run register (FR-PAY-30): every entity the viewer may read payroll for. */
export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll/runs">) {
  const user = await requireUser();
  const reach = payrollReadReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/runs");

  const params = await searchParams;
  const entityId = typeof params.entity === "string" && /^[0-9a-f-]{36}$/.test(params.entity) ? params.entity : null;
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : null;
  const [t, format, rows, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listRunsForViewer(user.principal, { entityId, month }), listEntityOptions(reach)]);
  const manages = compensationReach(user.principal);
  const canCreate = manages.all || manages.entityIds.length > 0;

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={t("title")}
        title={t("runs.title")}
        description={t("runs.description")}
        actions={
          canCreate ? (
            <Link href="/payroll/runs/new" className={buttonVariants()}>
              {t("runs.new.link")}
            </Link>
          ) : undefined
        }
      />
      <PayrollTabs active="runs" principal={user.principal} />

      <form className="toolbar" action="/payroll/runs">
        <Select name="entity" defaultValue={entityId ?? ""} aria-label={t("salaries.allEntities")} className="w-auto min-w-40">
          <option value="">{t("salaries.allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code}
            </option>
          ))}
        </Select>
        <MonthPicker name="month" defaultValue={month ?? ""} aria-label={t("runs.month")} className="w-40" />
        <Button type="submit" variant="outline">
          {t("salaries.filter")}
        </Button>
      </form>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("runs.month")}</TableHead>
              <TableHead kind="org">{t("runs.entity")}</TableHead>
              <TableHead kind="select">{t("runs.kind")}</TableHead>
              <TableHead kind="status">{t("runs.status")}</TableHead>
              <TableHead kind="number">{t("runs.headcount")}</TableHead>
              <TableHead kind="money">{t("runs.net")}</TableHead>
              <TableHead kind="date">{t("runs.paidAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("runs.empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/payroll/runs/${row.id}`} className="font-mono font-medium tabular-nums hover:underline">
                    {row.month}
                  </Link>
                  {row.name ? <span className="ml-2 text-xs text-muted-foreground">{row.name}</span> : null}
                </TableCell>
                <TableCell>{row.entityCode}</TableCell>
                <TableCell>
                  <Badge variant={row.kind === "off_cycle" ? "outline" : "secondary"}>{t(`runs.kinds.${row.kind}`)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{t(`runs.statuses.${row.status}`)}</Badge>
                  {row.calcState === "running" || row.calcState === "queued" ? <span className="ml-2 text-xs text-muted-foreground">{t("runs.calculating")}</span> : null}
                  {row.calcState === "failed" ? <span className="ml-2 text-xs text-destructive">{t("runs.calcFailed")}</span> : null}
                </TableCell>
                <TableCell kind="number">{row.headcount}</TableCell>
                <TableCell kind="money">{row.net === null ? "—" : formatVnd(row.net)}</TableCell>
                <TableCell className="text-muted-foreground">{row.paidAt ? format.dateTime(row.paidAt, { dateStyle: "medium" }) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canCreate ? <TableAddRow label={t("runs.new.link")} href="/payroll/runs/new" /> : null}
      </TableCard>
    </Page>
  );
}
